use serde::{Deserialize, Serialize};
use serde_json::Value;

/// omp 配置路径与拆分目录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpConfigPaths {
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

/// omp 当前默认模型选择：`modelRoles.default` = `provider/model[:thinkingLevel]`，含思考档位。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpDefaultSelection {
    pub provider: Option<String>,
    pub model: Option<String>,
    pub thinking_level: Option<String>,
    pub selector: Option<String>,
}

/// omp 拆分渠道列表项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpProviderMeta {
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

/// omp 页面进入时需要的完整状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpWorkspaceState {
    pub paths: OmpConfigPaths,
    pub providers: Vec<OmpProviderMeta>,
    pub default_selection: OmpDefaultSelection,
    pub models_text: String,
    pub settings_text: String,
}

/// omp 单个拆分渠道详情。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OmpProviderData {
    pub meta: OmpProviderMeta,
    pub provider_json: Value,
    pub provider_text: String,
    pub models_text: String,
    pub settings_text: String,
    pub paths: OmpConfigPaths,
    pub default_selection: OmpDefaultSelection,
}

/// omp 保存单个拆分渠道请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOmpProviderRequest {
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    pub enabled: bool,
    pub order: usize,
    pub provider_json: Value,
}

/// omp 应用请求（含 thinking_level）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOmpConfigRequest {
    pub items: Vec<crate::modules::tool_config::pi_omp_common::ApplyItem>,
    #[serde(default)]
    pub default_provider: Option<String>,
    #[serde(default)]
    pub default_model: Option<String>,
    #[serde(default)]
    pub thinking_level: Option<String>,
}

/// omp 应用结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyOmpConfigResult {
    pub paths: OmpConfigPaths,
    pub providers: Vec<OmpProviderMeta>,
    pub default_selection: OmpDefaultSelection,
    pub enabled_count: usize,
}
