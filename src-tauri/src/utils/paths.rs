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

/// 本机 Claude Code 配置文件：`~/.claude/settings.json`。
pub fn claude_settings_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude").join("settings.json"))
}

/// 本机 Codex 鉴权文件：`~/.codex/auth.json`。
pub fn codex_auth_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".codex").join("auth.json"))
}

/// 本机 Codex 主配置文件：`~/.codex/config.toml`。
pub fn codex_config_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".codex").join("config.toml"))
}

/// 渠道工作目录根：`<app_data_dir>/profiles`（不存在则创建）。
pub fn profiles_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?.join("profiles");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Claude 渠道目录：`<profiles>/claude_code`（不存在则创建）。
pub fn claude_profiles_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = profiles_dir(app)?.join("claude_code");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Codex 渠道目录：`<profiles>/codex`（不存在则创建）。
pub fn codex_profiles_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = profiles_dir(app)?.join("codex");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 宠物资源根：`<app_data_dir>/pets`（不存在则创建）。
pub fn pets_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?.join("pets");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
