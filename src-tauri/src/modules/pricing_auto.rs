//! models.dev 自动价表：端点未配置模型价格时的兜底四价。
//!
//! - 启动时读 `<app_data_dir>/model-prices.json`，超过 6 小时才在后台重新拉取。
//! - 只保留原厂供应商（anthropic/openai/google/...）的报价；同一归一化模型 ID
//!   在多个供应商出现时按原厂优先级取价，避免转售渠道价与免费价混入。
//! - 拉取失败保留旧缓存，不阻塞启动；手动端点价始终优先。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, RwLock};
use std::time::Duration;

use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};
use crate::models::pricing::PriceRates;
use crate::utils::atomic_write::atomic_write_str;

pub const API_URL: &str = "https://models.dev/api.json";
pub const CACHE_FILE_NAME: &str = "model-prices.json";
pub const SYNC_INTERVAL_MS: i64 = 6 * 60 * 60 * 1000;
const FILE_VERSION: u32 = 1;
const FETCH_TIMEOUT: Duration = Duration::from_secs(60);

/// 原厂供应商优先级。只接受列表内的供应商，未列出的转售/聚合渠道不参与自动价。
const FIRST_PARTY_PROVIDERS: &[&str] = &[
    "anthropic",
    "openai",
    "google",
    "deepseek",
    "xai",
    "zai",
    "moonshotai",
    "alibaba",
    "minimax",
    "xiaomi",
    "longcat",
    "mistral",
    "cohere",
    "meta",
];

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoPriceTable {
    #[serde(default)]
    pub version: u32,
    #[serde(default)]
    pub fetched_at: i64,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub models: HashMap<String, PriceRates>,
}

impl AutoPriceTable {
    pub fn lookup(&self, model_id: &str) -> Option<&PriceRates> {
        self.models.get(&normalize_model_id(model_id))
    }

    pub fn is_stale(&self, now_ms: i64) -> bool {
        self.fetched_at <= 0 || now_ms.saturating_sub(self.fetched_at) >= SYNC_INTERVAL_MS
    }
}

#[derive(Deserialize)]
struct Provider {
    #[serde(default)]
    models: HashMap<String, Model>,
}

#[derive(Deserialize)]
struct Model {
    cost: Option<Cost>,
}

#[derive(Deserialize)]
struct Cost {
    input: Option<serde_json::Number>,
    output: Option<serde_json::Number>,
    cache_read: Option<serde_json::Number>,
    cache_write: Option<serde_json::Number>,
}

/// 去掉供应商前缀、`:tag` 后缀、`[1m]` 标记与 `@`，统一小写。
pub fn normalize_model_id(model_id: &str) -> String {
    let after_slash = model_id.rsplit('/').next().unwrap_or(model_id);
    let before_colon = after_slash.split(':').next().unwrap_or("");
    let mut normalized = before_colon.trim().replace('@', "-").to_lowercase();
    if normalized.ends_with("[1m]") {
        normalized.truncate(normalized.len() - "[1m]".len());
        normalized = normalized.trim().to_string();
    }
    normalized
}

fn first_party_rank(provider_id: &str) -> Option<usize> {
    FIRST_PARTY_PROVIDERS
        .iter()
        .position(|id| *id == provider_id)
}

fn price(value: &serde_json::Number) -> Option<String> {
    let text = value.to_string();
    let decimal = Decimal::from_str_exact(&text)
        .or_else(|_| Decimal::from_scientific(&text))
        .ok()?;
    if decimal.is_sign_negative() {
        return None;
    }
    Some(decimal.round_dp(9).normalize().to_string())
}

fn build_models(data: &HashMap<String, Provider>) -> HashMap<String, PriceRates> {
    let mut best: HashMap<String, (usize, PriceRates)> = HashMap::new();
    for (provider_id, provider) in data {
        let Some(rank) = first_party_rank(provider_id) else {
            continue;
        };
        for (model_id, model) in &provider.models {
            // 保留 deprecated：代理仍可能转发旧模型 ID，历史请求也需要能计价。
            let Some(cost) = &model.cost else { continue };
            let (Some(input), Some(output)) = (
                cost.input.as_ref().and_then(price),
                cost.output.as_ref().and_then(price),
            ) else {
                continue;
            };
            let key = normalize_model_id(model_id);
            if key.is_empty() {
                continue;
            }
            let rates = PriceRates {
                input,
                output,
                cache_read: cost
                    .cache_read
                    .as_ref()
                    .and_then(price)
                    .unwrap_or_else(|| "0".into()),
                cache_write: cost
                    .cache_write
                    .as_ref()
                    .and_then(price)
                    .unwrap_or_else(|| "0".into()),
            };
            match best.get(&key) {
                Some((existing, _)) if *existing <= rank => {}
                _ => {
                    best.insert(key, (rank, rates));
                }
            }
        }
    }
    best.into_iter()
        .map(|(key, (_, rates))| (key, rates))
        .collect()
}

pub fn parse_response(body: &[u8]) -> AppResult<AutoPriceTable> {
    let data: HashMap<String, Provider> = serde_json::from_slice(body)?;
    Ok(AutoPriceTable {
        version: FILE_VERSION,
        fetched_at: chrono::Utc::now().timestamp_millis(),
        source: API_URL.into(),
        models: build_models(&data),
    })
}

pub async fn fetch_table() -> AppResult<AutoPriceTable> {
    let client = reqwest::Client::builder()
        .timeout(FETCH_TIMEOUT)
        .user_agent(concat!("ccmesh/", env!("CARGO_PKG_VERSION")))
        .build()?;
    let response = client.get(API_URL).send().await?;
    if !response.status().is_success() {
        return Err(AppError::Unknown(format!(
            "models.dev 返回 HTTP {}",
            response.status()
        )));
    }
    parse_response(&response.bytes().await?)
}

pub fn cache_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(CACHE_FILE_NAME)
}

pub fn load(path: &Path) -> AutoPriceTable {
    let Ok(text) = std::fs::read_to_string(path) else {
        return AutoPriceTable::default();
    };
    match serde_json::from_str::<AutoPriceTable>(&text) {
        Ok(table) => table,
        Err(error) => {
            tracing::warn!("models.dev 价格表缓存损坏，忽略: {error}");
            AutoPriceTable::default()
        }
    }
}

pub fn save(path: &Path, table: &AutoPriceTable) -> AppResult<()> {
    atomic_write_str(path, &serde_json::to_string(table)?)
}

static TABLE: LazyLock<RwLock<AutoPriceTable>> =
    LazyLock::new(|| RwLock::new(AutoPriceTable::default()));

pub fn table() -> &'static RwLock<AutoPriceTable> {
    &TABLE
}

/// 启动时载入缓存，立即用于兜底计价。
pub fn init(path: PathBuf) {
    let table = load(&path);
    *TABLE.write().unwrap_or_else(|error| error.into_inner()) = table;
}

pub fn is_stale_now() -> bool {
    table()
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .is_stale(chrono::Utc::now().timestamp_millis())
}

/// 后台同步：成功后原子落盘并替换内存表；失败保留旧缓存。
pub async fn sync(path: PathBuf) {
    match fetch_table().await {
        Ok(fresh) => {
            let count = fresh.models.len();
            if let Err(error) = save(&path, &fresh) {
                tracing::warn!("models.dev 价格表写入缓存失败: {error}");
            }
            if let Ok(mut guard) = table().write() {
                *guard = fresh;
            }
            tracing::info!("models.dev 价格表已更新：{count} 个模型");
        }
        Err(error) => {
            tracing::warn!("models.dev 价格表同步失败，继续使用缓存: {error}");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rates(input: &str, output: &str, read: &str, write: &str) -> PriceRates {
        PriceRates {
            input: input.into(),
            output: output.into(),
            cache_read: read.into(),
            cache_write: write.into(),
        }
    }

    #[test]
    fn normalizes_provider_tags_and_suffixes() {
        assert_eq!(
            normalize_model_id("anthropic/claude-sonnet-4-5"),
            "claude-sonnet-4-5"
        );
        assert_eq!(normalize_model_id("gpt-5:free"), "gpt-5");
        assert_eq!(normalize_model_id("MiniMax-M2@2026"), "minimax-m2-2026");
        assert_eq!(normalize_model_id("qwen/qwen3-coder[1m]"), "qwen3-coder");
        assert_eq!(normalize_model_id("  "), "");
    }

    #[test]
    fn first_party_wins_over_resellers_and_unranked_is_skipped() {
        let body = br#"{
            "anthropic": {"models": {
                "claude-sonnet-4-5": {"cost": {"input": 3, "output": 15, "cache_read": 0.3, "cache_write": 3.75}},
                "claude-old": {"status": "deprecated", "cost": {"input": 9, "output": 9}}
            }},
            "reseller": {"models": {
                "anthropic/claude-sonnet-4-5": {"cost": {"input": 0.1, "output": 0.1}}
            }},
            "openai": {"models": {
                "gpt-5": {"cost": {"input": 1.25, "output": 10}},
                "gpt-no-output": {"cost": {"input": 1}}
            }},
            "alibaba": {"models": {
                "glm-5.2": {"cost": {"input": 0.7, "output": 2.8}},
                "qwen-max": {"cost": {"input": 0.000000123456, "output": 2}}
            }},
            "zai": {"models": {
                "glm-5.2": {"cost": {"input": 0.6, "output": 2.2, "cache_read": 0.06, "cache_write": 0}}
            }}
        }"#;
        let table = parse_response(body).unwrap();
        assert_eq!(
            table.lookup("claude-sonnet-4-5"),
            Some(&rates("3", "15", "0.3", "3.75"))
        );
        assert_eq!(table.lookup("gpt-5"), Some(&rates("1.25", "10", "0", "0")));
        assert_eq!(
            table.lookup("glm-5.2"),
            Some(&rates("0.6", "2.2", "0.06", "0"))
        );
        assert_eq!(table.lookup("qwen-max").unwrap().input, "0.000000123");
        assert_eq!(table.lookup("claude-old"), Some(&rates("9", "9", "0", "0")));
        assert!(table.lookup("gpt-no-output").is_none());
        assert!(table.lookup("unknown-model").is_none());
    }

    #[test]
    fn stale_boundary_and_round_trip() {
        let table = AutoPriceTable {
            version: FILE_VERSION,
            fetched_at: 1_000,
            source: API_URL.into(),
            models: HashMap::from([("gpt-5".to_string(), rates("1", "2", "0", "0"))]),
        };
        assert!(!table.is_stale(1_000 + SYNC_INTERVAL_MS - 1));
        assert!(table.is_stale(1_000 + SYNC_INTERVAL_MS));
        assert!(AutoPriceTable::default().is_stale(1_000));

        let dir = std::env::temp_dir().join(format!("ccmesh_pricing_auto_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(CACHE_FILE_NAME);
        save(&path, &table).unwrap();
        let loaded = load(&path);
        assert_eq!(loaded.fetched_at, 1_000);
        assert_eq!(loaded.models, table.models);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
