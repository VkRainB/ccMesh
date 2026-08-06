//! Turn-Start 持久化压缩（Cherry §6 / §9 最小集）。

use std::time::Duration;

use serde_json::{json, Value};

use crate::error::{AppError, AppResult};
use crate::models::endpoint::Endpoint;
use crate::modules::models_probe::ProbeAuth;
use crate::modules::proxy::client::{build_client, should_use_proxy};
use crate::modules::proxy::resolver::resolve_outbound;
use crate::modules::storage::chat_repo;
use crate::modules::storage::db::DbPool;
use crate::modules::transform::transformer::UpstreamFormat;
use tokio_util::sync::CancellationToken;

const TRIGGER_RATIO: f64 = 0.8;
const KEEP_RATIO: f64 = 0.3;
const DEFAULT_CONTEXT_WINDOW: usize = 128_000;
const CHARS_PER_TOKEN: usize = 3;

pub fn estimate_tokens(text: &str) -> usize {
    text.chars().count().div_ceil(CHARS_PER_TOKEN).max(1)
}

fn outbound_model(ep: &Endpoint, inbound: &str) -> String {
    resolve_outbound(ep, Some(inbound)).unwrap_or_else(|| inbound.trim().to_string())
}

fn extract_text_response(format: UpstreamFormat, v: &Value) -> String {
    match format {
        UpstreamFormat::OpenAiChat => v
            .pointer("/choices/0/message/content")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string(),
        UpstreamFormat::Claude => {
            let mut out = String::new();
            if let Some(arr) = v.get("content").and_then(|c| c.as_array()) {
                for part in arr {
                    if part.get("type").and_then(|t| t.as_str()) == Some("text") {
                        if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                            out.push_str(t);
                        }
                    }
                }
            }
            out
        }
        UpstreamFormat::OpenAiResponses => {
            if let Some(s) = v.get("output_text").and_then(|x| x.as_str()) {
                return s.to_string();
            }
            let mut out = String::new();
            if let Some(arr) = v.get("output").and_then(|x| x.as_array()) {
                for item in arr {
                    if let Some(content) = item.get("content").and_then(|c| c.as_array()) {
                        for part in content {
                            if let Some(t) = part.get("text").and_then(|t| t.as_str()) {
                                out.push_str(t);
                            }
                        }
                    }
                }
            }
            out
        }
    }
}

/// 若路径超窗则摘要前缀并写入 boundary 的 compaction_summary；返回最终 history。
pub async fn maybe_compact_history(
    db: &DbPool,
    topic_id: &str,
    ep: &Endpoint,
    inbound_model: &str,
    proxy_enabled: bool,
    proxy_url: &str,
    token: &CancellationToken,
) -> AppResult<Vec<(String, String)>> {
    // 先按已有摘要构造
    let base = {
        let conn = db.get()?;
        chat_repo::history_for_api(&conn, topic_id)?
    };
    let total: usize = base.iter().map(|(_, c)| estimate_tokens(c)).sum();
    let trigger = ((DEFAULT_CONTEXT_WINDOW as f64) * TRIGGER_RATIO) as usize;
    if total < trigger {
        return Ok(base);
    }

    let path = {
        let conn = db.get()?;
        chat_repo::path_messages_for_compact(&conn, topic_id)?
    };
    // 去掉空 assistant 占位
    let path: Vec<_> = path
        .into_iter()
        .filter(|m| !(m.role == "assistant" && m.content.is_empty()))
        .filter(|m| m.role == "user" || m.role == "assistant")
        .collect();
    if path.len() < 4 {
        return Ok(base);
    }

    let keep_budget = ((DEFAULT_CONTEXT_WINDOW as f64) * KEEP_RATIO) as usize;
    let mut kept_tokens = 0usize;
    let mut keep_from = path.len();
    while keep_from > 0 {
        let i = keep_from - 1;
        let t = estimate_tokens(&path[i].content);
        if kept_tokens + t > keep_budget && keep_from < path.len() {
            break;
        }
        kept_tokens += t;
        keep_from = i;
    }
    // 至少保留最后一轮 user+assistant
    keep_from = keep_from.min(path.len().saturating_sub(2));
    if keep_from == 0 {
        return Ok(base);
    }

    let prefix: Vec<&_> = path[..keep_from].iter().collect();
    let boundary_id = path[keep_from - 1].id.clone();
    let mut transcript = String::new();
    for m in &prefix {
        transcript.push_str(&format!("{}: {}\n\n", m.role, m.content));
    }
    // 限制摘要输入体积
    if transcript.chars().count() > 60_000 {
        transcript = transcript
            .chars()
            .rev()
            .take(60_000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }

    if token.is_cancelled() {
        return Err(AppError::InvalidArgument("已取消".into()));
    }

    let summary = match summarize(
        ep,
        inbound_model,
        proxy_enabled,
        proxy_url,
        &transcript,
        token,
    )
    .await
    {
        Ok(s) if !s.trim().is_empty() => s.trim().to_string(),
        Ok(_) | Err(_) => {
            if token.is_cancelled() {
                return Err(AppError::InvalidArgument("已取消".into()));
            }
            // ponytail: 压缩失败则降级为未压缩历史；升级可换独立压缩模型或本地截断摘要
            return Ok(base);
        }
    };

    {
        let conn = db.get()?;
        chat_repo::set_compaction_summary(&conn, &boundary_id, &summary)?;
        chat_repo::history_for_api(&conn, topic_id)
    }
}

async fn summarize(
    ep: &Endpoint,
    inbound_model: &str,
    proxy_enabled: bool,
    proxy_url: &str,
    transcript: &str,
    token: &CancellationToken,
) -> AppResult<String> {
    let model = outbound_model(ep, inbound_model);
    let format = UpstreamFormat::from_transformer_name(&ep.transformer);
    let want = should_use_proxy(ep.use_proxy, proxy_enabled, proxy_url);
    let client = build_client(want, proxy_url, Duration::from_secs(120))?;
    let prompt = format!(
        "请将以下对话压缩为简洁的中文摘要，保留关键事实、约束与未决问题，不要编造：\n\n{transcript}"
    );
    let (url, body) = match format {
        UpstreamFormat::OpenAiChat => (
            super::endpoint_api_url(&ep.api_url, "/v1/chat/completions"),
            json!({
                "model": model,
                "messages": [{"role":"user","content": prompt}],
                "max_tokens": 1024,
                "stream": false
            }),
        ),
        UpstreamFormat::Claude => (
            super::endpoint_api_url(&ep.api_url, "/v1/messages"),
            json!({
                "model": model,
                "max_tokens": 1024,
                "messages": [{"role":"user","content": prompt}]
            }),
        ),
        UpstreamFormat::OpenAiResponses => (
            super::endpoint_api_url(&ep.api_url, "/v1/responses"),
            json!({
                "model": model,
                "max_output_tokens": 1024,
                "input": prompt
            }),
        ),
    };
    let req = ProbeAuth::primary_for(&ep.transformer)
        .apply(client.post(&url), &ep.api_key)
        .json(&body);
    let resp = tokio::select! {
        _ = token.cancelled() => return Err(AppError::InvalidArgument("已取消".into())),
        send_result = req.send() => send_result
            .map_err(|e| AppError::InvalidArgument(format!("压缩请求失败: {e}")))?,
    };
    if !resp.status().is_success() {
        return Err(AppError::InvalidArgument(format!(
            "压缩 HTTP {}",
            resp.status().as_u16()
        )));
    }
    let v: Value = tokio::select! {
        _ = token.cancelled() => return Err(AppError::InvalidArgument("已取消".into())),
        parse_result = resp.json() => parse_result
            .map_err(|e| AppError::InvalidArgument(format!("压缩解析失败: {e}")))?,
    };
    Ok(extract_text_response(format, &v))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn estimate_grows_with_text() {
        assert!(estimate_tokens("你好世界") >= 1);
        assert!(estimate_tokens(&"a".repeat(300)) >= 100);
    }
}
