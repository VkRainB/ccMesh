use serde::{Deserialize, Serialize};
use serde_json::Value;

/// pi 配置路径与拆分目录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiConfigPaths {
    pub app_type: String,
    pub agent_dir: String,
    pub models_path: String,
    pub settings_path: String,
    pub profiles_dir: String,
    pub models_format: String,
    pub settings_format: String,
    pub models_exists: bool,
    pub settings_exists: bool,
}

/// pi 当前默认模型选择：`defaultProvider` + `defaultModel`，无思考档位。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiDefaultSelection {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub selector: Option<String>,
}

/// pi 拆分渠道列表项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderMeta {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub order: usize,
    pub model_count: usize,
    pub is_default: bool,
    pub updated_at: String,
    pub configured_at: String,
    pub applied_at: Option<String>,
}

/// pi 页面进入时需要的完整状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiWorkspaceState {
    pub paths: PiConfigPaths,
    pub providers: Vec<PiProviderMeta>,
    pub default_selection: PiDefaultSelection,
    pub models_text: String,
    pub settings_text: String,
}

/// pi 单个拆分渠道详情。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderData {
    pub meta: PiProviderMeta,
    pub provider_json: Value,
    pub provider_text: String,
    pub models_text: String,
    pub settings_text: String,
    pub paths: PiConfigPaths,
    pub default_selection: PiDefaultSelection,
}

/// pi 保存单个拆分渠道请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePiProviderRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub enabled: bool,
    pub order: usize,
    pub provider_json: Value,
}

/// pi 应用请求（无 thinking_level）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPiConfigRequest {
    pub items: Vec<crate::modules::tool_config::pi_omp_common::ApplyItem>,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
}

/// pi 应用结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyPiConfigResult {
    pub paths: PiConfigPaths,
    pub providers: Vec<PiProviderMeta>,
    pub default_selection: PiDefaultSelection,
    pub enabled_count: usize,
}
