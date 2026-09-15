pub mod api;
pub mod auth;
pub mod metrics;

use std::collections::HashMap;
use std::time::Duration;

use chrono::Local;

use crate::error::{AppError, AppResult};
use crate::models::cursor_usage::{CursorPlanInfo, CursorUsageSnapshot, InterfaceStatus};
use crate::modules::proxy::client::{build_client, should_use_proxy};
use crate::modules::storage::db::DbPool;
use crate::modules::storage::{config_repo, cursor_usage_repo};

const OVERLAP_MS: i64 = 6 * 60 * 60 * 1000;
const HTTP_TIMEOUT: Duration = Duration::from_secs(30);

/// 读本地快照（无则 None）。
pub fn load_snapshot(pool: &DbPool) -> AppResult<Option<CursorUsageSnapshot>> {
    let conn = pool.get()?;
    cursor_usage_repo::load_snapshot(&conn)
}

/// 鉴权 → 两波并发 HTTP → 增量落库 → 聚合写快照。
pub async fn refresh(pool: DbPool) -> AppResult<CursorUsageSnapshot> {
    let started = std::time::Instant::now();
    let pool_auth = pool.clone();
    let (db_path, mut tokens, proxy_enabled, proxy_url, max_ts) =
        tauri::async_runtime::spawn_blocking(move || -> AppResult<_> {
            let conn = pool_auth.get()?;
            let cfg = config_repo::get_config(&conn)?;
            let db_path = auth::find_db()?;
            let tokens = auth::read_auth(&db_path)?;
            let max_ts = cursor_usage_repo::max_ts(&conn)?;
            Ok((db_path, tokens, cfg.proxy_enabled, cfg.proxy_url, max_ts))
        })
        .await
        .map_err(|e| AppError::Unknown(format!("读取 Cursor 凭证失败: {e}")))??;

    let want = should_use_proxy(false, proxy_enabled, &proxy_url);
    let client = build_client(want, &proxy_url, HTTP_TIMEOUT)?;

    let mut warnings = Vec::new();
    if auth::is_expired(&tokens.access_token, 60) {
        if let Some(rt) = tokens.refresh_token.as_deref() {
            match api::refresh_access_token(&client, rt).await {
                Some(new_tok) => tokens.access_token = new_tok,
                None => warnings.push("accessToken 已过期且刷新失败，可能登录失效".into()),
            }
        } else {
            warnings.push("accessToken 已过期".into());
        }
    }

    let token = tokens.access_token.clone();
    let (period_r, plan_r, dash_r) = tokio::join!(
        api::get_current_period_usage(&client, &token),
        api::get_plan_info(&client, &token),
        api::dashboard_period(&client, &token),
    );

    let mut interfaces = HashMap::new();
    let mut period = if period_r.status == Some(200) && period_r.body.get("planUsage").is_some() {
        interfaces.insert(
            "GetCurrentPeriodUsage".into(),
            InterfaceStatus {
                ok: true,
                status: period_r.status,
                ..Default::default()
            },
        );
        metrics::normalize_period(&period_r.body)
    } else {
        let err = api::http_error_msg(&period_r.body).unwrap_or_else(|| "主接口失败".into());
        interfaces.insert(
            "GetCurrentPeriodUsage".into(),
            InterfaceStatus {
                ok: false,
                status: period_r.status,
                error: Some(err.clone()),
                ..Default::default()
            },
        );
        let fb = api::usage_summary(&client, &token).await;
        if fb.status == Some(200)
            && (fb.body.get("individualUsage").is_some() || fb.body.get("planUsage").is_some())
        {
            interfaces.insert(
                "usage-summary(fallback)".into(),
                InterfaceStatus {
                    ok: true,
                    status: fb.status,
                    ..Default::default()
                },
            );
            metrics::normalize_summary(&fb.body)
        } else {
            let err2 = api::http_error_msg(&fb.body).unwrap_or_else(|| "兜底接口失败".into());
            interfaces.insert(
                "usage-summary(fallback)".into(),
                InterfaceStatus {
                    ok: false,
                    status: fb.status,
                    error: Some(err2.clone()),
                    ..Default::default()
                },
            );
            return Err(AppError::Unknown(format!(
                "周期用量获取失败：{err}; {err2}"
            )));
        }
    };

    let mut plan = CursorPlanInfo {
        plan_name: "Unknown".into(),
        ..Default::default()
    };
    if plan_r.status == Some(200) {
        if let Some(p) = plan_r.body.get("planInfo") {
            plan.plan_name = p
                .get("planName")
                .and_then(|v| v.as_str())
                .unwrap_or("Unknown")
                .to_string();
            plan.price = p
                .get("price")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            plan.included_amount_cents = metrics::json_i64(
                p.get("includedAmountCents")
                    .unwrap_or(&serde_json::Value::Null),
            );
        }
        interfaces.insert(
            "GetPlanInfo".into(),
            InterfaceStatus {
                ok: true,
                status: plan_r.status,
                ..Default::default()
            },
        );
    } else {
        interfaces.insert(
            "GetPlanInfo".into(),
            InterfaceStatus {
                ok: false,
                status: plan_r.status,
                ..Default::default()
            },
        );
        warnings.push("GetPlanInfo 失败，档位信息缺失".into());
    }

    if dash_r.status == Some(200) && dash_r.body.get("planUsage").is_some() {
        let dash = metrics::normalize_period(&dash_r.body);
        if dash.plan_usage.api_percent_used.is_some() {
            period.plan_usage.api_percent_used = dash.plan_usage.api_percent_used;
        }
        if dash.plan_usage.auto_percent_used.is_some() {
            period.plan_usage.auto_percent_used = dash.plan_usage.auto_percent_used;
        }
        if dash.plan_usage.bonus_spend > 0 {
            period.plan_usage.bonus_spend = dash.plan_usage.bonus_spend;
        }
        if dash.plan_usage.total_spend > period.plan_usage.total_spend {
            period.plan_usage.total_spend = dash.plan_usage.total_spend;
        }
        if let Some(msg) = dash.display_message {
            period.display_message = Some(msg);
        }
        if !dash.auto_bucket_models.is_empty() {
            period.auto_bucket_models = dash.auto_bucket_models;
        }
        interfaces.insert(
            "get-current-period-usage".into(),
            InterfaceStatus {
                ok: true,
                status: dash_r.status,
                ..Default::default()
            },
        );
    } else {
        interfaces.insert(
            "get-current-period-usage".into(),
            InterfaceStatus {
                ok: false,
                status: dash_r.status,
                error: api::http_error_msg(&dash_r.body),
                ..Default::default()
            },
        );
    }

    if let Some(mt) = period_r
        .body
        .get("membershipType")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
    {
        plan.membership_type = Some(mt);
    }

    let now_ms = chrono::Utc::now().timestamp_millis();
    let cycle_start = period.cycle_start_ms;
    let cycle_end = if period.cycle_end_ms > 0 {
        period.cycle_end_ms.min(now_ms)
    } else {
        now_ms
    };
    let event_start = match max_ts {
        Some(ts) => ts.saturating_sub(OVERLAP_MS).max(cycle_start),
        None => cycle_start,
    }
    .max(0);

    let (new_events, ev_status, _) =
        api::fetch_usage_events(&client, &token, event_start, cycle_end.max(now_ms)).await;
    interfaces.insert("get-filtered-usage-events".into(), ev_status);

    let rows: Vec<_> = new_events.iter().map(metrics::event_to_row).collect();
    let period_for_db = period.clone();
    let plan_for_db = plan.clone();
    let warnings_for_db = warnings.clone();
    let interfaces_for_db = interfaces.clone();
    let email = tokens.email.clone();
    let db_path_str = db_path.display().to_string();

    let snap = tauri::async_runtime::spawn_blocking(move || -> AppResult<CursorUsageSnapshot> {
        let conn = pool.get()?;
        if !rows.is_empty() {
            cursor_usage_repo::upsert_events(&conn, &rows)?;
        }
        let stored = cursor_usage_repo::events_in_range(
            &conn,
            period_for_db.cycle_start_ms,
            cycle_end.max(now_ms),
        )?;
        let events: Vec<_> = stored.iter().map(metrics::row_to_event).collect();
        let now = Local::now();
        let today = metrics::today_cents(&events, now);
        let metrics_out = metrics::compute_metrics(&period_for_db, today, now_ms);
        let categories = metrics::build_categories(
            &events,
            &period_for_db.auto_bucket_models,
            period_for_db.plan_usage.api_percent_used,
            period_for_db.plan_usage.auto_percent_used,
        );
        let snap = CursorUsageSnapshot {
            fetched_at: now_ms,
            email,
            db_path: db_path_str,
            plan: plan_for_db,
            period: period_for_db,
            metrics: metrics_out,
            categories,
            daily: metrics::daily_series(&events),
            hourly: metrics::hourly_series(&events, now),
            recent: metrics::recent_requests(&events, now, 100),
            interfaces: interfaces_for_db,
            warnings: warnings_for_db,
        };
        cursor_usage_repo::save_snapshot(&conn, &snap)?;
        // 保留最近 90 天事件（覆盖 3 个月度计费周期），清理更早的无用历史
        let cutoff = now_ms - 90 * 86_400_000;
        let purged = cursor_usage_repo::purge_old_events(&conn, cutoff)?;
        if purged > 0 {
            tracing::info!(purged, "清理 90 天前的 cursor 用量事件");
        }
        Ok(snap)
    })
    .await
    .map_err(|e| AppError::Unknown(format!("写入用量快照失败: {e}")))??;

    tracing::info!(
        elapsed_ms = started.elapsed().as_millis() as u64,
        events = new_events.len(),
        "cursor usage refresh done"
    );
    Ok(snap)
}
