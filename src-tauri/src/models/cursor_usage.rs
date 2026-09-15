use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// 前端用量面板的完整快照（camelCase）。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorUsageSnapshot {
    pub fetched_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    pub db_path: String,
    pub plan: CursorPlanInfo,
    pub period: CursorPeriod,
    pub metrics: CursorMetrics,
    pub categories: Vec<CursorCategory>,
    pub daily: Vec<CursorDailyPoint>,
    pub hourly: Vec<CursorHourlyPoint>,
    pub recent: Vec<CursorRecentRow>,
    pub interfaces: HashMap<String, InterfaceStatus>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPlanInfo {
    pub plan_name: String,
    pub price: String,
    pub included_amount_cents: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub membership_type: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPeriod {
    pub cycle_start_ms: i64,
    pub cycle_end_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_message: Option<String>,
    pub auto_bucket_models: Vec<String>,
    pub plan_usage: CursorPlanUsage,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPlanUsage {
    pub total_spend: i64,
    pub included_spend: i64,
    pub bonus_spend: i64,
    pub remaining: i64,
    pub limit: i64,
    pub total_percent_used: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub api_percent_used: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auto_percent_used: Option<f64>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorMetrics {
    pub quota_used_pct: f64,
    pub official_total_pct: f64,
    pub expected_used_pct: f64,
    pub over_pace: bool,
    pub days_left: i64,
    pub cycle_total_days: i64,
    pub daily_budget_cents: i64,
    pub today_used_cents: f64,
    pub today_used_pct: f64,
    pub cycle_spend_cents: i64,
    pub cycle_bonus_cents: i64,
    pub cycle_remaining_cents: i64,
    pub cycle_used_cents: i64,
    pub cycle_limit_cents: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorCategory {
    pub id: String,
    pub label: String,
    pub usage_pct: f64,
    pub tokens: i64,
    pub weight: f64,
    pub models: Vec<CursorModelRow>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorModelRow {
    pub model: String,
    pub events: i64,
    pub tokens: i64,
    pub weight: f64,
    pub usage_pct: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorDailyPoint {
    pub date: String,
    pub cents: f64,
    pub tokens: i64,
    pub events: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorHourlyPoint {
    pub hour: i32,
    pub label: String,
    pub cents: f64,
    pub tokens: i64,
    pub events: i64,
    pub models: Vec<CursorHourlyModel>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorHourlyModel {
    pub model: String,
    pub cents: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorRecentRow {
    pub time: String,
    pub model: String,
    pub tokens: i64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InterfaceStatus {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skipped: Option<bool>,
}

/// 落库事件行。
#[derive(Debug, Clone)]
pub struct CursorUsageEventRow {
    pub event_key: String,
    pub ts: i64,
    pub date: String,
    pub hour: i32,
    pub model: String,
    pub kind: Option<String>,
    pub chargeable: bool,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost_cents: f64,
}
