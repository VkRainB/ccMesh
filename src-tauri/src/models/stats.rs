use serde::{Deserialize, Serialize};

/// 单端点单日统计行（对应 `daily_stats`）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStat {
    pub endpoint_name: String,
    pub date: String,
    pub requests: i64,
    pub errors: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
}

/// 某端点在一个周期内的聚合。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EndpointStat {
    pub endpoint_name: String,
    pub requests: i64,
    pub errors: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
}

/// 单周期聚合（总量 + 每端点明细）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodStats {
    pub requests: i64,
    pub errors: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub endpoints: Vec<EndpointStat>,
}

/// 趋势对比（今日 vs 昨日的百分比变化）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendCompare {
    pub requests_pct: f64,
    pub input_tokens_pct: f64,
    pub output_tokens_pct: f64,
}

/// 四周期统计总览 + 趋势（`get_stats` 返回，`stats-updated` 事件推送）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsOverview {
    pub today: PeriodStats,
    pub yesterday: PeriodStats,
    pub this_week: PeriodStats,
    pub this_month: PeriodStats,
    pub trend: TrendCompare,
}

/// 逐条请求明细（对应 `request_logs`）。事件推送时 `id` 为 0（尚未落库）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLog {
    pub id: i64,
    /// 请求时间（Unix 毫秒，UTC）。
    pub ts: i64,
    pub endpoint_name: String,
    pub inbound_format: String,
    /// 端点 transformer 快照（claude/openai/codex 等）。旧行/未记录为 None，前端回退 inbound_format。
    pub transformer: Option<String>,
    pub upstream_url: String,
    /// 真实入站路由路径（如 `/v1/messages`、`/v1/chat/completions`）。旧行为空串。
    pub inbound_path: String,
    /// 真实出站路由路径（实际转发上游的路径，转换后为 `/v1/chat/completions`）。旧行为空串。
    pub upstream_path: String,
    pub status_code: Option<i64>,
    pub is_error: bool,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
    pub model: Option<String>,
    pub duration_ms: Option<i64>,
    /// 首字节延迟（毫秒）：流式为首个内容分片到达耗时，缓冲为响应头到达耗时。旧行/无数据为 None。
    pub first_byte_ms: Option<i64>,
    /// 实际(出站)模型：映射/锁定改写后实际转发上游的模型。仅当与请求模型不同才有值，透传/旧行为 None。
    pub actual_model: Option<String>,
    /// 错误响应体（仅错误请求，限长写入）。旧行/无响应体为 None。
    pub error_body: Option<String>,
}

/// 按本地小时聚合的调用趋势行（跨端点求和）。`date` 为 `YYYY-MM-DD HH:00`。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HourlyStat {
    pub date: String,
    pub requests: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_creation_tokens: i64,
    pub cache_read_tokens: i64,
}

/// 请求明细分页结果。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestLogPage {
    pub items: Vec<RequestLog>,
    pub total: i64,
}

/// 历史记录分页结果（按端点×日聚合行）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsHistoryPage {
    pub items: Vec<DailyStat>,
    pub total: i64,
}
