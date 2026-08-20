//! Claude Code 用户级 `~/.claude.json` 开关（与渠道 `settings.json` 无关）。

use crate::error::{AppError, AppResult};
use crate::modules::claude_user_config::{self as cuc, ClaudeUserFlags, ClaudeUserFlagsPatch};
use crate::utils::paths;

fn require_path() -> AppResult<std::path::PathBuf> {
    paths::claude_user_json_path()
        .ok_or_else(|| AppError::Config("无法定位 ~/.claude.json".into()))
}

#[tauri::command]
pub fn get_claude_user_flags() -> AppResult<ClaudeUserFlags> {
    cuc::read_flags(&require_path()?)
}

#[tauri::command]
pub fn set_claude_user_flags(patch: ClaudeUserFlagsPatch) -> AppResult<ClaudeUserFlags> {
    cuc::set_flags(&require_path()?, &patch)
}
