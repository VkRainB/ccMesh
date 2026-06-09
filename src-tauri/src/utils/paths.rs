use std::path::PathBuf;
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};

/// 应用数据目录（不存在则创建）。
pub fn app_data_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Config(format!("无法解析应用数据目录: {e}")))?;
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// SQLite 数据库文件路径：`<app_data_dir>/ccmesh.db`。
pub fn db_path(app: &AppHandle) -> AppResult<PathBuf> {
    Ok(app_data_dir(app)?.join("ccmesh.db"))
}

/// 用户主目录（Windows: `%USERPROFILE%`，Unix: `$HOME`）。用于定位本机工具会话日志。
pub fn home_dir() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
}
