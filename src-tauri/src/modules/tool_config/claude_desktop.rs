//! Claude Desktop 真实配置文件接管（非 app_data 快照模式）。
//!
//! 读写对象：
//! - `<3p-root>/configLibrary/_meta.json`
//! - `<3p-root>/configLibrary/<profile-id>.json`
//! - `<3p-root>/claude_desktop_config.json`
//! - `<3p-root>/developer_settings.json`
//! - 普通 Claude 根下的 `claude_desktop_config.json`（可选切 `deploymentMode`）

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::{json, Map, Value};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::models::claude_desktop_config::{
    ApplyClaudeDesktop3pRequest, ApplyClaudeDesktop3pResult, ClaudeDesktopPathCandidateDto,
    ClaudeDesktopPathsDto, ClaudeDesktopProfileDataDto, ClaudeDesktopProfileMetaDto,
    SaveClaudeDesktopProfileRequest,
};
use crate::utils::atomic_write::{atomic_write, atomic_write_str};
use crate::utils::paths;

const META_FILE: &str = "_meta.json";
const THREEP_CONFIG_FILE: &str = "claude_desktop_config.json";
const DEVELOPER_SETTINGS_FILE: &str = "developer_settings.json";
const CONFIG_LIBRARY_DIR: &str = "configLibrary";

// ─── 路径解析 ───────────────────────────────────────────────

#[derive(Debug, Clone)]
struct Candidate {
    path: PathBuf,
    source: String,
}

#[derive(Debug, Clone)]
struct ScoredCandidate {
    path: PathBuf,
    source: String,
    score: i32,
    exists: bool,
    markers: Vec<String>,
}

/// 解析 Claude Desktop 3P 配置目录（不创建目录）。
pub fn resolve_paths() -> AppResult<ClaudeDesktopPathsDto> {
    let platform = std::env::consts::OS.to_string();

    if let Some(override_dir) = std::env::var_os("CLAUDE_USER_DATA_DIR") {
        if !override_dir.is_empty() {
            let root = PathBuf::from(override_dir);
            let scored = score_candidates(vec![Candidate {
                path: root,
                source: "env".into(),
            }]);
            return Ok(build_paths_dto(platform, scored, None, false, None));
        }
    }

    match std::env::consts::OS {
        "windows" => resolve_windows_paths(platform),
        "macos" => resolve_macos_paths(platform),
        "linux" => resolve_linux_paths(platform),
        other => Ok(unsupported_paths(other)),
    }
}

fn unsupported_paths(platform: &str) -> ClaudeDesktopPathsDto {
    ClaudeDesktopPathsDto {
        supported: false,
        platform: platform.to_string(),
        threep_root_logical: None,
        threep_root_resolved: None,
        config_library_path: None,
        meta_path: None,
        threep_config_path: None,
        developer_settings_path: None,
        normal_config_path: None,
        resolution_source: "unsupported".into(),
        package_family_name: None,
        is_msix_virtualized: false,
        candidates: vec![],
        warning: Some(format!("当前平台 {platform} 暂不支持 Claude Desktop 配置接管")),
    }
}

fn resolve_macos_paths(platform: String) -> AppResult<ClaudeDesktopPathsDto> {
    let home = paths::home_dir().ok_or_else(|| AppError::Config("无法解析用户主目录".into()))?;
    let logical = home
        .join("Library")
        .join("Application Support")
        .join("Claude-3p");
    let normal = home
        .join("Library")
        .join("Application Support")
        .join("Claude")
        .join(THREEP_CONFIG_FILE);
    let scored = score_candidates(vec![Candidate {
        path: logical.clone(),
        source: "macos-app-support".into(),
    }]);
    let mut dto = build_paths_dto(platform, scored, None, false, Some(normal));
    dto.threep_root_logical = Some(logical.to_string_lossy().into_owned());
    Ok(dto)
}

fn resolve_linux_paths(platform: String) -> AppResult<ClaudeDesktopPathsDto> {
    let home = paths::home_dir().ok_or_else(|| AppError::Config("无法解析用户主目录".into()))?;
    let xdg = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| home.join(".config"));
    let logical = xdg.join("Claude-3p");
    let normal = xdg.join("Claude").join(THREEP_CONFIG_FILE);
    let scored = score_candidates(vec![Candidate {
        path: logical.clone(),
        source: "xdg-config".into(),
    }]);
    let mut dto = build_paths_dto(platform, scored, None, false, Some(normal));
    dto.threep_root_logical = Some(logical.to_string_lossy().into_owned());
    Ok(dto)
}

fn resolve_windows_paths(platform: String) -> AppResult<ClaudeDesktopPathsDto> {
    let local = env_path("LOCALAPPDATA")?;
    let roaming = env_path("APPDATA").ok();
    let mut candidates: Vec<Candidate> = Vec::new();
    let mut pfn: Option<String> = None;
    let mut normal_config: Option<PathBuf> = None;

    match get_appx_package_family_name() {
        Ok(name) => {
            pfn = Some(name.clone());
            candidates.push(Candidate {
                path: local
                    .join("Packages")
                    .join(&name)
                    .join("LocalCache")
                    .join("Local")
                    .join("Claude-3p"),
                source: "get-appxpackage-msix-local".into(),
            });
            normal_config = Some(
                local
                    .join("Packages")
                    .join(&name)
                    .join("LocalCache")
                    .join("Roaming")
                    .join("Claude")
                    .join(THREEP_CONFIG_FILE),
            );
        }
        Err(_) => {
            // Get-AppxPackage 失败时继续候选探测。
        }
    }

    for path in probe_windows_msix_candidates(&local) {
        if candidates.iter().any(|c| c.path == path) {
            continue;
        }
        candidates.push(Candidate {
            path,
            source: "probe-msix-local".into(),
        });
    }

    candidates.push(Candidate {
        path: local.join("Claude-3p"),
        source: "logical-localappdata".into(),
    });

    if normal_config.is_none() {
        if let Some(roaming) = roaming {
            normal_config = Some(roaming.join("Claude").join(THREEP_CONFIG_FILE));
        }
    }

    let scored = score_candidates(candidates);
    let is_msix = scored
        .first()
        .map(|c| {
            c.source.contains("msix")
                || c.path
                    .to_string_lossy()
                    .contains(r"\Packages\Claude_")
        })
        .unwrap_or(false);

    let mut dto = build_paths_dto(
        platform,
        scored,
        pfn,
        is_msix,
        normal_config,
    );
    dto.threep_root_logical = Some(local.join("Claude-3p").to_string_lossy().into_owned());
    if dto.threep_root_resolved.is_none() {
        dto.warning = Some(
            "未找到有效的 Claude Desktop 3P 目录；请确认已安装 Claude Desktop 或设置 CLAUDE_USER_DATA_DIR"
                .into(),
        );
    }
    Ok(dto)
}

fn env_path(key: &str) -> AppResult<PathBuf> {
    std::env::var_os(key)
        .map(PathBuf::from)
        .filter(|p| !p.as_os_str().is_empty())
        .ok_or_else(|| AppError::Config(format!("环境变量 {key} 未设置")))
}

/// 方法 1：`Get-AppxPackage -Name Claude` 取 PackageFamilyName。
fn get_appx_package_family_name() -> AppResult<String> {
    #[cfg(not(windows))]
    {
        Err(AppError::Config("Get-AppxPackage 仅 Windows 可用".into()))
    }
    #[cfg(windows)]
    {
        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                "$pkg = Get-AppxPackage -Name Claude | Select-Object -First 1; if ($pkg) { $pkg.PackageFamilyName }",
            ])
            .output()
            .map_err(|e| AppError::Config(format!("执行 Get-AppxPackage 失败: {e}")))?;
        if !output.status.success() {
            return Err(AppError::Config("Get-AppxPackage 命令失败".into()));
        }
        parse_single_non_empty_line(&output.stdout)
    }
}

fn parse_single_non_empty_line(stdout: &[u8]) -> AppResult<String> {
    let text = String::from_utf8_lossy(stdout);
    let line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty())
        .ok_or_else(|| AppError::Config("Get-AppxPackage 未返回 PackageFamilyName".into()))?;
    Ok(line.to_string())
}

/// 方法 2：枚举 `LocalAppData\Packages\Claude_*\LocalCache\Local\Claude-3p`。
fn probe_windows_msix_candidates(local_app_data: &Path) -> Vec<PathBuf> {
    // ponytail: 只枚举 LocalAppData\Packages\Claude_* 一层；若未来 Anthropic 改包名，再增加手动目录覆盖。
    let packages = local_app_data.join("Packages");
    let Ok(entries) = fs::read_dir(packages) else {
        return vec![];
    };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let package_dir = entry.path();
        let Some(name) = package_dir.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.starts_with("Claude_") {
            continue;
        }
        out.push(
            package_dir
                .join("LocalCache")
                .join("Local")
                .join("Claude-3p"),
        );
    }
    out
}

fn score_candidates(candidates: Vec<Candidate>) -> Vec<ScoredCandidate> {
    let mut scored: Vec<ScoredCandidate> = candidates
        .into_iter()
        .map(|c| {
            let (score, markers) = score_candidate(&c.path);
            ScoredCandidate {
                path: c.path.clone(),
                source: c.source,
                score,
                exists: c.path.exists(),
                markers,
            }
        })
        .collect();
    scored.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then_with(|| a.path.to_string_lossy().cmp(&b.path.to_string_lossy()))
    });
    scored
}

fn score_candidate(path: &Path) -> (i32, Vec<String>) {
    let mut score = 0;
    let mut markers = Vec::new();

    if path.is_dir() {
        score += 1;
        markers.push("dir".into());
    }
    if path.join(CONFIG_LIBRARY_DIR).join(META_FILE).is_file() {
        score += 100;
        markers.push("configLibrary/_meta.json".into());
    }
    if has_any_json(&path.join(CONFIG_LIBRARY_DIR)) {
        score += 80;
        markers.push("configLibrary/*.json".into());
    }
    if path.join(THREEP_CONFIG_FILE).is_file() {
        score += 30;
        markers.push(THREEP_CONFIG_FILE.into());
    }
    if path.join(DEVELOPER_SETTINGS_FILE).is_file() {
        score += 20;
        markers.push(DEVELOPER_SETTINGS_FILE.into());
    }
    if path.join("logs").join("main.log").is_file() {
        score += 10;
        markers.push("logs/main.log".into());
    }

    (score, markers)
}

fn has_any_json(dir: &Path) -> bool {
    let Ok(entries) = fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|e| {
        e.path()
            .extension()
            .and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("json"))
    })
}

fn build_paths_dto(
    platform: String,
    scored: Vec<ScoredCandidate>,
    package_family_name: Option<String>,
    is_msix_virtualized: bool,
    normal_config_path: Option<PathBuf>,
) -> ClaudeDesktopPathsDto {
    let candidates: Vec<ClaudeDesktopPathCandidateDto> = scored
        .iter()
        .map(|c| ClaudeDesktopPathCandidateDto {
            path: c.path.to_string_lossy().into_owned(),
            source: c.source.clone(),
            score: c.score,
            exists: c.exists,
            markers: c.markers.clone(),
        })
        .collect();

    // 有标记分的优先；否则取第一个存在的目录；再否则取最高分候选（可能尚未创建）。
    let best = scored
        .iter()
        .find(|c| c.score >= 100)
        .or_else(|| scored.iter().find(|c| c.score > 1))
        .or_else(|| scored.iter().find(|c| c.exists))
        .or_else(|| scored.first());

    let (resolved, source, supported) = match best {
        Some(c) => (
            Some(c.path.clone()),
            c.source.clone(),
            true,
        ),
        None => (None, "none".into(), false),
    };

    let (
        config_library_path,
        meta_path,
        threep_config_path,
        developer_settings_path,
    ) = match &resolved {
        Some(root) => (
            Some(root.join(CONFIG_LIBRARY_DIR).to_string_lossy().into_owned()),
            Some(
                root.join(CONFIG_LIBRARY_DIR)
                    .join(META_FILE)
                    .to_string_lossy()
                    .into_owned(),
            ),
            Some(root.join(THREEP_CONFIG_FILE).to_string_lossy().into_owned()),
            Some(
                root.join(DEVELOPER_SETTINGS_FILE)
                    .to_string_lossy()
                    .into_owned(),
            ),
        ),
        None => (None, None, None, None),
    };

    ClaudeDesktopPathsDto {
        supported,
        platform,
        threep_root_logical: None,
        threep_root_resolved: resolved.map(|p| p.to_string_lossy().into_owned()),
        config_library_path,
        meta_path,
        threep_config_path,
        developer_settings_path,
        normal_config_path: normal_config_path.map(|p| p.to_string_lossy().into_owned()),
        resolution_source: source,
        package_family_name,
        is_msix_virtualized,
        candidates,
        warning: None,
    }
}

// ─── Profile / meta 接管 ────────────────────────────────────

fn require_resolved_paths() -> AppResult<(ClaudeDesktopPathsDto, PathBuf)> {
    let paths_dto = resolve_paths()?;
    let root = paths_dto
        .threep_root_resolved
        .clone()
        .ok_or_else(|| {
            AppError::Config(
                paths_dto
                    .warning
                    .clone()
                    .unwrap_or_else(|| "未解析到 Claude Desktop 3P 目录".into()),
            )
        })?;
    Ok((paths_dto, PathBuf::from(root)))
}

fn validate_profile_id(id: &str) -> AppResult<()> {
    if id.is_empty() || id.contains(['/', '\\', '.']) {
        return Err(AppError::InvalidArgument(format!("非法 profile id: {id}")));
    }
    Ok(())
}

fn read_json_value(path: &Path) -> AppResult<Value> {
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text)
        .map_err(|e| AppError::InvalidArgument(format!("解析失败 {}: {e}", path.display())))
}

fn read_json_or_default(path: &Path, default: Value) -> AppResult<Value> {
    if !path.exists() {
        return Ok(default);
    }
    read_json_value(path)
}

fn write_pretty_json(path: &Path, value: &Value) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value)?;
    atomic_write_str(path, &text)
}

fn ensure_object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

fn empty_meta() -> Value {
    json!({ "appliedId": "", "entries": [] })
}

/// 备份到 `<app_data>/profiles/claude_desktop/backups/`。
fn backup_file_if_exists(
    app: &AppHandle,
    src: &Path,
    prefix: &str,
) -> AppResult<Option<PathBuf>> {
    if !src.is_file() {
        return Ok(None);
    }
    let backups = paths::profiles_dir(app)?.join("claude_desktop").join("backups");
    fs::create_dir_all(&backups)?;
    let ts = chrono::Local::now().format("%Y%m%d-%H%M%S%.3f");
    let ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("json");
    let dest = backups.join(format!("{prefix}-{ts}.{ext}"));
    let data = fs::read(src)?;
    atomic_write(&dest, &data)?;
    Ok(Some(dest))
}

fn file_updated_at(path: &Path) -> Option<String> {
    let meta = fs::metadata(path).ok()?;
    let modified = meta.modified().ok()?;
    let dt: chrono::DateTime<chrono::Local> = modified.into();
    Some(dt.to_rfc3339())
}

fn upsert_profile_in_meta(
    meta_json: Value,
    id: &str,
    name: &str,
    make_active: bool,
) -> AppResult<Value> {
    let mut root = ensure_object(meta_json);

    // 未知字段保留；只维护 appliedId + entries[{id,name}]。
    if !root.contains_key("appliedId") {
        root.insert("appliedId".into(), Value::String(String::new()));
    }
    let entries = root
        .entry("entries".to_string())
        .or_insert_with(|| Value::Array(vec![]));
    let arr = entries.as_array_mut().ok_or_else(|| {
        AppError::InvalidArgument("_meta.json 的 entries 必须是数组，请手动确认 schema".into())
    })?;

    arr.retain(|item| {
        item.get("id")
            .and_then(Value::as_str)
            .map(|existing| existing != id)
            .unwrap_or(true)
    });
    arr.push(json!({ "id": id, "name": name }));

    if make_active {
        root.insert("appliedId".into(), Value::String(id.to_string()));
    }

    Ok(Value::Object(root))
}

fn unregister_profile_from_meta(meta_json: Value, id: &str) -> AppResult<Value> {
    let mut root = ensure_object(meta_json);
    if let Some(entries) = root.get_mut("entries") {
        let arr = entries.as_array_mut().ok_or_else(|| {
            AppError::InvalidArgument("_meta.json 的 entries 必须是数组，请手动确认 schema".into())
        })?;
        arr.retain(|item| {
            item.get("id")
                .and_then(Value::as_str)
                .map(|existing| existing != id)
                .unwrap_or(true)
        });
    }
    if root
        .get("appliedId")
        .and_then(Value::as_str)
        .is_some_and(|applied| applied == id)
    {
        root.insert("appliedId".into(), Value::String(String::new()));
    }
    Ok(Value::Object(root))
}

fn profile_meta_from_disk(
    config_library: &Path,
    id: &str,
    registered_name: Option<&str>,
    applied_id: &str,
) -> ClaudeDesktopProfileMetaDto {
    let file_name = format!("{id}.json");
    let path = config_library.join(&file_name);
    let exists = path.is_file();
    let (valid_json, warning) = if exists {
        match read_json_value(&path) {
            Ok(v) if v.is_object() => (true, None),
            Ok(_) => (false, Some("profile 根节点不是 JSON 对象".into())),
            Err(e) => (false, Some(e.to_string())),
        }
    } else {
        (false, Some("profile 文件不存在".into()))
    };
    let registered = registered_name.is_some();
    let name = registered_name
        .map(str::to_string)
        .unwrap_or_else(|| id.to_string());

    ClaudeDesktopProfileMetaDto {
        id: id.to_string(),
        name,
        file_name,
        path: path.to_string_lossy().into_owned(),
        registered,
        active: !applied_id.is_empty() && applied_id == id,
        exists,
        valid_json,
        updated_at: file_updated_at(&path),
        warning,
    }
}

/// 列出 `_meta.json` 注册项 + 孤儿 profile 文件。
pub fn list_profiles() -> AppResult<Vec<ClaudeDesktopProfileMetaDto>> {
    let (_paths, root) = require_resolved_paths()?;
    let config_library = root.join(CONFIG_LIBRARY_DIR);
    let meta_path = config_library.join(META_FILE);
    let meta = read_json_or_default(&meta_path, empty_meta())?;
    let applied_id = meta
        .get("appliedId")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut registered: Vec<(String, String)> = Vec::new();
    if let Some(entries) = meta.get("entries").and_then(Value::as_array) {
        for item in entries {
            let Some(id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            let name = item
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_string();
            registered.push((id.to_string(), name));
        }
    }

    let mut out: Vec<ClaudeDesktopProfileMetaDto> = registered
        .iter()
        .map(|(id, name)| {
            profile_meta_from_disk(&config_library, id, Some(name.as_str()), &applied_id)
        })
        .collect();

    let registered_ids: std::collections::HashSet<&str> =
        registered.iter().map(|(id, _)| id.as_str()).collect();

    if let Ok(entries) = fs::read_dir(&config_library) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
                continue;
            };
            if !name.ends_with(".json") || name == META_FILE {
                continue;
            }
            let id = name.trim_end_matches(".json");
            if registered_ids.contains(id) {
                continue;
            }
            // 孤儿文件：存在但未在 _meta.json 注册。
            out.push(profile_meta_from_disk(
                &config_library,
                id,
                None,
                &applied_id,
            ));
        }
    }

    out.sort_by(|a, b| {
        b.active
            .cmp(&a.active)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(out)
}

pub fn get_profile(id: &str) -> AppResult<ClaudeDesktopProfileDataDto> {
    validate_profile_id(id)?;
    let (paths_dto, root) = require_resolved_paths()?;
    let config_library = root.join(CONFIG_LIBRARY_DIR);
    let meta_path = config_library.join(META_FILE);
    let meta_json = read_json_or_default(&meta_path, empty_meta())?;
    let applied_id = meta_json
        .get("appliedId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let registered_name = meta_json
        .get("entries")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries.iter().find_map(|item| {
                let item_id = item.get("id").and_then(Value::as_str)?;
                if item_id == id {
                    item.get("name").and_then(Value::as_str)
                } else {
                    None
                }
            })
        });

    let meta = profile_meta_from_disk(&config_library, id, registered_name, applied_id);
    if !meta.exists && !meta.registered {
        return Err(AppError::NotFound(format!("profile 不存在: {id}")));
    }

    let profile_path = config_library.join(format!("{id}.json"));
    let profile_json = if profile_path.is_file() {
        read_json_value(&profile_path)?
    } else {
        json!({})
    };

    let developer_settings_json =
        read_json_or_default(&root.join(DEVELOPER_SETTINGS_FILE), json!({}))?;
    let desktop_config_json = read_json_or_default(&root.join(THREEP_CONFIG_FILE), json!({}))?;

    Ok(ClaudeDesktopProfileDataDto {
        meta,
        profile_json,
        meta_json,
        developer_settings_json,
        desktop_config_json,
        paths: paths_dto,
    })
}

/// 直接写真实 profile 文件，并按需更新 `_meta.json`。
pub fn save_profile(
    app: &AppHandle,
    req: SaveClaudeDesktopProfileRequest,
) -> AppResult<ClaudeDesktopProfileMetaDto> {
    let name = req.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidArgument("配置名称不能为空".into()));
    }
    if !req.profile_json.is_object() {
        return Err(AppError::InvalidArgument("profile JSON 必须是对象".into()));
    }

    let (_paths_dto, root) = require_resolved_paths()?;
    let config_library = root.join(CONFIG_LIBRARY_DIR);
    fs::create_dir_all(&config_library)?;

    let profile_id = req
        .id
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    validate_profile_id(&profile_id)?;

    let profile_path = config_library.join(format!("{profile_id}.json"));
    let meta_path = config_library.join(META_FILE);

    let old_meta = read_json_or_default(&meta_path, empty_meta())?;
    let new_meta = if req.register_in_meta {
        upsert_profile_in_meta(old_meta, &profile_id, name, req.make_active)?
    } else {
        old_meta
    };

    backup_file_if_exists(app, &profile_path, "claude-desktop-profile")?;
    if req.register_in_meta || req.meta_json.is_some() {
        backup_file_if_exists(app, &meta_path, "claude-desktop-meta")?;
    }

    write_pretty_json(&profile_path, &req.profile_json)?;

    // 右栏可直接覆写 sidecar；显式 meta_json 优先于 register upsert 结果。
    let final_meta = if let Some(meta_override) = req.meta_json {
        if !meta_override.is_object() {
            return Err(AppError::InvalidArgument("_meta.json 必须是对象".into()));
        }
        write_pretty_json(&meta_path, &meta_override)?;
        meta_override
    } else if req.register_in_meta {
        // profile 已写成功后再写 meta；meta 失败时留下孤儿文件，list 会标出以便补注册。
        write_pretty_json(&meta_path, &new_meta)?;
        new_meta
    } else {
        new_meta
    };

    if let Some(dev) = req.developer_settings_json {
        if !dev.is_object() {
            return Err(AppError::InvalidArgument(
                "developer_settings.json 必须是对象".into(),
            ));
        }
        let path = root.join(DEVELOPER_SETTINGS_FILE);
        backup_file_if_exists(app, &path, "claude-desktop-developer-settings")?;
        write_pretty_json(&path, &dev)?;
    }
    if let Some(desktop) = req.desktop_config_json {
        if !desktop.is_object() {
            return Err(AppError::InvalidArgument(
                "claude_desktop_config.json 必须是对象".into(),
            ));
        }
        let path = root.join(THREEP_CONFIG_FILE);
        backup_file_if_exists(app, &path, "claude-desktop-threep-config")?;
        write_pretty_json(&path, &desktop)?;
    }

    let applied_id = final_meta
        .get("appliedId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let registered_name = final_meta
        .get("entries")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries.iter().find_map(|item| {
                let id = item.get("id").and_then(Value::as_str)?;
                if id == profile_id {
                    item.get("name").and_then(Value::as_str)
                } else {
                    None
                }
            })
        })
        .or(if req.register_in_meta { Some(name) } else { None });
    Ok(profile_meta_from_disk(
        &config_library,
        &profile_id,
        registered_name,
        applied_id,
    ))
}

/// 仅从 `_meta.json` 解除注册，不删真实文件。
pub fn unregister_profile(app: &AppHandle, id: &str) -> AppResult<()> {
    validate_profile_id(id)?;
    let (_paths, root) = require_resolved_paths()?;
    let meta_path = root.join(CONFIG_LIBRARY_DIR).join(META_FILE);
    let old_meta = read_json_or_default(&meta_path, empty_meta())?;
    let new_meta = unregister_profile_from_meta(old_meta, id)?;
    backup_file_if_exists(app, &meta_path, "claude-desktop-meta")?;
    write_pretty_json(&meta_path, &new_meta)?;
    Ok(())
}

/// 仅删除 `<profile-id>.json`，不改 `_meta.json`。
pub fn delete_profile_file(app: &AppHandle, id: &str) -> AppResult<()> {
    validate_profile_id(id)?;
    let (_paths, root) = require_resolved_paths()?;
    let profile_path = root
        .join(CONFIG_LIBRARY_DIR)
        .join(format!("{id}.json"));
    if !profile_path.exists() {
        return Ok(());
    }
    backup_file_if_exists(app, &profile_path, "claude-desktop-profile")?;
    fs::remove_file(&profile_path)?;
    Ok(())
}

/// 默认删除：解除 `_meta.json` 注册，并删除真实 `<profile-id>.json`。
pub fn delete_profile(app: &AppHandle, id: &str) -> AppResult<()> {
    unregister_profile(app, id)?;
    delete_profile_file(app, id)?;
    Ok(())
}

// ─── 3P 模式应用 ────────────────────────────────────────────

fn set_deployment_mode_3p(config: Value) -> Value {
    let mut obj = ensure_object(config);
    obj.insert("deploymentMode".into(), Value::String("3p".into()));
    Value::Object(obj)
}

pub fn apply_3p_mode(
    app: &AppHandle,
    req: ApplyClaudeDesktop3pRequest,
) -> AppResult<ApplyClaudeDesktop3pResult> {
    validate_profile_id(&req.active_profile_id)?;
    let (paths_dto, root) = require_resolved_paths()?;

    let config_library = root.join(CONFIG_LIBRARY_DIR);
    let profile_path = config_library.join(format!("{}.json", req.active_profile_id));
    if !profile_path.is_file() {
        return Err(AppError::NotFound(format!(
            "active profile 文件不存在: {}",
            req.active_profile_id
        )));
    }

    let mut written_files = Vec::new();
    let mut backup_files = Vec::new();
    let mut warnings = Vec::new();

    // 1) 把 active profile 写入 _meta.json.appliedId（并确保注册）。
    let meta_path = config_library.join(META_FILE);
    let meta = read_json_or_default(&meta_path, empty_meta())?;
    let profile_name = meta
        .get("entries")
        .and_then(Value::as_array)
        .and_then(|entries| {
            entries.iter().find_map(|item| {
                let id = item.get("id").and_then(Value::as_str)?;
                if id == req.active_profile_id {
                    item.get("name").and_then(Value::as_str).map(str::to_string)
                } else {
                    None
                }
            })
        })
        .unwrap_or_else(|| req.active_profile_id.clone());
    let new_meta = upsert_profile_in_meta(meta, &req.active_profile_id, &profile_name, true)?;
    if let Some(dest) = backup_file_if_exists(app, &meta_path, "claude-desktop-meta")? {
        backup_files.push(dest.to_string_lossy().into_owned());
    }
    write_pretty_json(&meta_path, &new_meta)?;
    written_files.push(meta_path.to_string_lossy().into_owned());

    // 2) 3P 根 claude_desktop_config.json
    if req.write_threep_config {
        let path = root.join(THREEP_CONFIG_FILE);
        let old = read_json_or_default(&path, json!({}))?;
        if let Some(dest) = backup_file_if_exists(app, &path, "claude-desktop-threep-config")? {
            backup_files.push(dest.to_string_lossy().into_owned());
        }
        write_pretty_json(&path, &set_deployment_mode_3p(old))?;
        written_files.push(path.to_string_lossy().into_owned());
    }

    // 3) 普通 Claude 根 config（1P 侧切 3P）
    if req.write_normal_config {
        if let Some(normal) = paths_dto.normal_config_path.as_ref() {
            let path = PathBuf::from(normal);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let old = read_json_or_default(&path, json!({}))?;
            if let Some(dest) = backup_file_if_exists(app, &path, "claude-desktop-normal-config")? {
                backup_files.push(dest.to_string_lossy().into_owned());
            }
            write_pretty_json(&path, &set_deployment_mode_3p(old))?;
            written_files.push(path.to_string_lossy().into_owned());
        } else {
            warnings.push("未解析到普通 Claude 配置路径，已跳过 1P 侧写入".into());
        }
    }

    // 4) developer_settings.json：真实 schema 无 deploymentMode，只确保对象文件存在。
    if req.write_developer_settings {
        let path = root.join(DEVELOPER_SETTINGS_FILE);
        let old = read_json_or_default(&path, json!({}))?;
        if !old.is_object() {
            return Err(AppError::InvalidArgument(
                "developer_settings.json 根节点不是对象".into(),
            ));
        }
        if let Some(dest) = backup_file_if_exists(app, &path, "claude-desktop-developer-settings")?
        {
            backup_files.push(dest.to_string_lossy().into_owned());
        }
        // 保留全部未知字段；不盲写 deploymentMode。
        write_pretty_json(&path, &old)?;
        written_files.push(path.to_string_lossy().into_owned());
        warnings.push(
            "developer_settings.json 已确认存在；3P 开关以 claude_desktop_config.json 的 deploymentMode 为准"
                .into(),
        );
    }

    Ok(ApplyClaudeDesktop3pResult {
        written_files,
        backup_files,
        warnings,
        restart_required: true,
    })
}

// ─── Tests ──────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn tmp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("ccmesh_cd_{label}_{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn score_candidate_prefers_meta_over_empty_logical() {
        let root = tmp_dir("score");
        let msix = root.join("msix").join("Claude-3p");
        let logical = root.join("logical").join("Claude-3p");
        fs::create_dir_all(msix.join(CONFIG_LIBRARY_DIR)).unwrap();
        fs::write(
            msix.join(CONFIG_LIBRARY_DIR).join(META_FILE),
            r#"{"appliedId":"","entries":[]}"#,
        )
        .unwrap();
        fs::create_dir_all(&logical).unwrap();

        let (msix_score, msix_markers) = score_candidate(&msix);
        let (logical_score, _) = score_candidate(&logical);
        assert!(msix_score > logical_score);
        assert!(msix_markers.iter().any(|m| m.contains("_meta.json")));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn upsert_profile_in_meta_keeps_unknown_fields_and_dedupes() {
        let meta = json!({
            "appliedId": "old",
            "entries": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
            "isManaged": false,
            "extra": {"x": 1}
        });
        let next = upsert_profile_in_meta(meta, "a", "A2", true).unwrap();
        assert_eq!(next["appliedId"], "a");
        assert_eq!(next["isManaged"], false);
        assert_eq!(next["extra"]["x"], 1);
        let entries = next["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 2);
        let a = entries.iter().find(|e| e["id"] == "a").unwrap();
        assert_eq!(a["name"], "A2");
    }

    #[test]
    fn unregister_profile_from_meta_clears_applied_id() {
        let meta = json!({
            "appliedId": "a",
            "entries": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
            "keep": true
        });
        let next = unregister_profile_from_meta(meta, "a").unwrap();
        assert_eq!(next["appliedId"], "");
        assert_eq!(next["keep"], true);
        let entries = next["entries"].as_array().unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["id"], "b");
    }

    #[test]
    fn parse_single_non_empty_line_trims() {
        let out = parse_single_non_empty_line(b"\r\n  Claude_pzs8sxrjxfjjc  \n").unwrap();
        assert_eq!(out, "Claude_pzs8sxrjxfjjc");
    }

    #[test]
    fn score_candidates_sorts_by_score_desc() {
        let root = tmp_dir("sort");
        let high = root.join("high");
        let low = root.join("low");
        fs::create_dir_all(high.join(CONFIG_LIBRARY_DIR)).unwrap();
        fs::write(
            high.join(CONFIG_LIBRARY_DIR).join(META_FILE),
            r#"{"appliedId":"","entries":[]}"#,
        )
        .unwrap();
        fs::create_dir_all(&low).unwrap();

        let scored = score_candidates(vec![
            Candidate {
                path: low,
                source: "logical".into(),
            },
            Candidate {
                path: high.clone(),
                source: "msix".into(),
            },
        ]);
        assert_eq!(scored[0].path, high);
        assert!(scored[0].score > scored[1].score);
        let _ = fs::remove_dir_all(&root);
    }
}
