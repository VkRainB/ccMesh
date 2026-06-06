use std::collections::{BTreeMap, HashMap};

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::config::AppConfig;
use crate::modules::proxy::server::start_proxy as start_server;
use crate::modules::storage::config_repo;
use crate::state::AppState;

#[tauri::command]
pub fn get_config(state: State<AppState>) -> AppResult<AppConfig> {
    let conn = state.db_pool.get()?;
    config_repo::get_config(&conn)
}

#[tauri::command]
pub fn get_all_config(state: State<AppState>) -> AppResult<BTreeMap<String, String>> {
    let conn = state.db_pool.get()?;
    config_repo::get_all(&conn)
}

/// 写入若干配置键；端口变更且代理运行中则在新端口重启代理。
#[tauri::command]
pub async fn set_config(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: HashMap<String, String>,
) -> AppResult<AppConfig> {
    let needs_restart = {
        let conn = state.db_pool.get()?;
        let old_port = config_repo::get_value(&conn, "port")?;
        for (k, v) in &patch {
            config_repo::set_value(&conn, k, v)?;
        }
        let port_changed = patch.contains_key("port") && patch.get("port") != old_port.as_ref();
        // 代理地址 / 伪装 UA 变更需重建转发 client → 重启代理使其生效
        let proxy_or_ua_changed = patch.contains_key("proxyUrl")
            || patch.contains_key("openaiUa")
            || patch.contains_key("claudeCliUa");
        port_changed || proxy_or_ua_changed
    };

    if needs_restart {
        let handle = state.proxy.lock().unwrap().take();
        if let Some(h) = handle {
            h.stop().await;
            let port = {
                let conn = state.db_pool.get()?;
                config_repo::get_value(&conn, "port")?
                    .and_then(|v| v.parse().ok())
                    .unwrap_or(3000u16)
            };
            let new_handle =
                start_server(app.clone(), state.db_pool.clone(), port, state.stats.clone()).await?;
            *state.proxy.lock().unwrap() = Some(new_handle);
        }
    }

    let conn = state.db_pool.get()?;
    config_repo::get_config(&conn)
}
