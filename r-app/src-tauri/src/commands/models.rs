use std::time::Duration;

use chrono::Utc;
use serde_json::{json, Value};
use tauri::State;

use crate::error::{AppError, AppResult};
use crate::modules::models_cache::{fetch_model_ids, fetch_models};
use crate::modules::storage::{config_repo, endpoint_repo};
use crate::state::AppState;

/// 模型列表（命中缓存直接返回；`force_refresh` 或过期则按启用端点拉取后缓存）。
#[tauri::command]
pub async fn get_models(
    state: State<'_, AppState>,
    force_refresh: Option<bool>,
) -> AppResult<Value> {
    let force = force_refresh.unwrap_or(false);
    let ttl_min: i64 = {
        let conn = state.db_pool.get()?;
        config_repo::get_value(&conn, "modelsCacheTtl")?
            .and_then(|v| v.parse().ok())
            .unwrap_or(30)
    };

    if !force {
        let cache = state.models_cache.lock().unwrap();
        if let Some(updated) = cache.updated_at {
            if (Utc::now() - updated).num_minutes() < ttl_min {
                return Ok(json!({ "object": "list", "data": cache.models.clone() }));
            }
        }
    }

    let endpoints = {
        let conn = state.db_pool.get()?;
        endpoint_repo::list_enabled(&conn)?
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .no_proxy()
        .build()
        .map_err(|e| AppError::Proxy(format!("构建客户端失败: {e}")))?;

    let mut all = Vec::new();
    for ep in &endpoints {
        all.extend(fetch_models(&client, ep).await);
    }

    {
        let mut cache = state.models_cache.lock().unwrap();
        cache.models = all.clone();
        cache.updated_at = Some(Utc::now());
    }
    Ok(json!({ "object": "list", "data": all }))
}

/// 拉取指定上游端点的可用模型 id 列表（供端点表单「刷新」按钮；端点可能尚未保存，故按字段传参）。
#[tauri::command]
pub async fn fetch_endpoint_models(
    api_url: String,
    api_key: String,
    transformer: String,
) -> AppResult<Vec<String>> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .no_proxy()
        .build()
        .map_err(|e| AppError::Proxy(format!("构建客户端失败: {e}")))?;
    Ok(fetch_model_ids(&client, &api_url, &api_key, &transformer).await)
}
