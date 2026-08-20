use tauri::State;

use crate::error::{AppError, AppResult};
use crate::models::usage::{DailyUsage, DayModelUsage, ModelUsage, UsageSummary, UsageSyncResult};
use crate::modules::storage::usage_repo::{self, UsageFilter};
use crate::modules::usage_local;
use crate::state::AppState;

/// 触发一次本机用量增量同步（读取 ~/.claude 与 ~/.codex 会话日志）。
///
/// 首次为全量解析，文件量大时耗时较长，故在阻塞线程池执行，避免卡死主线程。
#[tauri::command]
pub async fn sync_session_usage(state: State<'_, AppState>) -> AppResult<UsageSyncResult> {
    let pool = state.db_pool.clone();
    tauri::async_runtime::spawn_blocking(move || -> AppResult<UsageSyncResult> {
        let conn = pool.get()?;
        Ok(usage_local::sync_all(&conn))
    })
    .await
    .map_err(|e| AppError::Unknown(format!("用量同步任务失败: {e}")))?
}

/// 组装查询过滤：date 闭区间[YYYY-MM-DD]（预设周期）或 ts 毫秒闭区间（自定义时分范围）。
fn filter_of<'a>(
    start: &'a Option<String>,
    end: &'a Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    app_type: &'a Option<String>,
) -> UsageFilter<'a> {
    UsageFilter {
        start: start.as_deref(),
        end: end.as_deref(),
        start_ts,
        end_ts,
        app_type: app_type.as_deref(),
    }
}

/// 用量总览。
#[tauri::command]
pub fn get_usage_summary(
    state: State<AppState>,
    start: Option<String>,
    end: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    app_type: Option<String>,
) -> AppResult<UsageSummary> {
    let conn = state.db_pool.get()?;
    usage_repo::summary(&conn, &filter_of(&start, &end, start_ts, end_ts, &app_type))
}

/// 按模型聚合用量。
#[tauri::command]
pub fn get_usage_by_model(
    state: State<AppState>,
    start: Option<String>,
    end: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    app_type: Option<String>,
) -> AppResult<Vec<ModelUsage>> {
    let conn = state.db_pool.get()?;
    usage_repo::by_model(&conn, &filter_of(&start, &end, start_ts, end_ts, &app_type))
}

/// 按天聚合用量。
#[tauri::command]
pub fn get_usage_by_day(
    state: State<AppState>,
    start: Option<String>,
    end: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    app_type: Option<String>,
) -> AppResult<Vec<DailyUsage>> {
    let conn = state.db_pool.get()?;
    usage_repo::by_day(&conn, &filter_of(&start, &end, start_ts, end_ts, &app_type))
}

/// 按本地小时聚合用量。`date` 为 `YYYY-MM-DD HH:00`；无 ts 的行不计入。
#[tauri::command]
pub fn get_usage_by_hour(
    state: State<AppState>,
    start: Option<String>,
    end: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    app_type: Option<String>,
) -> AppResult<Vec<DailyUsage>> {
    let conn = state.db_pool.get()?;
    usage_repo::by_hour(&conn, &filter_of(&start, &end, start_ts, end_ts, &app_type))
}

/// 按天 × 来源 × 模型聚合（多维合并表）。
#[tauri::command]
pub fn get_usage_by_day_model(
    state: State<AppState>,
    start: Option<String>,
    end: Option<String>,
    start_ts: Option<i64>,
    end_ts: Option<i64>,
    app_type: Option<String>,
) -> AppResult<Vec<DayModelUsage>> {
    let conn = state.db_pool.get()?;
    usage_repo::by_day_model(&conn, &filter_of(&start, &end, start_ts, end_ts, &app_type))
}
