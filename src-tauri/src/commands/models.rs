use std::time::Duration;

use chrono::Utc;
use serde_json::{json, Value};
use tauri::State;

use crate::error::AppResult;
use crate::modules::models_cache::{default_model, fetch_models, model_info, save_display_names};
use crate::modules::models_probe::probe_model_entries;
use crate::modules::proxy::client::{build_client, should_use_proxy};
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
    let (proxy_enabled, proxy_url) = {
        let conn = state.db_pool.get()?;
        let cfg = config_repo::get_config(&conn)?;
        (cfg.proxy_enabled, cfg.proxy_url)
    };
    // 两个 client：直连 + 经代理（地址非空时）；按每端点 use_proxy||proxy_enabled 选用。
    let direct = build_client(false, "", Duration::from_secs(15))?;
    let proxied = if proxy_url.trim().is_empty() {
        None
    } else {
        Some(build_client(true, &proxy_url, Duration::from_secs(15))?)
    };

    let mut all = Vec::new();
    for ep in &endpoints {
        let want = should_use_proxy(ep.use_proxy, proxy_enabled, &proxy_url);
        let client = if want {
            proxied.as_ref().unwrap_or(&direct)
        } else {
            &direct
        };
        let models = fetch_models(client, ep).await;
        if models.is_empty() {
            all.push(model_info(default_model(ep), &ep.name, None));
            continue;
        }
        {
            let conn = state.db_pool.get()?;
            save_display_names(&conn, &ep.api_url, &models)?;
        }
        all.extend(models.iter().map(|m| model_info(&m.id, &ep.name, Some(&m.display_name))));
    }

    {
        let mut cache = state.models_cache.lock().unwrap();
        cache.models = all.clone();
        cache.updated_at = Some(Utc::now());
    }
    Ok(json!({ "object": "list", "data": all }))
}

/// 拉取指定上游端点的可用模型 id 列表（供端点表单「刷新」按钮；端点可能尚未保存，故按字段传参）。
/// 走鉴权聚合 + URL 候选探测策略，提高未知协议端点的成功率。
/// 代理决策：表单的 use_proxy 或全局 proxyEnabled（且地址非空）。
#[tauri::command]
pub async fn fetch_endpoint_models(
    state: State<'_, AppState>,
    api_url: String,
    api_key: String,
    transformer: String,
    use_proxy: Option<bool>,
) -> AppResult<Vec<String>> {
    let (proxy_enabled, proxy_url) = {
        let conn = state.db_pool.get()?;
        let cfg = config_repo::get_config(&conn)?;
        (cfg.proxy_enabled, cfg.proxy_url)
    };
    let want = should_use_proxy(use_proxy.unwrap_or(false), proxy_enabled, &proxy_url);
    let client = build_client(want, &proxy_url, Duration::from_secs(15))?;
    let models = probe_model_entries(&client, &api_url, &api_key, &transformer).await;
    let conn = state.db_pool.get()?;
    save_display_names(&conn, &api_url, &models)?;
    Ok(models.into_iter().map(|m| m.id).collect())
}
