//! 最小对话上游调用：直连端点，流式（Claude / OpenAI Chat）或非流式（Responses）。

mod compaction;

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use futures::StreamExt;
use once_cell::sync::Lazy;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};
use crate::models::chat::{ChatChunkPayload, ChatDonePayload, ChatErrorPayload};
use crate::models::endpoint::Endpoint;
use crate::modules::models_probe::ProbeAuth;
use crate::modules::proxy::client::{build_client, should_use_proxy};
use crate::modules::proxy::resolver::resolve_outbound;
use crate::modules::storage::db::DbPool;
use crate::modules::storage::{chat_repo, config_repo, endpoint_repo};
use crate::modules::transform::transformer::UpstreamFormat;

static ACTIVE_TOPICS: Lazy<Mutex<HashSet<String>>> = Lazy::new(|| Mutex::new(HashSet::new()));
static CANCEL_TOKENS: Lazy<Mutex<HashMap<String, CancellationToken>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

pub fn try_begin(topic_id: &str) -> bool {
    let mut g = ACTIVE_TOPICS.lock().unwrap();
    if g.contains(topic_id) {
        return false;
    }
    g.insert(topic_id.to_string());
    let token = CancellationToken::new();
    CANCEL_TOKENS
        .lock()
        .unwrap()
        .insert(topic_id.to_string(), token);
    true
}

pub fn end(topic_id: &str) {
    ACTIVE_TOPICS.lock().unwrap().remove(topic_id);
    CANCEL_TOKENS.lock().unwrap().remove(topic_id);
}

pub fn abort(topic_id: &str) {
    if let Some(t) = CANCEL_TOKENS.lock().unwrap().get(topic_id) {
        t.cancel();
    }
}

fn cancel_token(topic_id: &str) -> Option<CancellationToken> {
    CANCEL_TOKENS.lock().unwrap().get(topic_id).cloned()
}

fn outbound_model(ep: &Endpoint, inbound: &str) -> String {
    resolve_outbound(ep, Some(inbound)).unwrap_or_else(|| inbound.trim().to_string())
}

pub(crate) fn endpoint_api_url(api_url: &str, api_path: &str) -> String {
    crate::utils::upstream_url::join_upstream_url(api_url, api_path)
}

fn build_messages(history: &[(String, String)]) -> Vec<Value> {
    history
        .iter()
        .filter(|(_, c)| !c.is_empty())
        .map(|(role, content)| json!({ "role": role, "content": content }))
        .collect()
}

fn persist_and_emit_done(
    app: &AppHandle,
    db: &DbPool,
    topic_id: &str,
    assistant_id: &str,
    content: &str,
) -> AppResult<()> {
    let conn = db.get()?;
    chat_repo::update_message_content(&conn, assistant_id, content, "success")?;
    chat_repo::touch_topic(&conn, topic_id)?;
    let _ = app.emit(
        "chat-done",
        ChatDonePayload {
            topic_id: topic_id.to_string(),
            message_id: assistant_id.to_string(),
            content: content.to_string(),
        },
    );
    Ok(())
}

fn emit_chunk(app: &AppHandle, topic_id: &str, message_id: &str, delta: &str) {
    if delta.is_empty() {
        return;
    }
    let _ = app.emit(
        "chat-chunk",
        ChatChunkPayload {
            topic_id: topic_id.to_string(),
            message_id: message_id.to_string(),
            delta: delta.to_string(),
        },
    );
}

/// 解析 SSE 缓冲行，提取文本 delta（OpenAI Chat / Claude）。
fn parse_sse_data_line(format: UpstreamFormat, data: &str) -> Option<String> {
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;
    match format {
        UpstreamFormat::OpenAiChat => v
            .pointer("/choices/0/delta/content")
            .and_then(|x| x.as_str())
            .map(str::to_string),
        UpstreamFormat::Claude => {
            let t = v.get("type")?.as_str()?;
            if t == "content_block_delta" {
                v.pointer("/delta/text")
                    .and_then(|x| x.as_str())
                    .map(str::to_string)
            } else {
                None
            }
        }
        UpstreamFormat::OpenAiResponses => None,
    }
}

fn extract_responses_text(v: &Value) -> String {
    if let Some(s) = v.get("output_text").and_then(|x| x.as_str()) {
        return s.to_string();
    }
    let mut out = String::new();
    if let Some(arr) = v.get("output").and_then(|x| x.as_array()) {
        for item in arr {
            if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                for part in content {
                    if part.get("type").and_then(|t| t.as_str()) == Some("output_text")
                        || part.get("type").and_then(|t| t.as_str()) == Some("text")
                    {
                        if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                            out.push_str(t);
                        }
                    }
                }
            }
        }
    }
    out
}

pub async fn run_stream(
    app: AppHandle,
    db: DbPool,
    topic_id: String,
    assistant_id: String,
    endpoint_id: i64,
    inbound_model: String,
) {
    let result = run_stream_inner(
        &app,
        &db,
        &topic_id,
        &assistant_id,
        endpoint_id,
        &inbound_model,
    )
    .await;
    if let Err(e) = result {
        let msg = e.to_string();
        // 用户停止：保留已流式内容并以 done 收尾，避免前端当成失败 toast。
        if msg.contains("已取消") {
            let content = db
                .get()
                .ok()
                .and_then(|conn| chat_repo::get_message(&conn, &assistant_id).ok().flatten())
                .map(|m| m.content)
                .unwrap_or_default();
            let _ = persist_and_emit_done(&app, &db, &topic_id, &assistant_id, &content);
        } else {
            if let Ok(conn) = db.get() {
                let _ = chat_repo::update_message_content(&conn, &assistant_id, &msg, "error");
            }
            let _ = app.emit(
                "chat-error",
                ChatErrorPayload {
                    topic_id: topic_id.clone(),
                    message_id: assistant_id.clone(),
                    error: msg,
                },
            );
        }
    }
    end(&topic_id);
}

async fn run_stream_inner(
    app: &AppHandle,
    db: &DbPool,
    topic_id: &str,
    assistant_id: &str,
    endpoint_id: i64,
    inbound_model: &str,
) -> AppResult<()> {
    let token = cancel_token(topic_id).unwrap_or_else(CancellationToken::new);

    let (ep, proxy_enabled, proxy_url) = {
        let conn = db.get()?;
        let ep = endpoint_repo::get_by_id(&conn, endpoint_id)?
            .ok_or_else(|| AppError::NotFound(format!("端点 #{endpoint_id} 不存在")))?;
        if !ep.enabled || ep.archived {
            return Err(AppError::InvalidArgument("端点未启用或已归档".into()));
        }
        let cfg = config_repo::get_config(&conn)?;
        (ep, cfg.proxy_enabled, cfg.proxy_url)
    };

    let history = compaction::maybe_compact_history(
        db,
        topic_id,
        &ep,
        inbound_model,
        proxy_enabled,
        &proxy_url,
        &token,
    )
    .await?;
    let history: Vec<_> = history
        .into_iter()
        .filter(|(role, content)| !(role == "assistant" && content.is_empty()))
        .collect();

    let model = outbound_model(&ep, inbound_model);
    let format = UpstreamFormat::from_transformer_name(&ep.transformer);
    let want = should_use_proxy(ep.use_proxy, proxy_enabled, &proxy_url);
    let client = build_client(want, &proxy_url, Duration::from_secs(300))?;

    let messages = build_messages(&history);

    let (url, body, stream) = match format {
        UpstreamFormat::OpenAiChat => (
            endpoint_api_url(&ep.api_url, "/v1/chat/completions"),
            json!({ "model": model, "messages": messages, "stream": true }),
            true,
        ),
        UpstreamFormat::Claude => (
            endpoint_api_url(&ep.api_url, "/v1/messages"),
            json!({
                "model": model,
                "max_tokens": 8192,
                "messages": messages,
                "stream": true,
            }),
            true,
        ),
        UpstreamFormat::OpenAiResponses => (
            endpoint_api_url(&ep.api_url, "/v1/responses"),
            json!({
                "model": model,
                "max_output_tokens": 8192,
                "input": messages,
                "stream": false,
            }),
            false,
        ),
    };

    {
        let conn = db.get()?;
        chat_repo::update_message_content(&conn, assistant_id, "", "streaming")?;
    }

    let req = ProbeAuth::primary_for(&ep.transformer)
        .apply(client.post(&url), &ep.api_key)
        .header(
            "accept",
            if stream {
                "text/event-stream"
            } else {
                "application/json"
            },
        )
        .json(&body);

    if token.is_cancelled() {
        return persist_and_emit_done(app, db, topic_id, assistant_id, "");
    }

    let resp = tokio::select! {
        _ = token.cancelled() => {
            return persist_and_emit_done(app, db, topic_id, assistant_id, "");
        }
        send_result = req.send() => send_result
            .map_err(|e| AppError::InvalidArgument(format!("请求失败: {e}")))?,
    };
    if !resp.status().is_success() {
        let code = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        let snippet: String = body.chars().take(400).collect();
        return Err(AppError::InvalidArgument(format!(
            "上游 HTTP {code}: {snippet}"
        )));
    }

    if !stream {
        let v: Value = tokio::select! {
            _ = token.cancelled() => {
                return persist_and_emit_done(app, db, topic_id, assistant_id, "");
            }
            parse_result = resp.json() => parse_result
                .map_err(|e| AppError::InvalidArgument(format!("解析响应失败: {e}")))?,
        };
        let text = extract_responses_text(&v);
        if text.is_empty() {
            return Err(AppError::InvalidArgument(format!(
                "空响应: {}",
                &v.to_string().chars().take(300).collect::<String>()
            )));
        }
        emit_chunk(app, topic_id, assistant_id, &text);
        return persist_and_emit_done(app, db, topic_id, assistant_id, &text);
    }

    let mut accumulated = String::new();
    let mut line_buf = String::new();
    let mut byte_stream = resp.bytes_stream();

    loop {
        let item = tokio::select! {
            _ = token.cancelled() => {
                return persist_and_emit_done(app, db, topic_id, assistant_id, &accumulated);
            }
            next_item = byte_stream.next() => next_item,
        };
        let Some(item) = item else {
            break;
        };
        if token.is_cancelled() {
            return persist_and_emit_done(app, db, topic_id, assistant_id, &accumulated);
        }
        let chunk = item.map_err(|e| AppError::InvalidArgument(format!("读流失败: {e}")))?;
        line_buf.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = line_buf.find('\n') {
            let mut line = line_buf[..pos].to_string();
            line_buf = line_buf[pos + 1..].to_string();
            if line.ends_with('\r') {
                line.pop();
            }
            let line = line.trim();
            if let Some(data) = line.strip_prefix("data:") {
                if let Some(delta) = parse_sse_data_line(format, data) {
                    accumulated.push_str(&delta);
                    emit_chunk(app, topic_id, assistant_id, &delta);
                }
            }
        }
    }
    // 尾部残留
    if !line_buf.trim().is_empty() {
        if let Some(data) = line_buf.trim().strip_prefix("data:") {
            if let Some(delta) = parse_sse_data_line(format, data) {
                accumulated.push_str(&delta);
                emit_chunk(app, topic_id, assistant_id, &delta);
            }
        }
    }

    if accumulated.is_empty() {
        return Err(AppError::InvalidArgument("上游未返回文本内容".into()));
    }
    persist_and_emit_done(app, db, topic_id, assistant_id, &accumulated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_openai_delta() {
        let d = r#"{"choices":[{"delta":{"content":"Hi"}}]}"#;
        assert_eq!(
            parse_sse_data_line(UpstreamFormat::OpenAiChat, d).as_deref(),
            Some("Hi")
        );
    }

    #[test]
    fn parse_claude_delta() {
        let d = r#"{"type":"content_block_delta","delta":{"type":"text_delta","text":"嘿"}}"#;
        assert_eq!(
            parse_sse_data_line(UpstreamFormat::Claude, d).as_deref(),
            Some("嘿")
        );
    }
}
