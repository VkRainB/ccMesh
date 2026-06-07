use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::json;
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::endpoint::{CreateEndpointRequest, Endpoint, UpdateEndpointRequest};
use crate::modules::storage::{config_repo, endpoint_repo};
use crate::modules::transform::transformer::UpstreamFormat;
use crate::state::AppState;
use crate::utils::ua;

#[tauri::command]
pub fn list_endpoints(state: State<AppState>) -> AppResult<Vec<Endpoint>> {
    let conn = state.db_pool.get()?;
    endpoint_repo::list_all(&conn)
}

#[tauri::command]
pub fn create_endpoint(
    state: State<AppState>,
    req: CreateEndpointRequest,
) -> AppResult<Endpoint> {
    let conn = state.db_pool.get()?;
    endpoint_repo::create(&conn, &req)
}

#[tauri::command]
pub fn update_endpoint(
    state: State<AppState>,
    id: i64,
    req: UpdateEndpointRequest,
) -> AppResult<Endpoint> {
    let conn = state.db_pool.get()?;
    endpoint_repo::update(&conn, id, &req)
}

#[tauri::command]
pub fn delete_endpoint(state: State<AppState>, id: i64) -> AppResult<()> {
    let conn = state.db_pool.get()?;
    endpoint_repo::delete(&conn, id)
}

#[tauri::command]
pub fn reorder_endpoints(state: State<AppState>, ordered_ids: Vec<i64>) -> AppResult<()> {
    let mut conn = state.db_pool.get()?;
    endpoint_repo::reorder(&mut conn, &ordered_ids)
}

/// 克隆端点：名称自动加 `(副本)` 后缀并避免冲突。
#[tauri::command]
pub fn clone_endpoint(state: State<AppState>, id: i64) -> AppResult<Endpoint> {
    let conn = state.db_pool.get()?;
    let src = endpoint_repo::get_by_id(&conn, id)?
        .ok_or_else(|| AppError::NotFound(format!("端点 #{id} 不存在")))?;
    let base = extract_base_name(&src.name);
    let name = unique_clone_name(&conn, &base)?;
    let req = CreateEndpointRequest {
        name,
        api_url: src.api_url,
        api_key: src.api_key,
        auth_mode: src.auth_mode,
        enabled: src.enabled,
        use_proxy: src.use_proxy,
        transformer: src.transformer,
        model: src.model,
        models: src.models,
        remark: src.remark,
    };
    endpoint_repo::create(&conn, &req)
}

fn extract_base_name(name: &str) -> String {
    let n = name.trim();
    for marker in ["(副本)", "(Copy)"] {
        if let Some(pos) = n.rfind(marker) {
            let rest = n[pos + marker.len()..].trim();
            if rest.is_empty() || rest.chars().all(|c| c.is_ascii_digit()) {
                return n[..pos].trim().to_string();
            }
        }
    }
    n.to_string()
}

fn unique_clone_name(conn: &rusqlite::Connection, base: &str) -> AppResult<String> {
    let first = format!("{base}(副本)");
    if endpoint_repo::get_by_name(conn, &first)?.is_none() {
        return Ok(first);
    }
    let mut i = 1;
    loop {
        let cand = format!("{base}(副本) {i}");
        if endpoint_repo::get_by_name(conn, &cand)?.is_none() {
            return Ok(cand);
        }
        i += 1;
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub success: bool,
    pub status: String, // available / unavailable
    pub latency_ms: u64,
    pub message: String,
}

/// 探测端点连通性：发送最小请求，200 即可用；持久化 test_status。
#[tauri::command]
pub async fn test_endpoint(
    state: State<'_, AppState>,
    id: i64,
    model: Option<String>,
) -> AppResult<TestResult> {
    let ep = {
        let conn = state.db_pool.get()?;
        endpoint_repo::get_by_id(&conn, id)?
            .ok_or_else(|| AppError::NotFound(format!("端点 #{id} 不存在")))?
    };

    // 测试 client 遵循端点代理配置：use_proxy 且配置了全局代理则走代理，否则直连（显式禁用系统代理）
    let proxy_url = {
        let conn = state.db_pool.get()?;
        config_repo::get_value(&conn, "proxyUrl")?.unwrap_or_default()
    };
    let mut builder = reqwest::Client::builder().timeout(Duration::from_secs(30));
    builder = match proxy_url.trim() {
        p if ep.use_proxy && !p.is_empty() => match reqwest::Proxy::all(p) {
            Ok(proxy) => builder.proxy(proxy),
            Err(_) => builder.no_proxy(),
        },
        _ => builder.no_proxy(),
    };
    let client = builder
        .build()
        .map_err(|e| AppError::Proxy(format!("构建测试客户端失败: {e}")))?;

    let base = ep.api_url.trim_end_matches('/');
    let format = UpstreamFormat::from_transformer_name(&ep.transformer);
    // 优先用调用方指定的模型（前端选择），否则端点锁定 model，再否则按格式回落默认
    let fallback = match format {
        UpstreamFormat::OpenAiChat => "gpt-4o-mini",
        UpstreamFormat::Claude => "claude-3-5-sonnet-latest",
    };
    let model_str = model.filter(|s| !s.trim().is_empty()).unwrap_or_else(|| {
        if ep.model.is_empty() {
            fallback.to_string()
        } else {
            ep.model.clone()
        }
    });
    let model = model_str.as_str();

    let (url, builder) = match format {
        UpstreamFormat::OpenAiChat => {
            let url = format!("{base}/v1/chat/completions");
            let b = client
                .post(&url)
                .header("user-agent", ua::codex_probe_ua())
                .header("originator", ua::CODEX_ORIGINATOR)
                .header("authorization", format!("Bearer {}", ep.api_key))
                .json(&json!({
                    "model": model, "max_tokens": 16,
                    "messages": [{ "role": "user", "content": "ping" }]
                }));
            (url, b)
        }
        UpstreamFormat::Claude => {
            let url = format!("{base}/v1/messages");
            let b = client
                .post(&url)
                .header("user-agent", ua::CLAUDE_PROBE_UA)
                .header("x-api-key", &ep.api_key)
                .header("anthropic-version", "2023-06-01")
                .json(&json!({
                    "model": model, "max_tokens": 16,
                    "messages": [{ "role": "user", "content": "ping" }]
                }));
            (url, b)
        }
    };
    let _ = url;

    let start = Instant::now();
    let result = builder.send().await;
    let latency_ms = start.elapsed().as_millis() as u64;

    let (success, status, message) = match result {
        Ok(resp) => {
            let code = resp.status().as_u16();
            if code == 200 {
                (true, "available", "连接成功".to_string())
            } else if code == 401 || code == 403 {
                (false, "unavailable", format!("鉴权失败（HTTP {code}）"))
            } else {
                (false, "unavailable", format!("HTTP {code}"))
            }
        }
        Err(e) => (false, "unavailable", format!("请求失败: {e}")),
    };

    {
        let conn = state.db_pool.get()?;
        endpoint_repo::set_test_status(&conn, id, status)?;
    }

    Ok(TestResult {
        success,
        status: status.to_string(),
        latency_ms,
        message,
    })
}
