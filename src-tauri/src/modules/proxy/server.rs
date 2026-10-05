use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::{DefaultBodyLimit, State};
use axum::http::HeaderMap;
use axum::routing::{get, post};
use axum::{
    body::Bytes,
    response::{IntoResponse, Response},
    Json, Router,
};
use serde_json::json;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::error::{AppError, AppResult};
use crate::modules::models_cache::{model_info, read_display_names};
use crate::modules::proxy::circuit_breaker::BreakerRegistry;
use crate::modules::proxy::forward::{handle_proxy, ActiveRequests, ProxyState};
use crate::modules::proxy::rotation::Rotation;
use crate::modules::stats::aggregator::StatsAggregator;
use crate::modules::storage::{config_repo, db::DbPool, endpoint_repo};
use crate::modules::transform::thinking_rectifier::RectifierConfig;

/// 上游空闲读超时：相邻两次读（响应头 / 每个 chunk）之间的最大间隔。
/// ponytail: `read_timeout` 是每次读重置的空闲超时，覆盖等响应头 + 逐 chunk 读体，
/// 不会像 `.timeout()` 那样按总时长截断长流式任务（issue #13）。300s 对齐 Codex `stream_idle_timeout_ms` 默认值。
/// 升级路径：改为可配置（app_config.streamIdleTimeoutSecs）。
const UPSTREAM_READ_TIMEOUT: Duration = Duration::from_secs(300);

/// 代理运行句柄，存于 `AppState.proxy`。持有关停信号、任务句柄与共享状态。
pub struct ProxyHandle {
    pub port: u16,
    shutdown: Option<oneshot::Sender<()>>,
    join: Option<JoinHandle<()>>,
    pub state: Arc<ProxyState>,
}

impl ProxyHandle {
    /// 优雅停止代理服务并释放端口。
    pub async fn stop(mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(j) = self.join.take() {
            let _ = j.await;
        }
    }

    pub fn current_endpoint(&self) -> Option<String> {
        self.state.current_endpoint_name()
    }

    /// 手动切换到指定端点名：定位索引、取消旧端点在途请求、置为当前。
    pub fn switch_endpoint(&self, name: &str) -> AppResult<String> {
        let conn = self.state.db_pool.get()?;
        let enabled = endpoint_repo::list_enabled(&conn)?;
        let idx = enabled
            .iter()
            .position(|e| e.name.eq_ignore_ascii_case(name.trim()))
            .ok_or_else(|| AppError::NotFound(format!("端点 '{name}' 不存在或未启用")))?;

        if let Some(old) = self.state.current_endpoint_name() {
            self.state.active.cancel(&old);
        }
        self.state.rotation.set_index(idx);
        let new_name = enabled[idx].name.clone();
        *self.state.current_endpoint.lock().unwrap() = Some(new_name.clone());
        Ok(new_name)
    }
}

fn build_router(state: Arc<ProxyState>) -> Router {
    Router::new()
        .route("/health", get(health_route))
        .route("/stats", get(stats_route))
        .route("/v1/models", get(models_route).with_state(state.db_pool.clone()))
        .route("/v1/messages/count_tokens", post(count_tokens_route))
        .fallback(handle_proxy)
        .layer(DefaultBodyLimit::disable())
        .with_state(state)
}

/// 在本地端口启动代理服务。返回运行句柄。
pub async fn start_proxy(
    db_pool: DbPool,
    port: u16,
    stats: Arc<StatsAggregator>,
) -> AppResult<ProxyHandle> {
    // ponytail: `read_timeout` 是每次读重置的空闲超时，覆盖等响应头 + 逐 chunk 读体，
    // 不会像 `.timeout()` 那样按总时长截断长流式任务（issue #13）。
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(Duration::from_secs(90))
        .connect_timeout(Duration::from_secs(30))
        .read_timeout(UPSTREAM_READ_TIMEOUT)
        .no_proxy()
        .build()
        .map_err(|e| AppError::Proxy(format!("构建 HTTP 客户端失败: {e}")))?;

    // 读取代理地址与伪装 UA 配置
    let cfg = {
        let conn = db_pool.get()?;
        config_repo::get_config(&conn)?
    };
    let proxy_client = if cfg.proxy_url.trim().is_empty() {
        None
    } else {
        match reqwest::Proxy::all(cfg.proxy_url.trim()) {
            Ok(proxy) => reqwest::Client::builder()
                .pool_max_idle_per_host(10)
                .pool_idle_timeout(Duration::from_secs(90))
                .connect_timeout(Duration::from_secs(30))
                .read_timeout(UPSTREAM_READ_TIMEOUT)
                .proxy(proxy)
                .build()
                .ok(),
            Err(e) => {
                tracing::warn!("代理地址无效，回落直连: {e}");
                None
            }
        }
    };

    let state = Arc::new(ProxyState {
        db_pool,
        client,
        proxy_client,
        openai_ua: cfg.openai_ua,
        claude_cli_ua: cfg.claude_cli_ua,
        rotation: Rotation::new(),
        active: ActiveRequests::default(),
        stats,
        current_endpoint: Mutex::new(None),
        proxy_enabled: cfg.proxy_enabled,
        breakers: BreakerRegistry::new(),
        rectifier_config: RectifierConfig::default(),
    });

    let app = build_router(state.clone());

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| AppError::Proxy(format!("绑定端口 {port} 失败: {e}")))?;
    let actual_port = listener.local_addr().map(|a| a.port()).unwrap_or(port);

    let (tx, rx) = oneshot::channel::<()>();
    let join = tokio::spawn(async move {
        let server = axum::serve(listener, app).with_graceful_shutdown(async move {
            let _ = rx.await;
        });
        if let Err(e) = server.await {
            tracing::error!("代理服务退出: {e}");
        }
    });

    tracing::info!(port = actual_port, "代理服务启动");
    Ok(ProxyHandle {
        port: actual_port,
        shutdown: Some(tx),
        join: Some(join),
        state,
    })
}

async fn health_route() -> Response {
    Json(json!({ "status": "healthy" })).into_response()
}

async fn stats_route() -> Response {
    Json(json!({})).into_response()
}

/// `/v1/models`：按启用端点的配置态模型清单聚合（读库，不请求上游）。
/// 专用型端点（model 非空）公布锁定模型；聚合型端点展开 models 清单。
/// 按入站鉴权格式返回：带 x-api-key/anthropic-version → Anthropic 格式；否则 OpenAI 格式。
async fn models_route(State(db_pool): State<DbPool>, headers: HeaderMap) -> Response {
    let mut display_names = HashMap::new();
    let pairs: Vec<(String, String)> = match db_pool.get() {
        Ok(conn) => match endpoint_repo::list_enabled(&conn) {
            Ok(endpoints) => {
                let saved_names = read_display_names(&conn).unwrap_or_default();
                let mut pairs = Vec::new();
                for ep in &endpoints {
                    for id in crate::modules::proxy::resolver::advertised_models(ep) {
                        let name = saved_names.get(ep.api_url.trim()).and_then(|names| names.get(&id))
                            .map(String::as_str).filter(|s| !s.trim().is_empty()).unwrap_or(&id);
                        display_names.entry(id.to_lowercase()).or_insert_with(|| name.to_owned());
                        pairs.push((id, ep.name.clone()));
                    }
                }
                pairs
            },
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    };

    // 跨端点去重（大小写不敏感，保留首次出现），与对外公布模型口径一致，
    // 避免多个端点公布同名模型时 /v1/models 出现重复项（拉取模型下拉重复）。
    let pairs = crate::modules::proxy::resolver::dedup_advertised_pairs(pairs);

    let anthropic = headers.contains_key("x-api-key") || headers.contains_key("anthropic-version");
    if anthropic {
        // Anthropic 格式：data[].{id,type,display_name,created_at} + first_id/last_id/has_more
        let data: Vec<serde_json::Value> = pairs
            .iter()
            .map(|(id, _)| {
                json!({
                    "id": id,
                    "type": "model",
                    "display_name": display_names.get(&id.to_lowercase()).map(String::as_str).unwrap_or(id),
                    "created_at": "2025-01-01T00:00:00Z"
                })
            })
            .collect();
        // 空列表时 first_id/last_id 为 null（对齐官方 Anthropic 行为）
        let first_id = pairs.first().map(|(id, _)| id.as_str());
        let last_id = pairs.last().map(|(id, _)| id.as_str());
        Json(json!({
            "data": data,
            "first_id": first_id,
            "last_id": last_id,
            "has_more": false
        }))
        .into_response()
    } else {
        // OpenAI 格式，同时提供上游友好展示名称。
        let data: Vec<serde_json::Value> = pairs
            .iter()
            .map(|(id, name)| model_info(id, name, display_names.get(&id.to_lowercase()).map(String::as_str)))
            .collect();
        Json(json!({ "object": "list", "data": data })).into_response()
    }
}

/// `/v1/messages/count_tokens`：解析请求体 system/messages，返回输入 token 估算。
async fn count_tokens_route(body: Bytes) -> Response {
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap_or(serde_json::Value::Null);
    let system = json.get("system");
    let messages = json.get("messages").cloned().unwrap_or_else(|| json!([]));
    let input = crate::modules::tokens::estimate_input_tokens(system, &messages);
    Json(json!({ "input_tokens": input })).into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::models_cache::{read_display_names, save_display_names};
    use crate::modules::models_probe::probe_model_entries;
    use crate::modules::storage::{db::create_pool, migration::run_migrations};

    #[tokio::test]
    async fn model_display_names_survive_refresh_restart_and_external_formats() {
        let upstream = Router::new().route("/v1/models", get(|| async {
            Json(json!({"data": [
                {"id": "gpt-5.5", "display_name": " GPT-5.5 "},
                {"id": "unnamed", "display_name": 17},
                {"id": "blank", "display_name": "  "},
                {"id": "hidden", "display_name": "Hidden"},
                {"id": " "}, {"id": 42}
            ]}))
        }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let api_url = format!("http://{}", listener.local_addr().unwrap());
        let upstream_task = tokio::spawn(async move { axum::serve(listener, upstream).await.unwrap(); });
        let client = reqwest::Client::builder().no_proxy().timeout(Duration::from_secs(3)).build().unwrap();
        let models = probe_model_entries(&client, &api_url, "test", "openai").await;
        assert_eq!(models.iter().map(|m| (m.id.as_str(), m.display_name.as_str())).collect::<Vec<_>>(),
            vec![("gpt-5.5", "GPT-5.5"), ("unnamed", "unnamed"), ("blank", "blank"), ("hidden", "Hidden")]);
        upstream_task.abort(); // 对外路由必须不依赖上游继续在线。

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("models.db");
        {
            let pool = create_pool(&path).unwrap();
            let conn = pool.get().unwrap();
            run_migrations(&conn).unwrap();
            conn.execute("INSERT INTO endpoints(name,api_url,api_key,enabled,transformer,models,active_models,model_mappings,model_mappings_enabled)
                VALUES('first',?1,'test',1,'openai','[\"gpt-5.5\",\"unnamed\",\"blank\",\"hidden\"]','[\"gpt-5.5\",\"unnamed\",\"blank\"]','[{\"from\":\"alias\",\"to\":\"gpt-5.5\"}]',1)", [&api_url]).unwrap();
            conn.execute("INSERT INTO endpoints(name,api_url,api_key,enabled,transformer,models) VALUES('second','https://other.invalid','test',1,'openai','[\"GPT-5.5\",\"legacy\"]')", []).unwrap();
            save_display_names(&conn, &api_url, &models).unwrap();
            save_display_names(&conn, &api_url, &[]).unwrap();
            let bundle = crate::modules::backup::build_config_bundle(&conn).unwrap();
            let mut imported = rusqlite::Connection::open_in_memory().unwrap();
            run_migrations(&imported).unwrap();
            crate::modules::backup::import_config_bundle(&mut imported, &bundle, false).unwrap();
            assert_eq!(read_display_names(&imported).unwrap()[&api_url]["gpt-5.5"], "GPT-5.5");
        }
        let pool = create_pool(&path).unwrap();
        let app = Router::new().route("/v1/models", get(models_route)).with_state(pool);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/v1/models", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
        for anthropic in [false, true] {
            let mut request = client.get(&url);
            if anthropic { request = request.header("anthropic-version", "2023-06-01"); }
            let response: serde_json::Value = request.send().await.unwrap().error_for_status().unwrap().json().await.unwrap();
            let data = response["data"].as_array().unwrap();
            assert_eq!(data.iter().map(|m| (m["id"].as_str().unwrap(), m["display_name"].as_str().unwrap())).collect::<Vec<_>>(),
                vec![("gpt-5.5", "GPT-5.5"), ("unnamed", "unnamed"), ("blank", "blank"), ("alias", "alias"), ("legacy", "legacy")]);
            if anthropic {
                assert_eq!(response["first_id"], "gpt-5.5");
                assert_eq!(response["last_id"], "legacy");
                assert_eq!(response["has_more"], false);
            } else {
                assert_eq!(response["object"], "list");
                assert_eq!(data[0]["owned_by"], "first");
            }
        }
        task.abort();
    }
}
