use std::path::{Path, PathBuf};
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

/// Claude Code 用户级配置：`~/.claude.json`（Windows: `%USERPROFILE%\.claude.json`）。
///
/// 与 [`claude_settings_path`]（`~/.claude/settings.json`，渠道「应用」写入）不是同一个文件。
pub fn claude_user_json_path() -> Option<PathBuf> {
    home_dir().map(|h| h.join(".claude.json"))
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

/// pi/omp 共用的会话目录覆盖环境变量（`omp://environment-variables.md` §6）。
///
/// 仅改会话目录，不动 agent 其余布局；非空且为绝对路径时直接采用。
pub const PI_CODING_AGENT_SESSION_DIR_ENV: &str = "PI_CODING_AGENT_SESSION_DIR";

/// pi/omp 共用的 agent 目录覆盖环境变量。
///
/// pi：把该值当配置根，会话在 `<env>/agent/sessions`（`resolve_sessions_dir`）。
/// omp：该值就是完整 agent 目录，会话在 `<env>/sessions`（`resolve_omp_sessions_dirs`）。
pub const PI_CODING_AGENT_DIR_ENV: &str = "PI_CODING_AGENT_DIR";

/// 解析 pi/omp 的会话目录，尊重 env 覆盖（纯函数，便于并行单测）。
///
/// 优先级：`session_dir_env`（绝对路径）→ `<agent_dir_env>/agent/sessions`
/// → `<home>/<default_subdir>/agent/sessions`。对齐 ai-toolbox `runtime_location.rs`
/// 的 env→默认链；pi 与 omp 共用同一 env 键（omp 由 pi-mono fork）。
pub fn resolve_sessions_dir(
    session_dir_env: Option<&str>,
    agent_dir_env: Option<&str>,
    home: Option<&Path>,
    default_subdir: &str,
) -> Option<PathBuf> {
    if let Some(raw) = session_dir_env.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(raw);
        if p.is_absolute() {
            return Some(p);
        }
    }
    let agent_dir = if let Some(raw) = agent_dir_env.map(str::trim).filter(|s| !s.is_empty()) {
        let p = PathBuf::from(raw);
        if p.is_absolute() {
            Some(p.join("agent"))
        } else {
            None
        }
    } else {
        home.map(|h| h.join(default_subdir).join("agent"))
    };
    agent_dir.map(|d| d.join("sessions"))
}

/// 本机 pi 会话目录：`~/.pi/agent/sessions`，支持 env 覆盖。
pub fn pi_sessions_dir() -> Option<PathBuf> {
    resolve_sessions_dir(
        std::env::var(PI_CODING_AGENT_SESSION_DIR_ENV)
            .ok()
            .as_deref(),
        std::env::var(PI_CODING_AGENT_DIR_ENV).ok().as_deref(),
        home_dir().as_deref(),
        ".pi",
    )
}

/// 本机 omp 会话目录（会话浏览用，只取主目录）。
///
/// `PI_CODING_AGENT_SESSION_DIR` 为绝对路径时优先；否则取
/// [`resolve_omp_sessions_dirs`] 的第一项（默认 / agent 覆盖 / XDG）。
pub fn omp_sessions_dir() -> Option<PathBuf> {
    if let Some(raw) = std::env::var(PI_CODING_AGENT_SESSION_DIR_ENV)
        .ok()
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        let p = PathBuf::from(raw);
        if p.is_absolute() {
            return Some(p);
        }
    }
    omp_sessions_dirs().into_iter().next()
}

/// 用量扫描用的全部 omp 会话根：主目录 + 已存在的命名 profile。
pub fn omp_sessions_dirs() -> Vec<PathBuf> {
    resolve_omp_sessions_dirs(
        std::env::var(PI_CODING_AGENT_DIR_ENV).ok().as_deref(),
        std::env::var("XDG_DATA_HOME").ok().as_deref(),
        home_dir().as_deref(),
        cfg!(unix),
    )
}

/// 解析 omp 会话目录列表（纯函数，便于单测）。
///
/// 主目录优先级：绝对路径的 `agent_dir_env` → `<env>/sessions`（同时关闭 XDG）
/// → `xdg_enabled` 且 `$xdg_data_env/omp` 已存在 → `$xdg/omp/sessions`
/// → `<home>/.omp/agent/sessions`。
/// 之后追加 `<home>/.omp/profiles/*/agent/sessions`（目录存在才加入）。
/// 命名 profile 不受 `PI_CODING_AGENT_DIR` 影响，与 omp `dirs.ts` 一致。
pub fn resolve_omp_sessions_dirs(
    agent_dir_env: Option<&str>,
    xdg_data_env: Option<&str>,
    home: Option<&Path>,
    xdg_enabled: bool,
) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let agent_override = agent_dir_env
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .filter(|p| p.is_absolute());

    if let Some(agent) = agent_override {
        out.push(agent.join("sessions"));
    } else if let Some(xdg) = xdg_omp_sessions(xdg_data_env, xdg_enabled) {
        out.push(xdg);
    } else if let Some(home) = home {
        out.push(home.join(".omp").join("agent").join("sessions"));
    }

    if let Some(home) = home {
        let profiles = home.join(".omp").join("profiles");
        if let Ok(entries) = std::fs::read_dir(&profiles) {
            let mut extra: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path().join("agent").join("sessions"))
                .filter(|p| p.is_dir())
                .collect();
            extra.sort();
            out.extend(extra);
        }
    }
    out
}

fn xdg_omp_sessions(xdg_data_env: Option<&str>, xdg_enabled: bool) -> Option<PathBuf> {
    if !xdg_enabled {
        return None;
    }
    let raw = xdg_data_env.map(str::trim).filter(|s| !s.is_empty())?;
    let root = PathBuf::from(raw).join("omp");
    root.is_dir().then(|| root.join("sessions"))
}

/// 把工作目录 `cwd` 编码为 pi/omp 的会话 slug（`omp://session.md`「On-Disk Layout」）。
///
/// 三种情形：
/// - `cwd` 在 `home` 下 → `-<相对路径>`（分隔符替换为 `-`）；
/// - `cwd` 在 `tmp` 根下 → `-tmp-<相对路径>`；
/// - 其它（含 Windows 盘符绝对路径）→ `--<编码绝对路径>--`，把 `\`、`/`、`:` 全部
///   替换为 `-`；中文与空格原样保留（实测 `--D--下载-新建文件夹 (5)--`）。
///
/// `tmp` 入参仅为可测试性传入，运行时一般取 `std::env::temp_dir()`。
//
// ponytail: 当前 scan 直接从 session 头读 cwd，未调用本编码函数；保留它是为了
// 把 `omp://session.md` 的 slug 规则落成可被单测锁定的代码（ceil: 仅作 spec 镜像，
// 未参与运行时；升级路径——若以后要做 slug↔cwd 反查/校验再接进 scan）。
#[allow(dead_code)]
pub fn encode_cwd_to_slug(cwd: &Path, home: &Path, tmp: &Path) -> String {
    fn strip_prefix_rel<'a>(cwd: &'a Path, base: &Path) -> Option<String> {
        let rel = cwd.strip_prefix(base).ok()?;
        let rel = rel.to_string_lossy();
        if rel.is_empty() {
            return None;
        }
        Some(rel.replace(['\\', '/', ':'], "-"))
    }

    if let Some(rel) = strip_prefix_rel(cwd, home) {
        return format!("-{rel}");
    }
    if let Some(rel) = strip_prefix_rel(cwd, tmp) {
        return format!("-tmp-{rel}");
    }
    let encoded = cwd.to_string_lossy().replace(['\\', '/', ':'], "-");
    format!("--{encoded}--")
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_cwd_to_slug_windows_drive_absolute() {
        // 实测：E:\myCode\tauri-gateway → --E--myCode-tauri-gateway--
        let cwd = Path::new("E:\\myCode\\tauri-gateway");
        let home = Path::new("C:\\Users\\Administrator");
        let tmp = Path::new("C:\\Users\\Administrator\\AppData\\Local\\Temp");
        assert_eq!(
            encode_cwd_to_slug(cwd, home, tmp),
            "--E--myCode-tauri-gateway--"
        );
    }

    #[test]
    fn encode_cwd_to_slug_home_relative() {
        let home = Path::new("C:\\Users\\Administrator");
        let tmp = Path::new("C:\\Users\\Administrator\\AppData\\Local\\Temp");
        let cwd = home.join("projects").join("foo");
        assert_eq!(encode_cwd_to_slug(&cwd, home, tmp), "-projects-foo");
    }

    #[test]
    fn encode_cwd_to_slug_tmp_relative() {
        // tmp 必须独立于 home（不同盘符），否则 cwd 同时在 home 下会先命中 home 分支。
        // Unix 上 /tmp 与 /home 分离即此情形；Windows 用独立盘符模拟。
        let home = Path::new("C:\\Users\\Administrator");
        let tmp = Path::new("D:\\Temp");
        let cwd = tmp.join("build-artifacts");
        assert_eq!(encode_cwd_to_slug(&cwd, home, tmp), "-tmp-build-artifacts");
    }

    #[test]
    fn encode_cwd_to_slug_preserves_unicode_and_spaces() {
        // 实测：D:\下载\新建文件夹 (5) → --D--下载-新建文件夹 (5)--
        let cwd = Path::new("D:\\下载\\新建文件夹 (5)");
        let home = Path::new("C:\\Users\\Administrator");
        let tmp = Path::new("C:\\Users\\Administrator\\AppData\\Local\\Temp");
        assert_eq!(
            encode_cwd_to_slug(cwd, home, tmp),
            "--D--下载-新建文件夹 (5)--"
        );
    }

    #[test]
    fn encode_cwd_to_slug_unix_absolute_outside_home() {
        let cwd = Path::new("/opt/myapp");
        let home = Path::new("/home/alice");
        let tmp = Path::new("/tmp");
        assert_eq!(encode_cwd_to_slug(cwd, home, tmp), "---opt-myapp--");
    }

    #[test]
    fn resolve_sessions_dir_defaults_to_home_layout() {
        let home = Path::new("C:\\Users\\Administrator");
        let dir =
            resolve_sessions_dir(None, None, Some(home), ".pi").expect("default pi sessions dir");
        assert_eq!(dir, home.join(".pi").join("agent").join("sessions"));
    }

    #[test]
    fn resolve_sessions_dir_session_env_overrides_everything() {
        let home = Path::new("C:\\Users\\Administrator");
        let custom = Path::new("D:\\pi-sessions");
        let dir = resolve_sessions_dir(
            Some(custom.to_str().unwrap()),
            Some("C:\\ignored-agent"),
            Some(home),
            ".pi",
        )
        .expect("env override sessions dir");
        assert_eq!(dir, custom);
    }

    #[test]
    fn resolve_sessions_dir_agent_env_relocates_pi_agent_root() {
        let home = Path::new("C:\\Users\\Administrator");
        let dir = resolve_sessions_dir(None, Some("D:\\piroot"), Some(home), ".pi")
            .expect("agent env override");
        assert_eq!(dir, Path::new("D:\\piroot").join("agent").join("sessions"));
    }

    #[test]
    fn resolve_omp_sessions_dirs_agent_env_is_the_agent_dir() {
        let home = Path::new("C:\\Users\\Administrator");
        let dirs = resolve_omp_sessions_dirs(Some("D:\\piroot"), None, Some(home), true);
        assert_eq!(dirs, vec![PathBuf::from("D:\\piroot").join("sessions")]);
    }

    #[test]
    fn resolve_omp_sessions_dirs_xdg_when_omp_dir_exists() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let xdg = temp.path().join("xdg");
        std::fs::create_dir_all(xdg.join("omp")).unwrap();
        let dirs = resolve_omp_sessions_dirs(None, xdg.to_str(), Some(&home), true);
        assert_eq!(dirs, vec![xdg.join("omp").join("sessions")]);
    }

    #[test]
    fn resolve_omp_sessions_dirs_skips_xdg_when_disabled_or_missing() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        let xdg = temp.path().join("xdg");
        std::fs::create_dir_all(xdg.join("omp")).unwrap();
        let disabled = resolve_omp_sessions_dirs(None, xdg.to_str(), Some(&home), false);
        assert_eq!(
            disabled,
            vec![home.join(".omp").join("agent").join("sessions")]
        );
        let missing = resolve_omp_sessions_dirs(None, None, Some(&home), true);
        assert_eq!(
            missing,
            vec![home.join(".omp").join("agent").join("sessions")]
        );
    }

    #[test]
    fn resolve_omp_sessions_dirs_appends_existing_profiles() {
        let temp = tempfile::tempdir().unwrap();
        let home = temp.path().join("home");
        let work = home
            .join(".omp")
            .join("profiles")
            .join("work")
            .join("agent")
            .join("sessions");
        let empty = home
            .join(".omp")
            .join("profiles")
            .join("empty")
            .join("agent");
        std::fs::create_dir_all(&work).unwrap();
        std::fs::create_dir_all(&empty).unwrap();
        let dirs = resolve_omp_sessions_dirs(Some("D:\\omp-agent"), None, Some(&home), false);
        assert_eq!(
            dirs,
            vec![PathBuf::from("D:\\omp-agent").join("sessions"), work]
        );
    }

    #[test]
    fn resolve_sessions_dir_ignores_non_absolute_env() {
        let home = Path::new("C:\\Users\\Administrator");
        // 相对路径 env 应被忽略，回落默认
        let dir = resolve_sessions_dir(Some("relative/path"), None, Some(home), ".pi")
            .expect("fallback to default");
        assert_eq!(dir, home.join(".pi").join("agent").join("sessions"));
    }

    #[test]
    fn resolve_sessions_dir_returns_none_without_home() {
        assert!(resolve_sessions_dir(None, None, None, ".pi").is_none());
    }
}
