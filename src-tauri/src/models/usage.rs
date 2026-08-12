use serde::{Deserialize, Serialize};

/// 内部：单条本机用量记录（落 `usage_records`）。
/// 语义统一为「输入=非缓存提示 token，缓存读取/创建单列」，便于跨 app 汇总不重复计数。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UsageRecord {
    pub app_type: String,   // "claude" | "codex"
    pub record_key: String, // 去重键（claude: message.id；codex: codex_session:<id>:<idx>）
    pub date: String,       // YYYY-MM-DD（本地时区）
    pub ts: Option<i64>,    // 精确时间戳（Unix 毫秒）；源日志缺时间戳时为 None
    pub model: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
}

/// 用量总览（MVP：仅 token 维度，无成本）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSummary {
    pub total_requests: i64,
    pub total_input_tokens: i64,
    pub total_output_tokens: i64,
    pub total_cache_creation_tokens: i64,
    pub total_cache_read_tokens: i64,
}

/// 按模型聚合。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsage {
    pub app_type: String,
    pub model: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
}

/// 按天聚合。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyUsage {
    pub date: String,
    pub app_type: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
}

/// 按天 × 来源 × 模型聚合（多维合并表：前端按 date 行合并展示）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayModelUsage {
    pub date: String,
    pub app_type: String,
    pub model: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
}

/// 一次本机用量同步结果。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageSyncResult {
    pub imported: i64,
    pub files_scanned: i64,
    pub errors: i64,
}
