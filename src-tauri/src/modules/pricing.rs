use chrono::{DateTime, Datelike, Duration, LocalResult, Offset, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use rust_decimal::{Decimal, RoundingStrategy};

use crate::error::{AppError, AppResult};
use crate::models::endpoint::Endpoint;
use crate::models::pricing::{CostBreakdown, ModelPriceQuote, ModelPricing, PriceRates, PriceWindow, PricingSnapshot};
use crate::modules::proxy::resolver;
use crate::modules::usage::TokenUsage;

const WEEK_MINUTES: i32 = 7 * 1440;

fn invalid(message: &str) -> AppError {
    AppError::InvalidArgument(message.into())
}

fn rate(value: &str) -> AppResult<Decimal> {
    let (integer, fraction) = value.split_once('.').unwrap_or((value, ""));
    if integer.is_empty()
        || !integer.bytes().all(|c| c.is_ascii_digit())
        || !fraction.bytes().all(|c| c.is_ascii_digit())
        || (value.contains('.') && fraction.is_empty())
        || fraction.len() > 9
    {
        return Err(invalid("价格必须是非负十进制数（最多 9 位小数）"));
    }
    Decimal::from_str_exact(value)
        .map_err(|_| invalid("价格必须是非负十进制数（数值超出支持范围）"))
}

fn validate_rates(rates: &PriceRates) -> AppResult<()> {
    for value in [&rates.input, &rates.output, &rates.cache_read, &rates.cache_write] {
        rate(value)?;
    }
    Ok(())
}

fn interval(window: &PriceWindow, weekday: u8) -> (i32, i32) {
    let start = (i32::from(weekday) - 1) * 1440 + i32::from(window.start_minute);
    let length = if window.end_minute > window.start_minute {
        i32::from(window.end_minute - window.start_minute)
    } else {
        1440 - i32::from(window.start_minute) + i32::from(window.end_minute)
    };
    (start, start + length)
}

fn validate_model(model: &ModelPricing) -> AppResult<Tz> {
    if model.model_id.trim().is_empty() || model.model_id.trim() != model.model_id {
        return Err(invalid("请输入准确的模型 ID（不能包含首尾空格）"));
    }
    let timezone = model.timezone.parse::<Tz>().map_err(|_| invalid("请选择有效时区"))?;
    validate_rates(&model.base_rates)?;
    for (index, window) in model.windows.iter().enumerate() {
        if window.id.trim().is_empty() || model.windows[..index].iter().any(|w| w.id == window.id) {
            return Err(invalid("价格时段 ID 不能为空或重复"));
        }
        if window.weekdays.is_empty()
            || window.weekdays.iter().enumerate().any(|(i, day)| !(1..=7).contains(day) || window.weekdays[..i].contains(day))
        {
            return Err(invalid("请选择有效且不重复的星期（1–7）"));
        }
        if window.start_minute >= 1440 || window.end_minute > 1440 || window.start_minute == window.end_minute {
            return Err(invalid("价格时段起止分钟无效；全天请使用 00:00–24:00"));
        }
        validate_rates(&window.rates)?;
        // ponytail: O(windows² × weekdays²), bounded by user-authored rules, without a per-request week bitmap.
        // If rule sets become large, compile sorted intervals at endpoint load time.
        for other in &model.windows[..index] {
            for &day in &window.weekdays {
                let (start, end) = interval(window, day);
                for &other_day in &other.weekdays {
                    let (other_start, other_end) = interval(other, other_day);
                    for shift in [-WEEK_MINUTES, 0, WEEK_MINUTES] {
                        if start < other_end + shift && other_start + shift < end {
                            return Err(invalid("该模型存在重叠的价格时段"));
                        }
                    }
                }
            }
        }
    }
    Ok(timezone)
}

pub fn validate_model_pricing(prices: &[ModelPricing]) -> AppResult<()> {
    for (index, model) in prices.iter().enumerate() {
        if prices[..index].iter().any(|other| other.model_id == model.model_id) {
            return Err(invalid("模型价格 ID 不能重复"));
        }
        validate_model(model)?;
    }
    Ok(())
}

fn instant(at_ms: i64) -> AppResult<DateTime<Utc>> {
    DateTime::from_timestamp_millis(at_ms)
        .filter(|at| at.checked_sub_signed(Duration::days(2)).is_some()
            && at.checked_add_signed(Duration::days(18)).is_some())
        .ok_or_else(|| invalid("报价时间超出支持范围"))
}

fn window_at(model: &ModelPricing, timezone: Tz, at: DateTime<Utc>) -> Option<&PriceWindow> {
    let local = at.with_timezone(&timezone);
    let minute = local.weekday().num_days_from_monday() as i32 * 1440
        + local.hour() as i32 * 60 + local.minute() as i32;
    model.windows.iter().find(|window| window.weekdays.iter().any(|&day| {
        let (start, end) = interval(window, day);
        (start <= minute && minute < end) || (start <= minute + WEEK_MINUTES && minute + WEEK_MINUTES < end)
    }))
}

fn snapshot(model: &ModelPricing, timezone: Tz, at: DateTime<Utc>) -> PricingSnapshot {
    let window = window_at(model, timezone, at);
    PricingSnapshot {
        model_id: model.model_id.clone(),
        timezone: model.timezone.clone(),
        source: if window.is_some() { "window" } else { "base" }.into(),
        rule_id: window.map(|w| w.id.clone()),
        rule_name: window.map(|w| w.name.clone()),
        rates: window.map_or(&model.base_rates, |w| &w.rates).clone(),
    }
}

pub fn resolve_price(endpoint: &Endpoint, outbound_model: &str, at_ms: i64) -> AppResult<Option<PricingSnapshot>> {
    let table = crate::modules::pricing_auto::table();
    let guard = table.read().unwrap_or_else(|error| error.into_inner());
    resolve_with_table(endpoint, outbound_model, at_ms, &guard)
}

/// 端点配置优先；未配置时用 models.dev 自动价兜底，快照标记 `source = "auto"`。
pub(crate) fn resolve_with_table(
    endpoint: &Endpoint,
    outbound_model: &str,
    at_ms: i64,
    auto: &crate::modules::pricing_auto::AutoPriceTable,
) -> AppResult<Option<PricingSnapshot>> {
    let mut matches = endpoint.model_pricing.iter().filter(|model| model.model_id == outbound_model);
    let Some(model) = matches.next() else {
        return Ok(auto.lookup(outbound_model).map(|rates| PricingSnapshot {
            model_id: outbound_model.to_string(),
            timezone: "UTC".into(),
            source: "auto".into(),
            rule_id: None,
            rule_name: None,
            rates: rates.clone(),
        }));
    };
    if matches.next().is_some() {
        return Err(invalid("模型价格 ID 不能重复"));
    }
    let timezone = validate_model(model)?;
    Ok(Some(snapshot(model, timezone, instant(at_ms)?)))
}

pub fn calculate_cost(rates: &PriceRates, usage: &TokenUsage) -> AppResult<CostBreakdown> {
    fn part(value: &str, tokens: i64) -> AppResult<Decimal> {
        if tokens < 0 {
            return Err(invalid("Token 用量不能为负数"));
        }
        rate(value)?.checked_mul(Decimal::from(tokens))
            .and_then(|cost| cost.checked_div(Decimal::from(1_000_000)))
            .map(|cost| cost.round_dp_with_strategy(12, RoundingStrategy::MidpointAwayFromZero))
            .ok_or_else(|| invalid("估算成本超出支持范围"))
    }
    let input = part(&rates.input, usage.input)?;
    let output = part(&rates.output, usage.output)?;
    let cache_read = part(&rates.cache_read, usage.cache_read)?;
    let cache_write = part(&rates.cache_write, usage.cache_creation)?;
    let total = input.checked_add(output).and_then(|v| v.checked_add(cache_read))
        .and_then(|v| v.checked_add(cache_write)).ok_or_else(|| invalid("估算成本超出支持范围"))?;
    Ok(CostBreakdown {
        input: input.normalize().to_string(),
        output: output.normalize().to_string(),
        cache_read: cache_read.normalize().to_string(),
        cache_write: cache_write.normalize().to_string(),
        total: total.normalize().to_string(),
    })
}

// Query-only: enumerate wall-clock boundaries (including both sides of a repeated hour),
// plus actual UTC offset transitions. Request pricing never computes the next change.
fn next_change(model: &ModelPricing, timezone: Tz, at: DateTime<Utc>) -> AppResult<Option<i64>> {
    if model.windows.is_empty() {
        return Ok(None);
    }
    let mut candidates = Vec::new();
    let date = at.with_timezone(&timezone).date_naive();
    // Two weekly repetitions cover a window skipped by a DST gap / date-line jump.
    for days in -1..=15 {
        let day = date.checked_add_signed(Duration::days(days)).ok_or_else(|| invalid("报价时间超出支持范围"))?;
        for window in &model.windows {
            if !window.weekdays.contains(&(day.weekday().number_from_monday() as u8)) {
                continue;
            }
            let midnight = day.and_hms_opt(0, 0, 0).ok_or_else(|| invalid("报价时间超出支持范围"))?;
            let end = i64::from(window.end_minute) + if window.end_minute < window.start_minute { 1440 } else { 0 };
            for minute in [i64::from(window.start_minute), end] {
                let local = midnight.checked_add_signed(Duration::minutes(minute)).ok_or_else(|| invalid("报价时间超出支持范围"))?;
                match timezone.from_local_datetime(&local) {
                    LocalResult::Single(t) => candidates.push(t.with_timezone(&Utc)),
                    LocalResult::Ambiguous(a, b) => {
                        candidates.push(a.with_timezone(&Utc));
                        candidates.push(b.with_timezone(&Utc));
                    }
                    LocalResult::None => {} // Gap crossing is handled by the offset transition below.
                }
            }
        }
    }
    // ponytail: query-side maximum 384 hourly probes, not minute scans on the hot path.
    // IANA transitions are separated by more than an hour; if that guarantee changes,
    // replace this bounded offset search with a timezone transition-table iterator.
    let offset = |t: DateTime<Utc>| t.with_timezone(&timezone).offset().fix().local_minus_utc();
    let mut left = at;
    for _ in 0..384 {
        let right = left.checked_add_signed(Duration::hours(1)).ok_or_else(|| invalid("报价时间超出支持范围"))?;
        if offset(left) != offset(right) {
            let original = offset(left);
            let (mut lo, mut hi) = (left.timestamp(), right.timestamp());
            while hi - lo > 1 {
                let middle = lo + (hi - lo) / 2;
                let time = DateTime::from_timestamp(middle, 0).ok_or_else(|| invalid("报价时间超出支持范围"))?;
                if offset(time) == original { lo = middle; } else { hi = middle; }
            }
            candidates.push(DateTime::from_timestamp(hi, 0).ok_or_else(|| invalid("报价时间超出支持范围"))?);
        }
        left = right;
    }
    candidates.sort_unstable();
    candidates.dedup();
    let current = window_at(model, timezone, at).map(|w| w.id.as_str());
    Ok(candidates.into_iter().filter(|candidate| *candidate > at)
        .find(|candidate| window_at(model, timezone, *candidate).map(|w| w.id.as_str()) != current)
        .map(|candidate| candidate.timestamp_millis()))
}

pub fn quote_models(endpoint: &Endpoint, model_ids: Option<Vec<String>>, at_ms: i64) -> AppResult<Vec<ModelPriceQuote>> {
    validate_model_pricing(&endpoint.model_pricing)?;
    let at = instant(at_ms)?;
    let requested = model_ids.unwrap_or_else(|| {
        let mut models = resolver::advertised_models(endpoint);
        for model in endpoint.models.iter().chain(endpoint.model_pricing.iter().map(|p| &p.model_id)) {
            if !models.contains(model) {
                models.push(model.clone());
            }
        }
        models
    });
    let mut quotes = Vec::with_capacity(requested.len());
    for requested_model in requested {
        let model_id = resolver::resolve_outbound(endpoint, Some(&requested_model)).unwrap_or_else(|| requested_model.clone());
        let selected = resolve_price(endpoint, &model_id, at_ms)?;
        let configured = endpoint.model_pricing.iter().find(|model| model.model_id == model_id);
        let next_change_at = if let Some(model) = configured {
            next_change(model, model.timezone.parse::<Tz>().map_err(|_| invalid("请选择有效时区"))?, at)?
        } else { None };
        quotes.push(ModelPriceQuote {
            requested_model,
            model_id,
            base_rates: configured.map(|model| model.base_rates.clone()),
            effective_rates: selected.as_ref().map(|value| value.rates.clone()),
            timezone: selected.as_ref().map(|value| value.timezone.clone()),
            rule_id: selected.as_ref().and_then(|value| value.rule_id.clone()),
            rule_name: selected.as_ref().and_then(|value| value.rule_name.clone()),
            source: selected.map(|value| value.source),
            at: at_ms,
            next_change_at,
        });
    }
    Ok(quotes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rates(value: &str) -> PriceRates {
        PriceRates { input: value.into(), output: value.into(), cache_read: value.into(), cache_write: value.into() }
    }
    fn model(zone: &str, days: Vec<u8>, start: u16, end: u16) -> ModelPricing {
        ModelPricing {
            model_id: "vendor/model".into(), timezone: zone.into(), base_rates: rates("2"),
            windows: vec![PriceWindow { id: "off".into(), name: "谷".into(), weekdays: days, start_minute: start, end_minute: end, rates: rates("1") }],
        }
    }
    fn utc(value: &str) -> DateTime<Utc> { value.parse().unwrap() }

    #[test]
    fn week_wrap_half_open_and_overlap_validation() {
        let mut p = model("UTC", vec![7], 22 * 60, 8 * 60);
        validate_model_pricing(&[p.clone()]).unwrap();
        assert!(window_at(&p, Tz::UTC, utc("2026-11-08T21:59:59Z")).is_none());
        assert!(window_at(&p, Tz::UTC, utc("2026-11-08T22:00:00Z")).is_some());
        assert!(window_at(&p, Tz::UTC, utc("2026-11-09T07:59:59Z")).is_some());
        assert!(window_at(&p, Tz::UTC, utc("2026-11-09T08:00:00Z")).is_none());
        let mut overlap = p.windows[0].clone();
        overlap.id = "second".into(); overlap.weekdays = vec![1]; overlap.start_minute = 7 * 60; overlap.end_minute = 9 * 60;
        p.windows.push(overlap);
        assert!(validate_model_pricing(&[p.clone()]).is_err());
        p.windows[1].start_minute = 8 * 60;
        validate_model_pricing(&[p]).unwrap();
    }

    #[test]
    fn rejects_invalid_zone_days_minutes_and_duplicate_models() {
        let p = model("Asia/Shanghai", vec![5], 0, 1440);
        validate_model_pricing(&[p.clone()]).unwrap();
        assert!(validate_model_pricing(&[p.clone(), p.clone()]).is_err());
        let mut bad = p.clone(); bad.timezone = "not/a-zone".into();
        assert!(validate_model_pricing(&[bad]).is_err());
        for days in [vec![], vec![0], vec![8], vec![5, 5]] {
            let mut bad = p.clone(); bad.windows[0].weekdays = days;
            assert!(validate_model_pricing(&[bad]).is_err());
        }
        for (start, end) in [(0, 0), (1440, 60), (0, 1441)] {
            let mut bad = p.clone(); bad.windows[0].start_minute = start; bad.windows[0].end_minute = end;
            assert!(validate_model_pricing(&[bad]).is_err());
        }
        assert!(instant(i64::MAX).is_err());
    }

    #[test]
    fn dst_repeated_hour_and_skipped_boundary_next_change() {
        let tz: Tz = "America/New_York".parse().unwrap();
        let p = model("America/New_York", vec![7], 90, 120);
        assert!(window_at(&p, tz, utc("2026-11-01T05:45:00Z")).is_some());
        assert!(window_at(&p, tz, utc("2026-11-01T06:45:00Z")).is_some());
        assert_eq!(next_change(&p, tz, utc("2026-11-01T05:45:00Z")).unwrap(), Some(utc("2026-11-01T06:00:00Z").timestamp_millis()));
        assert_eq!(next_change(&p, tz, utc("2026-11-01T06:00:00Z")).unwrap(), Some(utc("2026-11-01T06:30:00Z").timestamp_millis()));
        let gap = model("America/New_York", vec![7], 150, 240);
        assert_eq!(next_change(&gap, tz, utc("2026-03-08T06:59:00Z")).unwrap(), Some(utc("2026-03-08T07:00:00Z").timestamp_millis()));
    }

    #[test]
    fn decimal_buckets_round_individually_and_reject_invalid_rates() {
        let usage = TokenUsage { input: 1, output: 1, cache_read: 1, cache_creation: 1, ..Default::default() };
        let cost = calculate_cost(&rates("0.0000005"), &usage).unwrap();
        assert_eq!(cost.total, "0.000000000004");
        assert_eq!(calculate_cost(&rates("0"), &usage).unwrap().total, "0");
        for invalid in ["", "-1", "NaN", "inf", "1e3", "0.0000000001", ".5", "1."] {
            assert!(calculate_cost(&rates(invalid), &usage).is_err());
        }
        assert!(calculate_cost(&rates("79228162514264337593543950335"), &TokenUsage { input: 2, ..Default::default() }).is_err());
        let distinct = PriceRates { input: "1".into(), output: "2".into(), cache_read: "3".into(), cache_write: "4".into() };
        assert_eq!(calculate_cost(&distinct, &TokenUsage { input: 1_000_000, output: 2_000_000, cache_read: 3_000_000, cache_creation: 4_000_000, ..Default::default() }).unwrap().total, "30");
    }

    #[test]
    fn endpoint_price_wins_over_auto_and_auto_matches_normalized_ids() {
        use crate::modules::pricing_auto::AutoPriceTable;
        let endpoint = Endpoint {
            id: 1, name: "t".into(), api_url: "https://x".into(), api_key: String::new(),
            auth_mode: "api_key".into(), enabled: true, use_proxy: false, transformer: "openai".into(),
            model: String::new(), models: Vec::new(), active_models: Vec::new(),
            model_pricing: vec![ModelPricing {
                model_id: "vendor/model".into(),
                timezone: "UTC".into(),
                base_rates: rates("2"),
                windows: Vec::new(),
            }],
            model_mappings: Vec::new(), model_mappings_enabled: true,
            header_overrides: Vec::new(), header_overrides_enabled: false,
            remark: String::new(), sort_order: 0, fast: false, fast_sort_order: 0,
            test_status: "unknown".into(), created_at: String::new(), updated_at: String::new(),
            archived: false,
        };
        let auto = AutoPriceTable {
            version: 1, fetched_at: 1, source: "test".into(),
            models: std::collections::HashMap::from([
                ("vendor/model".to_string(), rates("9")),
                ("gpt-5".to_string(), rates("1")),
            ]),
        };
        let at = utc("2026-11-08T12:00:00Z").timestamp_millis();
        let manual = resolve_with_table(&endpoint, "vendor/model", at, &auto).unwrap().unwrap();
        assert_eq!((manual.source.as_str(), manual.rates.input.as_str()), ("base", "2"));
        let fallback = resolve_with_table(&endpoint, "openai/gpt-5", at, &auto).unwrap().unwrap();
        assert_eq!((fallback.source.as_str(), fallback.rates.input.as_str()), ("auto", "1"));
        assert!(resolve_with_table(&endpoint, "missing", at, &auto).unwrap().is_none());
    }
}
