use std::collections::BTreeMap;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::models::endpoint::Endpoint;
use crate::modules::models_probe::{self, ModelEntry, ProbeAuth};
use crate::modules::storage::config_repo;
use crate::error::AppResult;
use crate::modules::transform::transformer::UpstreamFormat;

pub fn default_model(ep: &Endpoint) -> &str {
    if ep.model.is_empty() {
        UpstreamFormat::from_transformer_name(&ep.transformer).default_model()
    } else {
        ep.model.as_str()
    }
}

pub fn model_info(id: &str, endpoint_name: &str, display_name: Option<&str>) -> Value {
    json!({
        "id": id,
        "display_name": display_name.map(str::trim).filter(|s| !s.is_empty()).unwrap_or(id),
        "object": "model",
        "created": 1_735_689_600,
        "owned_by": endpoint_name,
        "endpoint_id": endpoint_name
    })
}

/// 名称是上游目录元数据，不是端点路由配置；同一 API base 的端点及克隆共享。
/// ponytail: 复用 app_config 的 JSON 索引，无需迁移端点表；目录量显著增长时改为独立表。
pub type ModelDisplayNames = BTreeMap<String, BTreeMap<String, String>>;
pub const DISPLAY_NAMES_KEY: &str = "modelDisplayNames";

pub fn read_display_names(conn: &Connection) -> AppResult<ModelDisplayNames> {
    Ok(config_repo::get_value(conn, DISPLAY_NAMES_KEY)?
        .and_then(|value| serde_json::from_str(&value).ok()).unwrap_or_default())
}

pub fn save_display_names(conn: &Connection, api_url: &str, models: &[ModelEntry]) -> AppResult<()> {
    if models.is_empty() { return Ok(()); }
    let mut names = read_display_names(conn)?;
    names.entry(api_url.trim().to_owned()).or_default().extend(
        models.iter().map(|m| (m.id.clone(), m.display_name.clone())));
    config_repo::set_value(conn, DISPLAY_NAMES_KEY, &serde_json::to_string(&names)?)
}

/// 拉取上游目录；失败时不覆盖本地名称，聚合命令单独构造默认项。
pub async fn fetch_models(client: &reqwest::Client, ep: &Endpoint) -> Vec<ModelEntry> {
    let url = models_probe::models_url_from_base(&ep.api_url);
    models_probe::request_models(client, &url, &ep.api_key, ProbeAuth::primary_for(&ep.transformer)).await
}
