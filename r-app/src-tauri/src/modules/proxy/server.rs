use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::State;
use axum::routing::{get, post};
use axum::{
    body::Bytes,
    response::{IntoResponse, Response},
    Json, Router,
};
use serde_json::json;
use tauri::AppHandle;
use tokio::sync::oneshot;
use tokio::task::JoinHandle;

use crate::error::{AppError, AppResult};
use crate::modules::models_cache::model_info;
use crate::modules::proxy::forward::{handle_proxy, ActiveRequests, ProxyState};
use crate::modules::proxy::rotation::Rotation;
use crate::modules::stats::aggregator::StatsAggregator;
use crate::modules::storage::{config_repo, db::DbPool, endpoint_repo};

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
        .route("/v1/models", get(models_route))
        .route("/v1/messages/count_tokens", post(count_tokens_route))
        .fallback(handle_proxy)
        .with_state(state)
}

/// 在本地端口启动代理服务。返回运行句柄。
pub async fn start_proxy(
    app_handle: AppHandle,
    db_pool: DbPool,
    port: u16,
    stats: Arc<StatsAggregator>,
) -> AppResult<ProxyHandle> {
    let client = reqwest::Client::builder()
        .pool_max_idle_per_host(10)
        .pool_idle_timeout(Duration::from_secs(90))
        .timeout(Duration::from_secs(300))
        .connect_timeout(Duration::from_secs(30))
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
                .timeout(Duration::from_secs(300))
                .connect_timeout(Duration::from_secs(30))
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
        app_handle,
        stats,
        current_endpoint: Mutex::new(None),
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

    tracing::info!(port = actual_port, "代理服务已启动");
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
async fn models_route(State(st): State<Arc<ProxyState>>) -> Response {
    let data: Vec<serde_json::Value> = match st.db_pool.get() {
        Ok(conn) => match endpoint_repo::list_enabled(&conn) {
            Ok(endpoints) => endpoints
                .iter()
                .flat_map(|ep| {
                    if !ep.model.is_empty() {
                        vec![model_info(&ep.model, &ep.name)]
                    } else {
                        ep.models.iter().map(|m| model_info(m, &ep.name)).collect()
                    }
                })
                .collect(),
            Err(_) => Vec::new(),
        },
        Err(_) => Vec::new(),
    };
    Json(json!({ "object": "list", "data": data })).into_response()
}

// Token 计数在 P4-8 实现；先返回占位。
async fn count_tokens_route(_body: Bytes) -> Response {
    Json(json!({ "input_tokens": 0 })).into_response()
}
