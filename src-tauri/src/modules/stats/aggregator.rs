use std::collections::HashMap;
use std::str::FromStr;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rusqlite::{Connection, TransactionBehavior};
use rust_decimal::Decimal;
use tauri::{AppHandle, Emitter};

use crate::error::AppResult;
use crate::models::pricing::{CostStatus, RequestPricing};
use crate::modules::pricing::calculate_cost;
use crate::models::stats::{RequestLog, StatsOverview, TrendCompare};
use crate::modules::stats::periods;
use crate::modules::storage::{db::DbPool, request_logs_repo, stats_repo};
use crate::modules::usage::TokenUsage;

const STATS_EVENT: &str = "stats-updated";
const REQUEST_LOG_EVENT: &str = "request-logged";
const ENDPOINT_HEALTH_EVENT: &str = "endpoint-health-changed";
const FLUSH_INTERVAL: Duration = Duration::from_secs(2);
/// 请求明细保留窗口：90 天。
pub const RETENTION_DAYS: i64 = 90;
const RETENTION_MS: i64 = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/// ponytail: 当前产品只要求固定 90 天；未来配置化时从这里改为读取 app_config。
pub fn retention_days() -> i64 {
    RETENTION_DAYS
}

pub fn retention_cutoff_ms() -> i64 {
    chrono::Utc::now().timestamp_millis() - RETENTION_MS
}
/// 明细清理最小间隔：每小时至多一次。
const PRUNE_INTERVAL: Duration = Duration::from_secs(3600);

/// 不进请求监控 / 日聚合的入站 path（Claude Desktop 探活等）。
/// ponytail: 硬编码 denylist，条数少；与熔断 known-business allowlist 语义相反，禁止复用。
/// 升级=往表里加 path；配置/设置页有第二需求再做。
const SKIP_INBOUND_PATHS: &[&str] = &["/api/hello"];

/// 入站 path 是否跳过 `record`（去尾 `/`、ASCII 小写、精确相等）。
fn should_skip_inbound_path(path: &str) -> bool {
    let lower = path.trim_end_matches('/').to_ascii_lowercase();
    SKIP_INBOUND_PATHS.iter().any(|k| lower == *k)
}

#[derive(Default, Clone, Copy)]
struct Delta {
    requests: i64,
    errors: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_creation_tokens: i64,
    cache_read_tokens: i64,
    priced_cost: Decimal,
    priced_requests: i64,
    unpriced_requests: i64,
}

/// 一次请求结果的完整记录（由代理转发汇聚点构造）。
pub struct RequestRecord {
    pub endpoint_name: String,
    pub model: Option<String>,
    pub inbound_format: String,
    /// 端点 transformer 快照（claude/openai/codex 等），用于前端按端点类型显示品牌图标。
    pub transformer: Option<String>,
    pub upstream_url: String,
    /// 真实入站路由路径（`uri.path()`）。
    pub inbound_path: String,
    /// 真实出站路由路径（实际转发上游的路径）。失败兜底为空串。
    pub upstream_path: String,
    pub status_code: Option<i64>,
    pub is_error: bool,
    pub usage: TokenUsage,
    pub duration_ms: Option<i64>,
    pub first_byte_ms: Option<i64>,
    pub actual_model: Option<String>,
    pub error_body: Option<String>,
    pub pricing: RequestPricing,
}

#[derive(Default)]
struct Pending {
    deltas: HashMap<(String, String), Delta>,
    logs: Vec<RequestLog>,
}

impl Pending {
    fn record(&mut self, rec: RequestRecord, date: String, ts: i64) -> RequestLog {
        let d = self.deltas.entry((rec.endpoint_name.clone(), date)).or_default();
        let (mut cost_status, mut cost_reason, mut cost) = if let Some(error) = &rec.pricing.error {
            (CostStatus::CalculationError, Some(error.clone()), None)
        } else if let Some(snapshot) = &rec.pricing.snapshot {
            if !rec.usage.complete || rec.usage.output_estimated {
                (CostStatus::IncompleteUsage, Some("用量不完整，未计价".into()), None)
            } else {
                match calculate_cost(&snapshot.rates, &rec.usage) {
                    Ok(cost) => (CostStatus::Priced, None, Some(cost)),
                    Err(error) => (CostStatus::CalculationError, Some(error.to_string()), None),
                }
            }
        } else {
            (CostStatus::Unpriced, Some("未配置渠道模型价格".into()), None)
        };
        if let Some(value) = &cost {
            match Decimal::from_str(&value.total).ok().and_then(|value| d.priced_cost.checked_add(value)) {
                Some(total) => d.priced_cost = total,
                None => {
                    cost_status = CostStatus::CalculationError;
                    cost_reason = Some("已计价金额累计溢出".into());
                    cost = None;
                }
            }
        }
        d.requests += 1;
        d.errors += i64::from(rec.is_error);
        d.input_tokens += rec.usage.input;
        // 字符估算只给监控看速率，不进日聚合。
        if !rec.usage.output_estimated {
            d.output_tokens += rec.usage.output;
        }
        d.cache_creation_tokens += rec.usage.cache_creation;
        d.cache_read_tokens += rec.usage.cache_read;
        if cost.is_some() {
            d.priced_requests += 1;
        } else {
            d.unpriced_requests += 1;
        }
        let log = RequestLog {
            id: 0,
            ts,
            endpoint_name: rec.endpoint_name,
            inbound_format: rec.inbound_format,
            transformer: rec.transformer,
            upstream_url: rec.upstream_url,
            inbound_path: rec.inbound_path,
            upstream_path: rec.upstream_path,
            status_code: rec.status_code,
            is_error: rec.is_error,
            input_tokens: rec.usage.input,
            output_tokens: rec.usage.output,
            cache_creation_tokens: rec.usage.cache_creation,
            cache_read_tokens: rec.usage.cache_read,
            model: rec.model,
            duration_ms: rec.duration_ms,
            first_byte_ms: rec.first_byte_ms,
            output_estimated: rec.usage.output_estimated,
            actual_model: rec.actual_model,
            error_body: rec.error_body,
            endpoint_id: rec.pricing.endpoint_id,
            pricing_model: rec.pricing.model_id,
            pricing_at: rec.pricing.at,
            pricing_snapshot: rec.pricing.snapshot,
            cost_status,
            cost_reason,
            cost,
        };
        self.logs.push(log.clone());
        log
    }

    fn commit(&mut self, conn: &mut Connection, device_id: &str) -> AppResult<()> {
        if self.logs.is_empty() {
            return Ok(());
        }
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        for ((endpoint, date), d) in &self.deltas {
            stats_repo::upsert(
                &tx, endpoint, date, device_id, d.requests, d.errors, d.input_tokens,
                d.output_tokens, d.cache_creation_tokens, d.cache_read_tokens,
                d.priced_cost, d.priced_requests, d.unpriced_requests,
            )?;
        }
        request_logs_repo::insert_batch(&tx, &self.logs, device_id)?;
        tx.commit()?;
        // 只有提交成功才能丢弃批次；任何错误均由事务回滚并保留原批次。
        self.deltas.clear();
        self.logs.clear();
        Ok(())
    }
}

/// 统计聚合器：内存累加 + 2 秒防抖批量落库 + 零延迟事件推送。
///
/// `record` 累加内存（按日聚合 + 明细缓冲）并立即发 `stats-updated` / `request-logged` 事件；
/// DB 写入由 2s 刷新循环或 `overview`（flush-then-read）触发，避免每请求都写库。
pub struct StatsAggregator {
    db_pool: DbPool,
    app_handle: AppHandle,
    device_id: String,
    pending: Mutex<Pending>,
    last_prune: Mutex<Option<Instant>>,
}

impl StatsAggregator {
    pub fn new(db_pool: DbPool, app_handle: AppHandle, device_id: String) -> Arc<Self> {
        let agg = Arc::new(Self {
            db_pool,
            app_handle,
            device_id,
            pending: Mutex::new(Pending::default()),
            last_prune: Mutex::new(None),
        });
        // 2 秒防抖刷新循环；聚合器被释放后自动退出
        let weak = Arc::downgrade(&agg);
        tauri::async_runtime::spawn(async move {
            let mut tick = tokio::time::interval(FLUSH_INTERVAL);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                match weak.upgrade() {
                    Some(a) => {
                        if let Err(e) = a.flush() {
                            tracing::warn!("统计刷新失败: {e}");
                        }
                    }
                    None => break,
                }
            }
        });
        agg
    }

    /// 端点健康/熔断状态变化事件（前端收到后重新拉取 `get_endpoint_health`）。
    pub fn emit_health_changed(&self) {
        let _ = self.app_handle.emit(ENDPOINT_HEALTH_EVENT, ());
    }

    /// 记录一次请求结果（累加内存 + 缓冲明细 + 立即发事件）。
    /// 命中 `SKIP_INBOUND_PATHS`（如 `/api/hello`）则整段跳过：不聚合、不落库、不发事件。
    pub fn record(&self, rec: RequestRecord) {
        if should_skip_inbound_path(&rec.inbound_path) {
            return;
        }
        let date = periods::today();
        let ts = chrono::Utc::now().timestamp_millis();
        let log = self.pending.lock().unwrap().record(rec, date, ts);
        let _ = self.app_handle.emit(STATS_EVENT, ());
        let _ = self.app_handle.emit(REQUEST_LOG_EVENT, &log);
    }

    fn should_prune(&self) -> bool {
        match *self.last_prune.lock().unwrap() {
            None => true,
            Some(t) => t.elapsed() >= PRUNE_INTERVAL,
        }
    }

    fn mark_pruned(&self) {
        *self.last_prune.lock().unwrap() = Some(Instant::now());
    }

    /// 将内存增量批量写入 DB（幂等：无增量且无需清理时直接返回）。
    pub fn flush(&self) -> AppResult<()> {
        // ponytail: 同一锁覆盖记录和提交，避免拆批/重入重复。写库阻塞记录；吞吐成为瓶颈时升级为专用账本写线程。
        let mut pending = self.pending.lock().unwrap();
        let prune = self.should_prune();
        if pending.logs.is_empty() && !prune {
            return Ok(());
        }
        let mut conn = self.db_pool.get()?;
        pending.commit(&mut conn, &self.device_id)?;
        if prune {
            let cutoff = retention_cutoff_ms();
            match request_logs_repo::prune_older_than(&conn, cutoff) {
                Ok(_) => self.mark_pruned(),
                Err(e) => tracing::warn!("请求明细清理失败: {e}"),
            }
        }
        Ok(())
    }

    /// 四周期总览 + 趋势（先 flush 保证数据完整，再查 DB）。
    pub fn overview(&self) -> AppResult<StatsOverview> {
        self.flush()?;
        let conn = self.db_pool.get()?;
        let t = periods::today_range();
        let y = periods::yesterday_range();
        let w = periods::this_week_range();
        let m = periods::this_month_range();
        let today = stats_repo::period_stats(&conn, &t.start, &t.end)?;
        let yesterday = stats_repo::period_stats(&conn, &y.start, &y.end)?;
        let this_week = stats_repo::period_stats(&conn, &w.start, &w.end)?;
        let this_month = stats_repo::period_stats(&conn, &m.start, &m.end)?;
        let trend = TrendCompare {
            requests_pct: periods::calculate_trend(today.requests, yesterday.requests),
            input_tokens_pct: periods::calculate_trend(today.input_tokens, yesterday.input_tokens),
            output_tokens_pct: periods::calculate_trend(
                today.output_tokens,
                yesterday.output_tokens,
            ),
        };
        Ok(StatsOverview {
            today,
            yesterday,
            this_week,
            this_month,
            trend,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::pricing::{PriceRates, PricingSnapshot};
    use crate::modules::storage::migration::run_migrations;

    fn record() -> RequestRecord {
        RequestRecord {
            endpoint_name: "channel".into(),
            model: Some("alias".into()),
            inbound_format: "openai".into(),
            transformer: Some("openai".into()),
            upstream_url: "https://example.com".into(),
            inbound_path: "/v1/chat/completions".into(),
            upstream_path: "/v1/chat/completions".into(),
            status_code: Some(200),
            is_error: false,
            usage: TokenUsage { input: 1_000_000, complete: true, ..TokenUsage::default() },
            duration_ms: Some(20),
            first_byte_ms: None,
            actual_model: Some("exact/model".into()),
            error_body: None,
            pricing: RequestPricing {
                endpoint_id: Some(42),
                model_id: Some("exact/model".into()),
                at: Some(100),
                snapshot: Some(PricingSnapshot {
                    model_id: "exact/model".into(),
                    timezone: "Asia/Shanghai".into(),
                    source: "window".into(),
                    rule_id: Some("night".into()),
                    rule_name: Some("谷价".into()),
                    rates: PriceRates {
                        input: "0.1".into(), output: "2".into(),
                        cache_read: "0.01".into(), cache_write: "0.2".into(),
                    },
                }),
                error: None,
            },
        }
    }

    #[test]
    fn zero_missing_estimated_and_error_usage_have_distinct_costs() {
        let mut pending = Pending::default();
        let mut zero = record();
        zero.usage.input = 0;
        let priced = pending.record(zero, "2026-01-01".into(), 1);
        assert!(matches!(priced.cost_status, CostStatus::Priced));
        assert_eq!(Decimal::from_str(&priced.cost.unwrap().total).unwrap(), Decimal::ZERO);

        let mut missing = record();
        missing.pricing.snapshot = None;
        let missing = pending.record(missing, "2026-01-01".into(), 2);
        assert!(matches!(missing.cost_status, CostStatus::Unpriced));
        assert!(missing.cost.is_none());

        let mut incomplete = record();
        incomplete.usage.complete = false;
        let incomplete = pending.record(incomplete, "2026-01-01".into(), 3);
        assert!(matches!(incomplete.cost_status, CostStatus::IncompleteUsage));
        assert!(incomplete.cost.is_none());

        let mut estimated = record();
        estimated.usage.output_estimated = true;
        let estimated = pending.record(estimated, "2026-01-01".into(), 4);
        assert!(matches!(estimated.cost_status, CostStatus::IncompleteUsage));
        assert!(estimated.cost.is_none());

        let mut failed = record();
        failed.is_error = true;
        failed.status_code = Some(500);
        let failed = pending.record(failed, "2026-01-01".into(), 5);
        assert!(matches!(failed.cost_status, CostStatus::Priced));
        assert_eq!(Decimal::from_str(&failed.cost.unwrap().total).unwrap(), Decimal::new(1, 1));

        let mut bad = record();
        bad.pricing.error = Some("invalid persisted rates".into());
        let bad = pending.record(bad, "2026-01-01".into(), 6);
        assert!(matches!(bad.cost_status, CostStatus::CalculationError));
        assert!(bad.cost.is_none());
        let d = pending.deltas.values().next().unwrap();
        assert_eq!((d.priced_requests, d.unpriced_requests), (2, 4));
    }

    #[test]
    fn failed_batch_rolls_back_retains_and_retries_exactly_once() {
        let mut conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        let mut pending = Pending::default();
        let first = pending.record(record(), "2026-01-01".into(), 1);
        let mut second = record();
        second.pricing.snapshot.as_mut().unwrap().rates.input = "0.2".into();
        pending.record(second, "2026-01-01".into(), 2);
        // 日表先写成功，第二条日志故意失败：第一条日志和日金额都必须回滚。
        conn.execute_batch("CREATE TRIGGER fail_log BEFORE INSERT ON request_logs
            WHEN NEW.ts = 2 BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
        assert!(pending.commit(&mut conn, "dev").is_err());
        assert_eq!(pending.logs.len(), 2);
        assert_eq!(request_logs_repo::query_page(&conn, None, None, None, 10, 0).unwrap().1, 0);
        assert_eq!(stats_repo::period_stats(&conn, "2026-01-01", "2026-01-01").unwrap().requests, 0);

        conn.execute_batch("DROP TRIGGER fail_log;").unwrap();
        pending.commit(&mut conn, "dev").unwrap();
        pending.commit(&mut conn, "dev").unwrap();
        assert!(pending.logs.is_empty());
        assert!(pending.deltas.is_empty());
        let (logs, count) = request_logs_repo::query_page(&conn, None, None, None, 10, 0).unwrap();
        assert_eq!(count, 2);
        assert_eq!(logs[1].endpoint_id, Some(42));
        assert_eq!(logs[1].pricing_model.as_deref(), Some("exact/model"));
        assert_eq!(logs[1].pricing_at, Some(100));
        assert_eq!(serde_json::to_value(&logs[1].pricing_snapshot).unwrap(), serde_json::to_value(&first.pricing_snapshot).unwrap());
        assert_eq!(serde_json::to_value(&logs[1].cost).unwrap(), serde_json::to_value(&first.cost).unwrap());
        assert!(matches!(logs[1].cost_status, CostStatus::Priced));
        let stats = stats_repo::period_stats(&conn, "2026-01-01", "2026-01-01").unwrap();
        assert_eq!((stats.requests, stats.priced_requests, stats.unpriced_requests), (2, 2, 0));
        assert_eq!(stats.priced_cost, "0.3");

        assert_eq!(request_logs_repo::prune_older_than(&conn, 2).unwrap(), 1);
        assert_eq!(request_logs_repo::clear_all(&conn).unwrap(), 1);
        let stats = stats_repo::period_stats(&conn, "2026-01-01", "2026-01-01").unwrap();
        assert_eq!(stats.priced_cost, "0.3");
        assert_eq!(stats.priced_requests, 2);
    }

    #[test]
    fn skips_claude_desktop_hello() {
        assert!(should_skip_inbound_path("/api/hello"));
        assert!(should_skip_inbound_path("/api/hello/"));
        assert!(should_skip_inbound_path("/API/HELLO"));
    }

    #[test]
    fn records_business_and_unrelated_paths() {
        assert!(!should_skip_inbound_path("/v1/messages"));
        assert!(!should_skip_inbound_path("/v1/chat/completions"));
        assert!(!should_skip_inbound_path("/v1/responses"));
        assert!(!should_skip_inbound_path("/evil/api/hello"));
        assert!(!should_skip_inbound_path("/api/hello/world"));
        assert!(!should_skip_inbound_path(""));
    }
}
