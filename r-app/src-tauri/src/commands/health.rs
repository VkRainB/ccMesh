use serde::Serialize;
use tauri::State;

use crate::error::AppResult;
use crate::modules::proxy::circuit_breaker::EndpointHealthInfo;
use crate::modules::storage::endpoint_repo;
use crate::state::AppState;
use crate::utils::mask::mask_api_key;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskedEndpoint {
    pub name: String,
    pub api_url: String,
    pub masked_key: String,
    pub enabled: bool,
    pub test_status: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthInfo {
    pub status: String,
    pub device_id: String,
    pub proxy_running: bool,
    pub enabled_endpoints: i64,
    pub endpoints: Vec<MaskedEndpoint>,
}

/// 健康概览：状态、设备 ID、代理运行态、启用端点数、脱敏端点列表。
#[tauri::command]
pub fn get_health(state: State<AppState>) -> AppResult<HealthInfo> {
    let conn = state.db_pool.get()?;
    let all = endpoint_repo::list_all(&conn)?;
    let enabled_endpoints = all.iter().filter(|e| e.enabled).count() as i64;
    let endpoints = all
        .into_iter()
        .map(|e| MaskedEndpoint {
            name: e.name,
            api_url: e.api_url,
            masked_key: mask_api_key(&e.api_key),
            enabled: e.enabled,
            test_status: e.test_status,
        })
        .collect();
    let proxy_running = state.proxy.lock().unwrap().is_some();
    Ok(HealthInfo {
        status: "ok".to_string(),
        device_id: state.device_id.clone(),
        proxy_running,
        enabled_endpoints,
        endpoints,
    })
}

/// 端点实时健康/熔断态：代理运行时读运行期熔断器；未运行时按库内 test_status 回退。
#[tauri::command]
pub fn get_endpoint_health(state: State<AppState>) -> AppResult<Vec<EndpointHealthInfo>> {
    let conn = state.db_pool.get()?;
    let enabled = endpoint_repo::list_enabled(&conn)?;
    let guard = state.proxy.lock().unwrap();
    let infos = match guard.as_ref() {
        Some(h) => enabled
            .iter()
            .map(|e| h.state.breakers.health_of(&e.name))
            .collect(),
        None => enabled
            .iter()
            .map(|e| EndpointHealthInfo::from_test_status(&e.name, &e.test_status))
            .collect(),
    };
    Ok(infos)
}
