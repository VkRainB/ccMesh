//! 配置文件管理命令（Claude Code / Codex 渠道的 抽取/存储/应用/覆盖；
//! 以及 Claude Desktop 真实文件接管）。

use serde_json::Value;
use tauri::AppHandle;

use crate::error::AppResult;
use crate::models::claude_desktop_config::{
    ApplyClaudeDesktop3pRequest, ApplyClaudeDesktop3pResult, ClaudeDesktopPathsDto,
    ClaudeDesktopProfileDataDto, ClaudeDesktopProfileMetaDto, SaveClaudeDesktopProfileRequest,
    SetClaudeDesktop3pEnabledRequest,
};
use crate::models::tool_config::{
    ChannelData, ChannelMeta, ClaudeOperationFields, CodexOperationFields, ExtractResult,
    SaveChannelRequest,
};
use crate::modules::tool_config::{self as tc, Tool};

#[tauri::command]
pub fn list_profile_channels(app: AppHandle, app_type: String) -> AppResult<Vec<ChannelMeta>> {
    tc::list_channels(&app, Tool::from_str(&app_type)?)
}

#[tauri::command]
pub fn get_profile_channel(app: AppHandle, app_type: String, id: String) -> AppResult<ChannelData> {
    tc::get_channel(&app, Tool::from_str(&app_type)?, &id)
}

#[tauri::command]
pub fn save_profile_channel(
    app: AppHandle,
    app_type: String,
    req: SaveChannelRequest,
) -> AppResult<ChannelMeta> {
    tc::save_channel(&app, Tool::from_str(&app_type)?, req)
}

#[tauri::command]
pub fn delete_profile_channel(app: AppHandle, app_type: String, id: String) -> AppResult<()> {
    tc::delete_channel(&app, Tool::from_str(&app_type)?, &id)
}

#[tauri::command]
pub fn extract_source_record(app: AppHandle, app_type: String) -> AppResult<ExtractResult> {
    tc::extract_record(&app, Tool::from_str(&app_type)?)
}

#[tauri::command]
pub fn apply_profile_config(app: AppHandle, app_type: String, snapshot: Value) -> AppResult<()> {
    tc::apply_config(&app, Tool::from_str(&app_type)?, snapshot)
}

#[tauri::command]
pub fn preview_claude_settings(base: Value, fields: ClaudeOperationFields) -> AppResult<Value> {
    Ok(tc::claude::merge_operation_fields(&base, &fields))
}

#[tauri::command]
pub fn parse_claude_fields(snapshot: Value) -> AppResult<ClaudeOperationFields> {
    Ok(tc::claude::parse_operation_fields(&snapshot))
}

#[tauri::command]
pub fn preview_codex_config(
    config_toml: String,
    fields: CodexOperationFields,
    goal_mode: Option<bool>,
) -> AppResult<String> {
    tc::codex::build_codex_config(&config_toml, &fields, goal_mode)
}

#[tauri::command]
pub fn parse_codex_fields(auth: Value, config_toml: String) -> AppResult<CodexOperationFields> {
    Ok(tc::codex::parse_operation_fields(&auth, &config_toml))
}

// ─── Claude Desktop（真实文件接管）──────────────────────────

#[tauri::command]
pub fn resolve_claude_desktop_paths() -> AppResult<ClaudeDesktopPathsDto> {
    tc::claude_desktop::resolve_paths()
}

#[tauri::command]
pub fn list_claude_desktop_profiles() -> AppResult<Vec<ClaudeDesktopProfileMetaDto>> {
    tc::claude_desktop::list_profiles()
}

#[tauri::command]
pub fn get_claude_desktop_profile(id: String) -> AppResult<ClaudeDesktopProfileDataDto> {
    tc::claude_desktop::get_profile(&id)
}

#[tauri::command]
pub fn save_claude_desktop_profile(
    app: AppHandle,
    req: SaveClaudeDesktopProfileRequest,
) -> AppResult<ClaudeDesktopProfileMetaDto> {
    tc::claude_desktop::save_profile(&app, req)
}

#[tauri::command]
pub fn unregister_claude_desktop_profile(app: AppHandle, id: String) -> AppResult<()> {
    tc::claude_desktop::unregister_profile(&app, &id)
}

#[tauri::command]
pub fn delete_claude_desktop_profile_file(app: AppHandle, id: String) -> AppResult<()> {
    tc::claude_desktop::delete_profile_file(&app, &id)
}

/// 默认删除：解除 `_meta.json` 注册，并删除真实 `<profile-id>.json`。
#[tauri::command]
pub fn delete_claude_desktop_profile(app: AppHandle, id: String) -> AppResult<()> {
    tc::claude_desktop::delete_profile(&app, &id)
}

#[tauri::command]
pub fn apply_claude_desktop_3p_mode(
    app: AppHandle,
    req: ApplyClaudeDesktop3pRequest,
) -> AppResult<ApplyClaudeDesktop3pResult> {
    tc::claude_desktop::apply_3p_mode(&app, req)
}

#[tauri::command]
pub fn set_claude_desktop_3p_enabled(
    app: AppHandle,
    req: SetClaudeDesktop3pEnabledRequest,
) -> AppResult<ApplyClaudeDesktop3pResult> {
    tc::claude_desktop::set_3p_enabled(&app, req)
}
