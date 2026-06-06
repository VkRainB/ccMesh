use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use axum::body::{Body, Bytes};
use axum::extract::State;
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

use futures::StreamExt;
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::models::endpoint::Endpoint;
use crate::modules::proxy::resolver;
use crate::modules::proxy::rotation::{self, Rotation};
use crate::modules::stats::aggregator::StatsAggregator;
use crate::modules::storage::{db::DbPool, endpoint_repo};
use crate::modules::transform::claude_openai::openai_response_to_claude;
use crate::modules::transform::streaming::StreamConverter;
use crate::modules::transform::transformer::{get_transformer, UpstreamFormat};

/// 每端点在途请求计数 + 取消令牌（手动切换时中止在途请求）。
#[derive(Default)]
pub struct ActiveRequests {
    inner: Mutex<HashMap<String, ActiveEntry>>,
}

struct ActiveEntry {
    count: usize,
    token: CancellationToken,
}

impl ActiveRequests {
    /// 标记一个请求开始，返回该端点的取消令牌。
    pub fn start(&self, name: &str) -> CancellationToken {
        let mut g = self.inner.lock().unwrap();
        let entry = g.entry(name.to_string()).or_insert_with(|| ActiveEntry {
            count: 0,
            token: CancellationToken::new(),
        });
        entry.count += 1;
        entry.token.clone()
    }

    pub fn finish(&self, name: &str) {
        let mut g = self.inner.lock().unwrap();
        if let Some(e) = g.get_mut(name) {
            e.count = e.count.saturating_sub(1);
        }
    }

    pub fn has_active(&self, name: &str) -> bool {
        self.inner
            .lock()
            .unwrap()
            .get(name)
            .map(|e| e.count > 0)
            .unwrap_or(false)
    }

    /// 取消该端点所有在途请求并换发新令牌（手动切换用）。
    pub fn cancel(&self, name: &str) {
        let mut g = self.inner.lock().unwrap();
        if let Some(e) = g.get_mut(name) {
            e.token.cancel();
            e.token = CancellationToken::new();
        }
    }
}

/// 客户端未提供 UA 且未配置伪装 UA 时的中性默认（避免泄露 reqwest 默认 UA）。
const DEFAULT_UA: &str = "ccnexus/1.0";

/// 代理运行期共享状态，注入 axum 处理器。
pub struct ProxyState {
    pub db_pool: DbPool,
    pub client: reqwest::Client,
    /// 全局代理 client（配置了 proxy_url 时构建；端点 use_proxy 为真时使用）。
    pub proxy_client: Option<reqwest::Client>,
    /// 伪装 UA：转发到 OpenAI 端点时覆盖 User-Agent（空=透传客户端）。
    pub openai_ua: String,
    /// 伪装 UA：转发到 Claude 端点时覆盖 User-Agent（空=透传客户端）。
    pub claude_cli_ua: String,
    pub rotation: Rotation,
    pub active: ActiveRequests,
    pub app_handle: AppHandle,
    pub stats: Arc<StatsAggregator>,
    pub current_endpoint: Mutex<Option<String>>,
}

impl ProxyState {
    pub fn current_endpoint_name(&self) -> Option<String> {
        self.current_endpoint.lock().unwrap().clone()
    }
    fn set_current(&self, name: &str) {
        *self.current_endpoint.lock().unwrap() = Some(name.to_string());
    }
}

fn json_error(status: StatusCode, message: &str) -> Response {
    (
        status,
        axum::Json(serde_json::json!({
            "error": { "type": "proxy_error", "message": message }
        })),
    )
        .into_response()
}

fn urldecode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// 主代理处理器：解析端点 → 轮换/故障转移重试 → 转发上游 → 直通响应。
pub async fn handle_proxy(
    State(st): State<Arc<ProxyState>>,
    method: Method,
    uri: Uri,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let path = uri.path().to_string();

    // 解析请求体（model / stream / 供转换复用）
    let body_json: Option<Value> = serde_json::from_slice(&body).ok();
    let model: Option<String> = body_json
        .as_ref()
        .and_then(|v| v.get("model").and_then(|m| m.as_str()).map(String::from));
    let client_wants_stream = body_json
        .as_ref()
        .and_then(|v| v.get("stream").and_then(|s| s.as_bool()))
        .unwrap_or(false);

    // 头部 map（小写键）
    let mut hmap = HashMap::new();
    for (k, v) in headers.iter() {
        if let Ok(val) = v.to_str() {
            hmap.insert(k.as_str().to_ascii_lowercase(), val.to_string());
        }
    }
    // 查询参数 map（小写键）
    let mut qmap = HashMap::new();
    if let Some(q) = uri.query() {
        for pair in q.split('&') {
            if let Some((k, v)) = pair.split_once('=') {
                qmap.insert(k.to_ascii_lowercase(), urldecode(v));
            }
        }
    }

    // 当前启用端点（每请求读取，反映 CRUD 实时变更）
    let enabled = match st.db_pool.get() {
        Ok(conn) => match endpoint_repo::list_enabled(&conn) {
            Ok(list) => list,
            Err(e) => {
                return json_error(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("加载端点失败: {e}"),
                )
            }
        },
        Err(e) => {
            return json_error(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("数据库连接失败: {e}"),
            )
        }
    };
    if enabled.is_empty() {
        return json_error(StatusCode::SERVICE_UNAVAILABLE, "没有启用的端点");
    }

    // 入站格式识别（问题6 最小版）：/v1/chat/completions = OpenAI 入站。
    // OpenAI 入站只透传到 OpenAI 端点，故候选过滤为 transformer=openai；为空则 400。
    let inbound_openai = path.contains("/chat/completions");
    let enabled: Vec<Endpoint> = if inbound_openai {
        let filtered: Vec<Endpoint> = enabled
            .into_iter()
            .filter(|e| {
                matches!(
                    UpstreamFormat::from_transformer_name(&e.transformer),
                    UpstreamFormat::OpenAiChat
                )
            })
            .collect();
        if filtered.is_empty() {
            return json_error(
                StatusCode::BAD_REQUEST,
                "OpenAI 入站(/v1/chat/completions)无可用的 OpenAI 端点",
            );
        }
        filtered
    } else {
        enabled
    };

    let resolution = resolver::resolve_endpoint(&hmap, model.as_deref(), &qmap, &enabled);
    if let Some(msg) = resolution.not_found {
        return json_error(StatusCode::BAD_REQUEST, &msg);
    }
    let use_specific = resolution.use_specific();
    let n = enabled.len();
    let max = if use_specific {
        3
    } else {
        rotation::max_retries(n).max(1)
    };

    let mut attempts_on_current = 0u32;
    let mut last_err = String::new();
    let mut last_endpoint = String::new();

    for _ in 0..max {
        let ep: Endpoint = if let Some(ref e) = resolution.endpoint {
            e.clone()
        } else {
            let idx = st.rotation.current_index(n).unwrap_or(0);
            enabled[idx].clone()
        };
        st.set_current(&ep.name);
        last_endpoint = ep.name.clone();

        let format = UpstreamFormat::from_transformer_name(&ep.transformer);
        // 仅「Claude 入站 + OpenAI 端点」需要请求/响应格式转换；其余（含 OpenAI 入站透传、Claude 直通）不转换。
        let needs_transform = !inbound_openai && matches!(format, UpstreamFormat::OpenAiChat);
        let attempt_body: Bytes = if needs_transform {
            // Claude → OpenAI（transform_request 内部按 ep.model 覆盖，空则透传客户端 model）
            match &body_json {
                Some(cj) => get_transformer(format)
                    .transform_request(cj, Some(&ep.model))
                    .ok()
                    .and_then(|v| serde_json::to_vec(&v).ok())
                    .map(Bytes::from)
                    .unwrap_or_else(|| body.clone()),
                None => body.clone(),
            }
        } else if !ep.model.is_empty() {
            // 直通场景的 model 锁定：覆盖请求体 model 后重新序列化
            match &body_json {
                Some(cj) => {
                    let mut v = cj.clone();
                    if let Some(o) = v.as_object_mut() {
                        o.insert("model".to_string(), Value::String(ep.model.clone()));
                    }
                    serde_json::to_vec(&v).map(Bytes::from).unwrap_or_else(|_| body.clone())
                }
                None => body.clone(),
            }
        } else {
            body.clone()
        };
        let upstream_path = if needs_transform {
            "/v1/chat/completions"
        } else {
            path.as_str()
        };

        let token = st.active.start(&ep.name);
        let result = tokio::select! {
            r = send_upstream(&st, &ep, &method, upstream_path, &headers, &attempt_body) => Some(r),
            _ = token.cancelled() => None,
        };
        st.active.finish(&ep.name);

        match result {
            // 被手动切换取消 → 切到下一个
            None => {
                last_err = "请求被取消".to_string();
                if !use_specific {
                    st.rotation.advance(n);
                }
                attempts_on_current = 0;
            }
            Some(Ok(resp)) => {
                let status = resp.status().as_u16();
                if status == 200 {
                    st.stats.record(&ep.name, false, 0, 0);
                    return if needs_transform {
                        if client_wants_stream {
                            stream_transform_response(resp, model.clone().unwrap_or_default())
                        } else {
                            transform_buffered_response(resp).await
                        }
                    } else {
                        relay_response(resp)
                    };
                }
                if !rotation::should_retry_status(status) {
                    // 最终非重试状态（400/401）原样回传
                    st.stats.record(&ep.name, status >= 400, 0, 0);
                    return relay_response(resp);
                }
                last_err = format!("上游返回 {status}");
                attempts_on_current += 1;
                if attempts_on_current >= rotation::CONSECUTIVE_FAIL_SWITCH && !use_specific {
                    st.rotation.advance(n);
                    attempts_on_current = 0;
                }
            }
            Some(Err(e)) => {
                let msg = e.to_string();
                last_err = msg.clone();
                if rotation::is_transient_network_error(&msg) {
                    // 瞬时错误：延迟后重试同一端点
                    tokio::time::sleep(rotation::TRANSIENT_RETRY_DELAY).await;
                    attempts_on_current = 0;
                } else {
                    attempts_on_current += 1;
                    if attempts_on_current >= rotation::CONSECUTIVE_FAIL_SWITCH && !use_specific {
                        st.rotation.advance(n);
                        attempts_on_current = 0;
                    }
                }
            }
        }
    }

    if !last_endpoint.is_empty() {
        st.stats.record(&last_endpoint, true, 0, 0);
    }
    json_error(
        StatusCode::BAD_GATEWAY,
        &format!("所有端点均失败: {last_err}"),
    )
}

async fn send_upstream(
    st: &ProxyState,
    ep: &Endpoint,
    method: &Method,
    upstream_path: &str,
    headers: &HeaderMap,
    body: &Bytes,
) -> reqwest::Result<reqwest::Response> {
    let base = ep.api_url.trim_end_matches('/');
    let url = format!("{base}{upstream_path}");
    let rmethod =
        reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::POST);

    // 端点级代理：use_proxy 且存在代理 client 时走代理，否则直连
    let client = if ep.use_proxy {
        st.proxy_client.as_ref().unwrap_or(&st.client)
    } else {
        &st.client
    };
    let mut rb = client.request(rmethod, url);

    // 复制客户端头部（剔除 Host / Content-Length / Accept-Encoding / 客户端凭证 / 控制头 / UA）
    for (k, v) in headers.iter() {
        let kn = k.as_str().to_ascii_lowercase();
        if kn == "host"
            || kn == "content-length"
            || kn == "accept-encoding"
            || kn == "authorization"
            || kn == "x-api-key"
            || kn == "user-agent"
            || kn == resolver::ENDPOINT_HEADER
            || kn == resolver::ENDPOINT_HEADER_ALT
        {
            continue;
        }
        if let Ok(val) = v.to_str() {
            rb = rb.header(k.as_str(), val);
        }
    }

    // User-Agent：按上游格式伪装（配置非空则覆盖）；否则透传客户端；客户端也无则用中性默认（不泄露 reqwest 默认）
    let ua_format = UpstreamFormat::from_transformer_name(&ep.transformer);
    let ua_override = match ua_format {
        UpstreamFormat::OpenAiChat => st.openai_ua.trim(),
        UpstreamFormat::Claude => st.claude_cli_ua.trim(),
    };
    let ua = if !ua_override.is_empty() {
        ua_override
    } else {
        headers
            .get(axum::http::header::USER_AGENT)
            .and_then(|v| v.to_str().ok())
            .filter(|s| !s.is_empty())
            .unwrap_or(DEFAULT_UA)
    };
    rb = rb.header("user-agent", ua);

    // 附加鉴权头（按 transformer / auth_mode）
    let key = ep.api_key.as_str();
    if !key.is_empty() {
        match ep.transformer.as_str() {
            "openai" | "openai2" | "openai_chat" => {
                rb = rb.header("authorization", format!("Bearer {key}"));
            }
            _ => {
                rb = rb
                    .header("x-api-key", key)
                    .header("authorization", format!("Bearer {key}"));
            }
        }
    }

    rb.body(body.clone()).send().await
}

/// 将上游响应以字节流直通转发回客户端（兼容 SSE 与普通 JSON）。
fn relay_response(resp: reqwest::Response) -> Response {
    let status = StatusCode::from_u16(resp.status().as_u16()).unwrap_or(StatusCode::BAD_GATEWAY);
    let mut out = HeaderMap::new();
    for (k, v) in resp.headers().iter() {
        let kn = k.as_str().to_ascii_lowercase();
        if kn == "content-length" || kn == "transfer-encoding" || kn == "connection" {
            continue;
        }
        if let (Ok(name), Ok(val)) = (
            HeaderName::from_bytes(k.as_str().as_bytes()),
            HeaderValue::from_bytes(v.as_bytes()),
        ) {
            out.insert(name, val);
        }
    }
    let body = Body::from_stream(resp.bytes_stream());
    let mut response = Response::new(body);
    *response.status_mut() = status;
    *response.headers_mut() = out;
    response
}

/// 非流式 OpenAI 响应 → 缓冲后转换为 Claude JSON 回传。
async fn transform_buffered_response(resp: reqwest::Response) -> Response {
    match resp.text().await {
        Ok(text) => match serde_json::from_str::<Value>(&text) {
            Ok(openai) => (StatusCode::OK, axum::Json(openai_response_to_claude(&openai))).into_response(),
            Err(_) => json_error(StatusCode::BAD_GATEWAY, "上游响应解析失败"),
        },
        Err(e) => json_error(StatusCode::BAD_GATEWAY, &format!("读取上游响应失败: {e}")),
    }
}

/// 流式 OpenAI SSE → 边解析边转换为 Claude SSE 事件流回传。
fn stream_transform_response(resp: reqwest::Response, model: String) -> Response {
    let (tx, rx) = mpsc::channel::<Result<Bytes, std::io::Error>>(32);
    tokio::spawn(async move {
        let mut converter = StreamConverter::new(model, 0);
        let mut stream = resp.bytes_stream();
        let mut buf = String::new();
        while let Some(item) = stream.next().await {
            let chunk = match item {
                Ok(c) => c,
                Err(_) => break,
            };
            buf.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(nl) = buf.find('\n') {
                let line: String = buf[..nl].to_string();
                buf.drain(..=nl);
                let line = line.trim();
                let Some(data) = line.strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data == "[DONE]" {
                    for ev in converter.finish() {
                        let _ = tx.send(Ok(Bytes::from(ev))).await;
                    }
                } else if !data.is_empty() {
                    if let Ok(j) = serde_json::from_str::<Value>(data) {
                        for ev in converter.process_chunk(&j) {
                            let _ = tx.send(Ok(Bytes::from(ev))).await;
                        }
                    }
                }
            }
        }
        // 上游未发 [DONE] 时兜底收尾（finish 幂等）
        for ev in converter.finish() {
            let _ = tx.send(Ok(Bytes::from(ev))).await;
        }
    });

    let body = Body::from_stream(ReceiverStream::new(rx));
    let mut response = Response::new(body);
    response.headers_mut().insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    response
}
