use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 渠道列表项 / 元数据（持久化为渠道目录下 `meta.json`）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelMeta {
    pub id: String,
    pub name: String,
    /// "claude" | "codex"
    pub app_type: String,
    /// RFC3339 时间戳
    pub updated_at: String,
}

/// 抽取源配置（live）结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractResult {
    /// 源配置文件是否存在。
    pub exists: bool,
    /// 源配置完整快照。
    /// - Claude：`settings.json` 的 JSON。
    /// - Codex：`{ auth, configToml, config }`。
    pub snapshot: Value,
}

/// 渠道完整数据（前端编辑用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelData {
    pub id: String,
    pub name: String,
    pub app_type: String,
    /// 完整配置快照（与 [`ExtractResult::snapshot`] 同构）。
    pub snapshot: Value,
    pub updated_at: String,
}

/// 保存渠道请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveChannelRequest {
    /// 为空表示新增（后端生成 uuid）。
    #[serde(default)]
    pub id: Option<String>,
    pub name: String,
    /// 完整配置快照（操作字段已由前端整合进非操作字段）。
    pub snapshot: Value,
}

/// Claude 操作字段（表单态）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeOperationFields {
    /// env.ANTHROPIC_BASE_URL
    #[serde(default)]
    pub base_url: String,
    /// env.ANTHROPIC_API_KEY
    #[serde(default)]
    pub api_key: String,
    /// env.ANTHROPIC_DEFAULT_SONNET_MODEL（已含可选 `[1m]` 后缀，由前端组装）
    #[serde(default)]
    pub sonnet_model: String,
    /// env.ANTHROPIC_DEFAULT_OPUS_MODEL
    #[serde(default)]
    pub opus_model: String,
    /// env.ANTHROPIC_DEFAULT_FABLE_MODEL
    #[serde(default)]
    pub fable_model: String,
    /// env.ANTHROPIC_DEFAULT_HAIKU_MODEL
    #[serde(default)]
    pub haiku_model: String,
    /// env.ANTHROPIC_MODEL（默认兜底模型，可空）
    #[serde(default)]
    pub default_model: String,
}

/// Codex 操作字段（表单态）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexOperationFields {
    /// auth.json 的 OPENAI_API_KEY
    #[serde(default)]
    pub api_key: String,
    /// config.toml 中 active provider 的 base_url
    #[serde(default)]
    pub base_url: String,
    /// config.toml 的 model
    #[serde(default)]
    pub model: String,
    /// config.toml 的 review_model
    #[serde(default)]
    pub review_model: String,
}
