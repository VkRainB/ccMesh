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

/// 本机 pi agent 目录：`~/.pi/agent`。
pub fn pi_agent_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".pi").join("agent"))
}

/// 本机 pi 模型汇总文件：`~/.pi/agent/models.json`。
pub fn pi_models_path() -> Option<PathBuf> {
    pi_agent_dir().map(|d| d.join("models.json"))
}

/// 本机 pi 程序配置文件：`~/.pi/agent/settings.json`。
pub fn pi_settings_path() -> Option<PathBuf> {
    pi_agent_dir().map(|d| d.join("settings.json"))
}

/// 本机 omp agent 目录：`~/.omp/agent`。
pub fn omp_agent_dir() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".omp").join("agent"))
}

fn first_existing_or_default(dir: &PathBuf, candidates: &[&str]) -> PathBuf {
    candidates
        .iter()
        .map(|name| dir.join(name))
        .find(|path| path.exists())
        .unwrap_or_else(|| dir.join(candidates[0]))
}

/// 本机 omp 模型汇总文件，优先 `models.yml`，兼容 `models.yaml` / `models.json`。
pub fn omp_models_path() -> Option<PathBuf> {
    omp_agent_dir()
        .map(|d| first_existing_or_default(&d, &["models.yml", "models.yaml", "models.json"]))
}

/// 本机 omp 程序配置文件，优先 `config.yml`，兼容 `config.yaml` / `settings.json`。
pub fn omp_settings_path() -> Option<PathBuf> {
    omp_agent_dir()
        .map(|d| first_existing_or_default(&d, &["config.yml", "config.yaml", "settings.json"]))
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

/// pi 拆分渠道目录：`<profiles>/pi`（不存在则创建）。
pub fn pi_profiles_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = profiles_dir(app)?.join("pi");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// omp 拆分渠道目录：`<profiles>/omp`（不存在则创建）。
pub fn omp_profiles_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = profiles_dir(app)?.join("omp");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// 宠物资源根：`<app_data_dir>/pets`（不存在则创建）。
pub fn pets_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app_data_dir(app)?.join("pets");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}
