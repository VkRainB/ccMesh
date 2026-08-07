//! 配置文件管理：抽取(extract) → 存储(save) → 应用(apply) → 覆盖(overwrite) 编排。
//!
//! - 渠道工作目录：`<app_data_dir>/profiles/{claude_code|codex}/<id>/`，
//!   内含 `meta.json` 与快照文件（Claude=`settings.json`，Codex=`config.json`）。
//! - `*.record.json`：抽取源配置时写入的基线备份（非渠道）。
//! - `backups/`：每次"应用"覆写真实文件前的带时间戳备份。
//! - 所有写盘走 [`crate::utils::atomic_write`]。

pub mod claude;
pub mod claude_desktop;
pub mod codex;

use std::fs;
use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::models::tool_config::{ChannelData, ChannelMeta, ExtractResult, SaveChannelRequest};
use crate::utils::atomic_write::{atomic_write, atomic_write_str};
use crate::utils::paths;

/// 受支持的工具类型。
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Claude,
    Codex,
}

impl Tool {
    pub fn from_str(s: &str) -> AppResult<Tool> {
        match s {
            "claude" => Ok(Tool::Claude),
            "codex" => Ok(Tool::Codex),
            other => Err(AppError::InvalidArgument(format!("未知工具类型: {other}"))),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Tool::Claude => "claude",
            Tool::Codex => "codex",
        }
    }

    /// 渠道目录下的快照文件名。
    fn snapshot_file(self) -> &'static str {
        match self {
            Tool::Claude => "settings.json",
            Tool::Codex => "config.json",
        }
    }

    fn record_file(self) -> &'static str {
        match self {
            Tool::Claude => "claude.record.json",
            Tool::Codex => "codex.record.json",
        }
    }
}

fn tool_root(app: &AppHandle, tool: Tool) -> AppResult<PathBuf> {
    match tool {
        Tool::Claude => paths::claude_profiles_dir(app),
        Tool::Codex => paths::codex_profiles_dir(app),
    }
}

fn channel_dir(app: &AppHandle, tool: Tool, id: &str) -> AppResult<PathBuf> {
    if id.is_empty() || id.contains(['/', '\\', '.']) {
        return Err(AppError::InvalidArgument(format!("非法渠道 id: {id}")));
    }
    Ok(tool_root(app, tool)?.join(id))
}

fn read_json<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::InvalidArgument(format!("解析失败 {}: {e}", path.display())))
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value)?;
    atomic_write_str(path, &text)
}

fn now_rfc3339() -> String {
    chrono::Local::now().to_rfc3339()
}

/// 覆写真实文件前，把原文件复制一份带时间戳的备份到 `<tool_root>/backups/`。
fn backup_live(app: &AppHandle, tool: Tool, src: &Path, prefix: &str, ext: &str) -> AppResult<()> {
    if !src.exists() {
        return Ok(());
    }
    let backups = tool_root(app, tool)?.join("backups");
    fs::create_dir_all(&backups)?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f");
    let dest = backups.join(format!("{prefix}-{ts}.{ext}"));
    let data = fs::read(src)?;
    atomic_write(&dest, &data)?;
    Ok(())
}

/// 列出某工具的全部渠道（读各渠道目录下 `meta.json`），按名称排序。
pub fn list_channels(app: &AppHandle, tool: Tool) -> AppResult<Vec<ChannelMeta>> {
    let root = tool_root(app, tool)?;
    let mut out: Vec<ChannelMeta> = Vec::new();
    let Ok(entries) = fs::read_dir(&root) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        if path.file_name().and_then(|n| n.to_str()) == Some("backups") {
            continue;
        }
        let meta_path = path.join("meta.json");
        if let Ok(meta) = read_json::<ChannelMeta>(&meta_path) {
            out.push(meta);
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// 读取单个渠道完整数据。
pub fn get_channel(app: &AppHandle, tool: Tool, id: &str) -> AppResult<ChannelData> {
    let dir = channel_dir(app, tool, id)?;
    let meta: ChannelMeta = read_json(&dir.join("meta.json"))
        .map_err(|_| AppError::NotFound(format!("渠道不存在: {id}")))?;
    let snapshot: Value = read_json(&dir.join(tool.snapshot_file()))?;
    Ok(ChannelData {
        id: meta.id,
        name: meta.name,
        app_type: meta.app_type,
        snapshot,
        updated_at: meta.updated_at,
    })
}

/// 新增/更新渠道（写 meta.json + 快照文件）。
pub fn save_channel(
    app: &AppHandle,
    tool: Tool,
    req: SaveChannelRequest,
) -> AppResult<ChannelMeta> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidArgument("渠道名称不能为空".into()));
    }
    let id = req
        .id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let dir = channel_dir(app, tool, &id)?;
    fs::create_dir_all(&dir)?;
    let meta = ChannelMeta {
        id: id.clone(),
        name: name.to_string(),
        app_type: tool.as_str().to_string(),
        updated_at: now_rfc3339(),
    };
    write_json(&dir.join("meta.json"), &meta)?;
    write_json(&dir.join(tool.snapshot_file()), &req.snapshot)?;
    Ok(meta)
}

/// 删除渠道目录。
pub fn delete_channel(app: &AppHandle, tool: Tool, id: &str) -> AppResult<()> {
    let dir = channel_dir(app, tool, id)?;
    if dir.exists() {
        fs::remove_dir_all(&dir)?;
    }
    Ok(())
}

/// 抽取源配置（live）→ 写 `*.record.json` → 返回快照。
pub fn extract_record(app: &AppHandle, tool: Tool) -> AppResult<ExtractResult> {
    let (exists, snapshot) = match tool {
        Tool::Claude => {
            let p = paths::claude_settings_path()
                .ok_or_else(|| AppError::Config("无法定位 ~/.claude".into()))?;
            if p.exists() {
                let text = fs::read_to_string(&p)?;
                let v: Value = serde_json::from_str(&text).map_err(|e| {
                    AppError::InvalidArgument(format!("~/.claude/settings.json 解析失败: {e}"))
                })?;
                (true, v)
            } else {
                (false, json!({ "env": {} }))
            }
        }
        Tool::Codex => {
            let ap = paths::codex_auth_path()
                .ok_or_else(|| AppError::Config("无法定位 ~/.codex".into()))?;
            let cp = paths::codex_config_path()
                .ok_or_else(|| AppError::Config("无法定位 ~/.codex".into()))?;
            let auth: Value = if ap.exists() {
                serde_json::from_str(&fs::read_to_string(&ap)?).unwrap_or_else(|_| json!({}))
            } else {
                json!({})
            };
            let config_toml = if cp.exists() {
                fs::read_to_string(&cp)?
            } else {
                String::new()
            };
            let config = codex::toml_to_json(&config_toml);
            (
                ap.exists() || cp.exists(),
                json!({ "auth": auth, "configToml": config_toml, "config": config }),
            )
        }
    };
    let record = tool_root(app, tool)?.join(tool.record_file());
    write_json(&record, &snapshot)?;
    Ok(ExtractResult { exists, snapshot })
}

/// 应用：备份原文件 → 原子覆写真实配置。
/// - Claude：`snapshot` 为完整 settings.json，写 `~/.claude/settings.json`。
/// - Codex：`snapshot = { auth, configToml }`，写 `~/.codex/auth.json` + `config.toml`（双文件，失败回滚）。
pub fn apply_config(app: &AppHandle, tool: Tool, snapshot: Value) -> AppResult<()> {
    match tool {
        Tool::Claude => {
            let target = paths::claude_settings_path()
                .ok_or_else(|| AppError::Config("无法定位 ~/.claude".into()))?;
            backup_live(app, tool, &target, "settings", "json")?;
            let text = serde_json::to_string_pretty(&snapshot)?;
            atomic_write_str(&target, &text)?;
            Ok(())
        }
        Tool::Codex => {
            let auth = snapshot.get("auth").cloned().unwrap_or_else(|| json!({}));
            let config_toml = snapshot
                .get("configToml")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            // 写入前校验 TOML 合法性
            if !config_toml.trim().is_empty() {
                config_toml
                    .parse::<toml::Table>()
                    .map_err(|e| AppError::InvalidArgument(format!("config.toml 语法无效: {e}")))?;
            }
            let auth_target = paths::codex_auth_path()
                .ok_or_else(|| AppError::Config("无法定位 ~/.codex".into()))?;
            let config_target = paths::codex_config_path()
                .ok_or_else(|| AppError::Config("无法定位 ~/.codex".into()))?;
            backup_live(app, tool, &auth_target, "auth", "json")?;
            backup_live(app, tool, &config_target, "config", "toml")?;

            let old_auth = fs::read(&auth_target).ok();
            atomic_write_str(&auth_target, &serde_json::to_string_pretty(&auth)?)?;
            if let Err(e) = atomic_write_str(&config_target, &config_toml) {
                // 回滚 auth.json
                if let Some(bytes) = old_auth {
                    let _ = atomic_write(&auth_target, &bytes);
                }
                return Err(e);
            }
            Ok(())
        }
    }
}
