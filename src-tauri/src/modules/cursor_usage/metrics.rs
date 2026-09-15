//! 指标计算：日预算、节奏、Auto 桶、分类、事件键、周期规整。

use std::collections::BTreeMap;

use chrono::{DateTime, Local, Timelike};
use serde_json::Value;

use crate::models::cursor_usage::{
    CursorCategory, CursorDailyPoint, CursorHourlyModel, CursorHourlyPoint, CursorMetrics,
    CursorModelRow, CursorPeriod, CursorPlanUsage, CursorRecentRow, CursorUsageEventRow,
};

pub const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, Default)]
pub struct UsageEvent {
    pub ts: i64,
    pub model: String,
    pub chargeable: bool,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cache_read_tokens: i64,
    pub cache_write_tokens: i64,
    pub cost_cents: f64,
    pub kind: Option<String>,
}

pub fn json_i64(v: &Value) -> i64 {
    match v {
        Value::Number(n) => n
            .as_i64()
            .or_else(|| n.as_u64().map(|u| u as i64))
            .or_else(|| n.as_f64().map(|f| f as i64))
            .unwrap_or(0),
        Value::String(s) => s.parse::<f64>().ok().map(|f| f as i64).unwrap_or(0),
        _ => 0,
    }
}

pub fn json_f64(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(0.0),
        Value::String(s) => s.parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub fn event_ms(ts: i64) -> i64 {
    if ts > 0 && ts < 1_000_000_000_000 {
        ts * 1000
    } else {
        ts
    }
}

pub fn event_tokens(e: &UsageEvent) -> i64 {
    e.input_tokens + e.output_tokens + e.cache_read_tokens + e.cache_write_tokens
}

pub fn event_key(e: &UsageEvent) -> String {
    format!(
        "{}|{}|{}|{}|{}|{}",
        e.ts, e.model, e.input_tokens, e.output_tokens, e.cache_read_tokens, e.cache_write_tokens
    )
}

pub fn is_auto_model(model: &str, auto_bucket: &[String]) -> bool {
    let m = model.trim().to_ascii_lowercase();
    if auto_bucket
        .iter()
        .any(|x| x.trim().eq_ignore_ascii_case(&m))
    {
        return true;
    }
    m == "auto" || m == "default" || m.starts_with("composer")
}

pub fn normalize_period(raw: &Value) -> CursorPeriod {
    let pu = raw.get("planUsage").cloned().unwrap_or(Value::Null);
    let limit = json_i64(pu.get("limit").unwrap_or(&Value::Null));
    let included = json_i64(pu.get("includedSpend").unwrap_or(&Value::Null));
    let remaining = pu
        .get("remaining")
        .map(json_i64)
        .unwrap_or((limit - included).max(0));
    let auto_bucket = raw
        .get("autoBucketModels")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();
    CursorPeriod {
        cycle_start_ms: event_ms(json_i64(
            raw.get("billingCycleStart").unwrap_or(&Value::Null),
        )),
        cycle_end_ms: event_ms(json_i64(raw.get("billingCycleEnd").unwrap_or(&Value::Null))),
        display_message: raw
            .get("displayMessage")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        auto_bucket_models: auto_bucket,
        plan_usage: CursorPlanUsage {
            total_spend: {
                let t = json_i64(pu.get("totalSpend").unwrap_or(&Value::Null));
                if t > 0 {
                    t
                } else {
                    included
                }
            },
            included_spend: included,
            bonus_spend: json_i64(pu.get("bonusSpend").unwrap_or(&Value::Null)),
            remaining,
            limit,
            total_percent_used: json_f64(pu.get("totalPercentUsed").unwrap_or(&Value::Null)),
            api_percent_used: pu
                .get("apiPercentUsed")
                .filter(|v| !v.is_null())
                .map(json_f64),
            auto_percent_used: pu
                .get("autoPercentUsed")
                .filter(|v| !v.is_null())
                .map(json_f64),
        },
    }
}

pub fn normalize_summary(raw: &Value) -> CursorPeriod {
    let plan = raw
        .pointer("/individualUsage/plan")
        .cloned()
        .unwrap_or(Value::Null);
    let raw_pu = raw.get("planUsage").cloned().unwrap_or(Value::Null);
    let used = {
        let a = json_i64(plan.get("used").unwrap_or(&Value::Null));
        if a > 0 {
            a
        } else {
            json_i64(raw_pu.get("includedSpend").unwrap_or(&Value::Null))
        }
    };
    let limit = {
        let a = json_i64(plan.get("limit").unwrap_or(&Value::Null));
        if a > 0 {
            a
        } else {
            json_i64(raw_pu.get("limit").unwrap_or(&Value::Null))
        }
    };
    let remaining = plan
        .get("remaining")
        .map(json_i64)
        .unwrap_or((limit - used).max(0));
    let tpu = plan
        .get("totalPercentUsed")
        .or(raw_pu.get("totalPercentUsed"))
        .filter(|v| !v.is_null())
        .map(json_f64)
        .unwrap_or(if limit > 0 {
            used as f64 / limit as f64 * 100.0
        } else {
            0.0
        });
    CursorPeriod {
        cycle_start_ms: event_ms(json_i64(
            raw.get("billingCycleStart").unwrap_or(&Value::Null),
        )),
        cycle_end_ms: event_ms(json_i64(raw.get("billingCycleEnd").unwrap_or(&Value::Null))),
        display_message: None,
        auto_bucket_models: Vec::new(),
        plan_usage: CursorPlanUsage {
            total_spend: used,
            included_spend: used,
            bonus_spend: 0,
            remaining,
            limit,
            total_percent_used: tpu,
            api_percent_used: plan
                .get("apiPercentUsed")
                .or(raw_pu.get("apiPercentUsed"))
                .filter(|v| !v.is_null())
                .map(json_f64),
            auto_percent_used: plan
                .get("autoPercentUsed")
                .or(raw_pu.get("autoPercentUsed"))
                .filter(|v| !v.is_null())
                .map(json_f64),
        },
    }
}

pub fn compute_metrics(period: &CursorPeriod, today_cents: f64, now_ms: i64) -> CursorMetrics {
    let pu = &period.plan_usage;
    let start = period.cycle_start_ms;
    let end = period.cycle_end_ms;
    let days_left = if end > 0 {
        ((end - now_ms) as f64 / DAY_MS as f64).ceil().max(1.0) as i64
    } else {
        1
    };
    let total_days = if end > 0 && start > 0 {
        ((end - start) as f64 / DAY_MS as f64).ceil().max(1.0) as i64
    } else {
        1
    };
    let limit = pu.limit;
    let remaining = pu.remaining;
    let used = pu.included_spend;
    let daily_budget = if remaining > 0 {
        (remaining / days_left).max(1)
    } else {
        0
    };
    let official_pct = if pu.total_percent_used > 0.0 {
        pu.total_percent_used
    } else if limit > 0 {
        used as f64 / limit as f64 * 100.0
    } else {
        0.0
    };
    let quota_pct = if limit > 0 {
        used as f64 / limit as f64 * 100.0
    } else {
        0.0
    };
    let elapsed_days = if start > 0 {
        ((now_ms - start) as f64 / DAY_MS as f64).max(0.0)
    } else {
        0.0
    };
    let expected_pct = if total_days > 0 {
        elapsed_days / total_days as f64 * 100.0
    } else {
        0.0
    };
    CursorMetrics {
        quota_used_pct: (quota_pct * 10.0).round() / 10.0,
        official_total_pct: (official_pct * 10.0).round() / 10.0,
        expected_used_pct: (expected_pct * 10.0).round() / 10.0,
        over_pace: official_pct > expected_pct,
        days_left,
        cycle_total_days: total_days,
        daily_budget_cents: daily_budget,
        today_used_cents: (today_cents * 100.0).round() / 100.0,
        today_used_pct: if daily_budget > 0 {
            ((today_cents / daily_budget as f64) * 1000.0).round() / 10.0
        } else {
            0.0
        },
        cycle_spend_cents: pu.total_spend,
        cycle_bonus_cents: pu.bonus_spend,
        cycle_remaining_cents: remaining,
        cycle_used_cents: used,
        cycle_limit_cents: limit,
    }
}

pub fn group_by_model(events: &[UsageEvent]) -> Vec<CursorModelRow> {
    let mut buckets: BTreeMap<String, (i64, i64, f64)> = BTreeMap::new();
    for e in events {
        let b = buckets.entry(e.model.clone()).or_insert((0, 0, 0.0));
        b.0 += 1;
        b.1 += event_tokens(e);
        b.2 += e.cost_cents;
    }
    let mut rows: Vec<CursorModelRow> = buckets
        .into_iter()
        .map(|(model, (events, tokens, weight))| CursorModelRow {
            model,
            events,
            tokens,
            weight: (weight * 100.0).round() / 100.0,
            usage_pct: 0.0,
        })
        .collect();
    rows.sort_by(|a, b| {
        b.weight
            .partial_cmp(&a.weight)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.model.cmp(&b.model))
    });
    rows
}

pub fn build_categories(
    events: &[UsageEvent],
    auto_bucket: &[String],
    api_pct: Option<f64>,
    auto_pct: Option<f64>,
) -> Vec<CursorCategory> {
    let grouped = group_by_model(events);
    let mut api_rows = Vec::new();
    let mut auto_rows = Vec::new();
    for row in grouped {
        if is_auto_model(&row.model, auto_bucket) {
            auto_rows.push(row);
        } else {
            api_rows.push(row);
        }
    }
    let api_weight: f64 = api_rows.iter().map(|r| r.weight).sum();
    let auto_weight: f64 = auto_rows.iter().map(|r| r.weight).sum();
    let api_pct = api_pct.unwrap_or(0.0);
    let auto_pct = auto_pct.unwrap_or(0.0);
    for (rows, w, pct) in [
        (&mut api_rows, api_weight, api_pct),
        (&mut auto_rows, auto_weight, auto_pct),
    ] {
        for r in rows.iter_mut() {
            r.usage_pct = if w > 0.0 {
                (r.weight / w * pct * 10.0).round() / 10.0
            } else {
                0.0
            };
        }
    }
    let mut out = Vec::new();
    if api_pct > 0.0 || !api_rows.is_empty() {
        out.push(CursorCategory {
            id: "api".into(),
            label: "API".into(),
            usage_pct: (api_pct * 10.0).round() / 10.0,
            tokens: api_rows.iter().map(|r| r.tokens).sum(),
            weight: (api_weight * 100.0).round() / 100.0,
            models: api_rows,
        });
    }
    if auto_pct > 0.0 || !auto_rows.is_empty() {
        out.push(CursorCategory {
            id: "auto_composer".into(),
            label: "Auto + Composer".into(),
            usage_pct: (auto_pct * 10.0).round() / 10.0,
            tokens: auto_rows.iter().map(|r| r.tokens).sum(),
            weight: (auto_weight * 100.0).round() / 100.0,
            models: auto_rows,
        });
    }
    out
}

pub fn today_cents(events: &[UsageEvent], now: DateTime<Local>) -> f64 {
    let today = now.date_naive();
    events
        .iter()
        .filter(|e| e.chargeable)
        .filter(|e| {
            DateTime::from_timestamp_millis(e.ts)
                .map(|dt| dt.with_timezone(&Local).date_naive() == today)
                .unwrap_or(false)
        })
        .map(|e| e.cost_cents)
        .sum()
}

pub fn daily_series(events: &[UsageEvent]) -> Vec<CursorDailyPoint> {
    let mut agg: BTreeMap<String, (f64, i64, i64)> = BTreeMap::new();
    for e in events {
        let Some(dt) = DateTime::from_timestamp_millis(e.ts) else {
            continue;
        };
        let day = dt.with_timezone(&Local).format("%Y-%m-%d").to_string();
        let b = agg.entry(day).or_insert((0.0, 0, 0));
        b.2 += 1;
        if e.chargeable {
            b.0 += e.cost_cents;
        }
        b.1 += event_tokens(e);
    }
    agg.into_iter()
        .map(|(date, (cents, tokens, events))| CursorDailyPoint {
            date,
            cents: (cents * 100.0).round() / 100.0,
            tokens,
            events,
        })
        .collect()
}

pub fn hourly_series(events: &[UsageEvent], now: DateTime<Local>) -> Vec<CursorHourlyPoint> {
    let today = now.date_naive();
    let current_hour = now.hour() as i32;
    let mut agg: BTreeMap<i32, (f64, i64, i64, BTreeMap<String, f64>)> = BTreeMap::new();
    for e in events {
        let Some(dt) = DateTime::from_timestamp_millis(e.ts) else {
            continue;
        };
        let local = dt.with_timezone(&Local);
        if local.date_naive() != today {
            continue;
        }
        let h = local.hour() as i32;
        let b = agg.entry(h).or_insert((0.0, 0, 0, BTreeMap::new()));
        b.2 += 1;
        b.1 += event_tokens(e);
        if e.chargeable {
            b.0 += e.cost_cents;
            *b.3.entry(e.model.clone()).or_insert(0.0) += e.cost_cents;
        }
    }
    (0..=current_hour)
        .map(|h| {
            let (cents, tokens, events, models) = agg.remove(&h).unwrap_or_default();
            let mut models: Vec<CursorHourlyModel> = models
                .into_iter()
                .map(|(model, cents)| CursorHourlyModel {
                    model,
                    cents: (cents * 100.0).round() / 100.0,
                })
                .collect();
            models.sort_by(|a, b| {
                b.cents
                    .partial_cmp(&a.cents)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            CursorHourlyPoint {
                hour: h,
                label: format!("{h:02}:00"),
                cents: (cents * 100.0).round() / 100.0,
                tokens,
                events,
                models,
            }
        })
        .collect()
}

pub fn recent_requests(
    events: &[UsageEvent],
    now: DateTime<Local>,
    limit: usize,
) -> Vec<CursorRecentRow> {
    let today = now.date_naive();
    let mut rows: Vec<&UsageEvent> = events.iter().collect();
    rows.sort_by_key(|e| std::cmp::Reverse(e.ts));
    rows.into_iter()
        .filter_map(|e| {
            let dt = DateTime::from_timestamp_millis(e.ts)?.with_timezone(&Local);
            let time = if dt.date_naive() == today {
                dt.format("%H:%M:%S").to_string()
            } else {
                dt.format("%m-%d %H:%M:%S").to_string()
            };
            Some(CursorRecentRow {
                time,
                model: e.model.clone(),
                tokens: event_tokens(e),
            })
        })
        .take(limit)
        .collect()
}

pub fn event_to_row(e: &UsageEvent) -> CursorUsageEventRow {
    let local = DateTime::from_timestamp_millis(e.ts)
        .map(|d| d.with_timezone(&Local))
        .unwrap_or_else(Local::now);
    CursorUsageEventRow {
        event_key: event_key(e),
        ts: e.ts,
        date: local.format("%Y-%m-%d").to_string(),
        hour: local.hour() as i32,
        model: e.model.clone(),
        kind: e.kind.clone(),
        chargeable: e.chargeable,
        input_tokens: e.input_tokens,
        output_tokens: e.output_tokens,
        cache_read_tokens: e.cache_read_tokens,
        cache_write_tokens: e.cache_write_tokens,
        cost_cents: e.cost_cents,
    }
}

pub fn row_to_event(r: &CursorUsageEventRow) -> UsageEvent {
    UsageEvent {
        ts: r.ts,
        model: r.model.clone(),
        chargeable: r.chargeable,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        cache_read_tokens: r.cache_read_tokens,
        cache_write_tokens: r.cache_write_tokens,
        cost_cents: r.cost_cents,
        kind: r.kind.clone(),
    }
}

pub fn parse_usage_event(raw: &Value) -> Option<UsageEvent> {
    let ts = event_ms(json_i64(raw.get("timestamp")?));
    if ts <= 0 {
        return None;
    }
    let tu = raw.get("tokenUsage").cloned().unwrap_or(Value::Null);
    let cost = raw
        .get("chargedCents")
        .filter(|v| !v.is_null())
        .or_else(|| raw.get("requestsCosts").filter(|v| !v.is_null()))
        .map(json_f64)
        .unwrap_or(0.0);
    Some(UsageEvent {
        ts,
        model: raw
            .get("model")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .trim()
            .to_string(),
        chargeable: raw.get("isChargeable") != Some(&Value::Bool(false)),
        input_tokens: json_i64(tu.get("inputTokens").unwrap_or(&Value::Null)),
        output_tokens: json_i64(tu.get("outputTokens").unwrap_or(&Value::Null)),
        cache_read_tokens: json_i64(tu.get("cacheReadTokens").unwrap_or(&Value::Null)),
        cache_write_tokens: json_i64(tu.get("cacheWriteTokens").unwrap_or(&Value::Null)),
        cost_cents: cost,
        kind: raw
            .get("kind")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn event_ms_promotes_seconds() {
        assert_eq!(event_ms(1_700_000_000), 1_700_000_000_000);
        assert_eq!(event_ms(1_700_000_000_000), 1_700_000_000_000);
    }

    #[test]
    fn event_key_stable() {
        let e = UsageEvent {
            ts: 1,
            model: "claude".into(),
            input_tokens: 2,
            output_tokens: 3,
            cache_read_tokens: 4,
            cache_write_tokens: 5,
            ..Default::default()
        };
        assert_eq!(event_key(&e), "1|claude|2|3|4|5");
    }

    #[test]
    fn auto_bucket_and_composer() {
        let bucket = vec!["auto-model".into()];
        assert!(is_auto_model("auto-model", &bucket));
        assert!(is_auto_model("composer-1", &[]));
        assert!(is_auto_model("default", &[]));
        assert!(!is_auto_model("claude-4-sonnet", &bucket));
    }

    #[test]
    fn normalize_period_and_metrics() {
        let raw = json!({
            "billingCycleStart": "1000",
            "billingCycleEnd": "86400000",
            "autoBucketModels": ["composer"],
            "planUsage": {
                "includedSpend": 2500,
                "remaining": 7500,
                "limit": 10000,
                "totalPercentUsed": 20.0,
                "apiPercentUsed": 8.0,
                "autoPercentUsed": 12.0
            }
        });
        let p = normalize_period(&raw);
        assert_eq!(p.plan_usage.included_spend, 2500);
        assert_eq!(p.plan_usage.remaining, 7500);
        // now = start, elapsed 0 → expected 0, official 20 → overPace
        let m = compute_metrics(&p, 100.0, 1000);
        assert!(m.over_pace);
        assert_eq!(m.quota_used_pct, 25.0);
        assert_eq!(m.official_total_pct, 20.0);
        assert!(m.days_left >= 1);
        assert!(m.daily_budget_cents >= 1);
    }

    #[test]
    fn normalize_summary_nested() {
        let raw = json!({
            "billingCycleStart": 10,
            "billingCycleEnd": 20,
            "individualUsage": { "plan": { "used": 1, "limit": 10, "remaining": 9, "totalPercentUsed": 10 } }
        });
        let p = normalize_summary(&raw);
        assert_eq!(p.plan_usage.included_spend, 1);
        assert_eq!(p.plan_usage.limit, 10);
        assert_eq!(p.cycle_start_ms, 10_000);
    }

    #[test]
    fn categories_split_api_auto() {
        let events = vec![
            UsageEvent {
                model: "claude-4".into(),
                cost_cents: 80.0,
                input_tokens: 10,
                ..Default::default()
            },
            UsageEvent {
                model: "composer-1".into(),
                cost_cents: 20.0,
                input_tokens: 5,
                ..Default::default()
            },
        ];
        let cats = build_categories(&events, &[], Some(40.0), Some(10.0));
        assert_eq!(cats.len(), 2);
        assert_eq!(cats[0].id, "api");
        assert_eq!(cats[0].models[0].model, "claude-4");
        assert_eq!(cats[1].id, "auto_composer");
    }
}
