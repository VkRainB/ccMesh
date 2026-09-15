use tauri::State;

use crate::error::AppResult;
use crate::models::cursor_usage::CursorUsageSnapshot;
use crate::modules::cursor_usage;
use crate::state::AppState;

/// 读取上次用量快照（从未刷新则为 null）。
#[tauri::command]
pub fn get_cursor_usage(state: State<AppState>) -> AppResult<Option<CursorUsageSnapshot>> {
    cursor_usage::load_snapshot(&state.db_pool)
}

/// 从本机凭证 + 官方接口刷新用量并落库。
#[tauri::command]
pub async fn refresh_cursor_usage(state: State<'_, AppState>) -> AppResult<CursorUsageSnapshot> {
    cursor_usage::refresh(state.db_pool.clone()).await
}
