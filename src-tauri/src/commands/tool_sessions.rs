use crate::error::{AppError, AppResult};
use crate::modules::tool_sessions::{
    self, DeleteSessionOutcome, DeleteSessionRequest, SessionMessage, SessionMeta,
};

fn map_session_err(err: String) -> AppError {
    let lower = err.to_ascii_lowercase();
    if lower.contains("unsupported provider")
        || lower.contains("outside provider roots")
        || lower.contains("mismatch")
        || lower.contains("invalid")
    {
        AppError::InvalidArgument(err)
    } else if lower.contains("not found") {
        AppError::NotFound(err)
    } else {
        AppError::Unknown(err)
    }
}

/// 扫描本机 Claude / Codex 工具会话列表。
#[tauri::command]
pub async fn list_tool_sessions() -> AppResult<Vec<SessionMeta>> {
    tauri::async_runtime::spawn_blocking(tool_sessions::scan_sessions)
        .await
        .map_err(|e| AppError::Unknown(format!("扫描工具会话失败: {e}")))
}

/// 读取指定工具会话的消息记录。
#[tauri::command]
pub async fn get_tool_session_messages(
    provider_id: String,
    source_path: String,
) -> AppResult<Vec<SessionMessage>> {
    tauri::async_runtime::spawn_blocking(move || {
        tool_sessions::load_messages(&provider_id, &source_path)
    })
    .await
    .map_err(|e| AppError::Unknown(format!("加载工具会话消息失败: {e}")))?
    .map_err(map_session_err)
}

/// 删除单个工具会话文件。
#[tauri::command]
pub async fn delete_tool_session(
    provider_id: String,
    session_id: String,
    source_path: String,
) -> AppResult<bool> {
    tauri::async_runtime::spawn_blocking(move || {
        tool_sessions::delete_session(&provider_id, &session_id, &source_path)
    })
    .await
    .map_err(|e| AppError::Unknown(format!("删除工具会话失败: {e}")))?
    .map_err(map_session_err)
}

/// 批量删除工具会话。
#[tauri::command]
pub async fn delete_tool_sessions(
    items: Vec<DeleteSessionRequest>,
) -> AppResult<Vec<DeleteSessionOutcome>> {
    tauri::async_runtime::spawn_blocking(move || tool_sessions::delete_sessions(&items))
        .await
        .map_err(|e| AppError::Unknown(format!("批量删除工具会话失败: {e}")))
}
