use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Claude Desktop 3P 路径解析结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopPathsDto {
    pub supported: bool,
    pub platform: String,
    pub threep_root_logical: Option<String>,
    pub threep_root_resolved: Option<String>,
    pub config_library_path: Option<String>,
    pub meta_path: Option<String>,
    pub threep_config_path: Option<String>,
    pub developer_settings_path: Option<String>,
    pub normal_config_path: Option<String>,
    pub resolution_source: String,
    pub package_family_name: Option<String>,
    pub is_msix_virtualized: bool,
    /// 3P 根 `claude_desktop_config.json` 是否含 `deploymentMode: "3p"`。
    pub threep_enabled: bool,
    pub candidates: Vec<ClaudeDesktopPathCandidateDto>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopPathCandidateDto {
    pub path: String,
    pub source: String,
    pub score: i32,
    pub exists: bool,
    pub markers: Vec<String>,
}

/// 左栏 profile 列表项（注册关系 + 文件状态）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopProfileMetaDto {
    pub id: String,
    pub name: String,
    pub file_name: String,
    pub path: String,
    pub registered: bool,
    pub active: bool,
    pub exists: bool,
    pub valid_json: bool,
    pub updated_at: Option<String>,
    pub warning: Option<String>,
}

/// 单个 profile 的完整编辑载荷。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeDesktopProfileDataDto {
    pub meta: ClaudeDesktopProfileMetaDto,
    pub profile_json: Value,
    pub meta_json: Value,
    pub developer_settings_json: Value,
    pub desktop_config_json: Value,
    pub paths: ClaudeDesktopPathsDto,
}

/// 保存 profile：直接写真实 Claude Desktop 文件。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveClaudeDesktopProfileRequest {
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    pub profile_json: Value,
    #[serde(default = "default_true")]
    pub register_in_meta: bool,
    #[serde(default)]
    pub make_active: bool,
    /// 可选：一并覆写 `_meta.json`（须为对象）。
    #[serde(default)]
    pub meta_json: Option<Value>,
    /// 可选：一并覆写 `developer_settings.json`。
    #[serde(default)]
    pub developer_settings_json: Option<Value>,
    /// 可选：一并覆写 3P `claude_desktop_config.json`。
    #[serde(default)]
    pub desktop_config_json: Option<Value>,
}

/// 启用 / 应用 3P 模式请求（含写入 active profile）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyClaudeDesktop3pRequest {
    pub active_profile_id: String,
    #[serde(default = "default_true")]
    pub write_normal_config: bool,
    #[serde(default = "default_true")]
    pub write_threep_config: bool,
    #[serde(default = "default_true")]
    pub write_developer_settings: bool,
}

/// 仅开关 `deploymentMode: "3p"`（不改 profile / _meta）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetClaudeDesktop3pEnabledRequest {
    pub enabled: bool,
    /// 同步写入普通 Claude 侧 config（若已解析到路径）。
    #[serde(default = "default_true")]
    pub write_normal_config: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyClaudeDesktop3pResult {
    pub written_files: Vec<String>,
    pub backup_files: Vec<String>,
    pub warnings: Vec<String>,
    pub restart_required: bool,
}

fn default_true() -> bool {
    true
}
