use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceRates {
    pub input: String,
    pub output: String,
    pub cache_read: String,
    pub cache_write: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceWindow {
    pub id: String,
    pub name: String,
    pub weekdays: Vec<u8>,
    pub start_minute: u16,
    pub end_minute: u16,
    pub rates: PriceRates,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPricing {
    pub model_id: String,
    pub timezone: String,
    pub base_rates: PriceRates,
    pub windows: Vec<PriceWindow>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingSnapshot {
    pub model_id: String,
    pub timezone: String,
    pub source: String,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub rates: PriceRates,
}

#[derive(Debug, Clone, Default)]
pub struct RequestPricing {
    pub endpoint_id: Option<i64>,
    pub model_id: Option<String>,
    pub at: Option<i64>,
    pub snapshot: Option<PricingSnapshot>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostBreakdown {
    pub input: String,
    pub output: String,
    pub cache_read: String,
    pub cache_write: String,
    pub total: String,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostStatus {
    Priced,
    Unpriced,
    IncompleteUsage,
    CalculationError,
    #[default]
    LegacyUnknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelPriceQuote {
    pub requested_model: String,
    pub model_id: String,
    pub base_rates: Option<PriceRates>,
    pub effective_rates: Option<PriceRates>,
    pub timezone: Option<String>,
    pub rule_id: Option<String>,
    pub rule_name: Option<String>,
    pub source: Option<String>,
    pub at: i64,
    pub next_change_at: Option<i64>,
}
