use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::config::{AppConfig, UpdateSettings, WebDavConfig};

/// 可跨设备同步的安全配置键白名单（剔除设备/路径特定项，见 P5-4）。
pub const SAFE_CONFIG_KEYS: &[&str] = &[
    "port",
    "logLevel",
    "language",
    "theme",
    "themeAuto",
    "autoLightStart",
    "autoDarkStart",
    "closeWindowBehavior",
    "silentStart",
    "autoRun",
    "modelsCacheTtl",
    "webdav_url",
    "webdav_username",
    "webdav_password",
    "webdav_configPath",
    "webdav_statsPath",
    "update_autoCheck",
    "update_checkInterval",
    "openaiUa",
    "claudeCliUa",
    "circuitBreakerEnabled",
    "circuitBreakerFailureThreshold",
    "circuitBreakerTimeout",
];

pub fn get_value(conn: &Connection, key: &str) -> AppResult<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM app_config WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?)
}

pub fn set_value(conn: &Connection, key: &str, value: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO app_config(key, value) VALUES(?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_all(conn: &Connection) -> AppResult<BTreeMap<String, String>> {
    let mut stmt = conn.prepare("SELECT key, value FROM app_config")?;
    let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
    let mut m = BTreeMap::new();
    for r in rows {
        let (k, v) = r?;
        m.insert(k, v);
    }
    Ok(m)
}

fn parse_bool(m: &BTreeMap<String, String>, key: &str, default: bool) -> bool {
    m.get(key)
        .map(|v| v == "true" || v == "1")
        .unwrap_or(default)
}
fn parse_str(m: &BTreeMap<String, String>, key: &str, default: &str) -> String {
    m.get(key)
        .filter(|v| !v.is_empty())
        .cloned()
        .unwrap_or_else(|| default.to_string())
}
fn parse_str_allow_empty(m: &BTreeMap<String, String>, key: &str, default: &str) -> String {
    m.get(key).cloned().unwrap_or_else(|| default.to_string())
}
fn parse_i64(m: &BTreeMap<String, String>, key: &str, default: i64) -> i64 {
    m.get(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}

/// 组装强类型 `AppConfig`（缺省回落默认值）。
pub fn get_config(conn: &Connection) -> AppResult<AppConfig> {
    let m = get_all(conn)?;
    let d = AppConfig::default();
    Ok(AppConfig {
        port: parse_i64(&m, "port", d.port as i64) as u16,
        log_level: parse_str(&m, "logLevel", &d.log_level),
        language: parse_str(&m, "language", &d.language),
        theme: parse_str(&m, "theme", &d.theme),
        theme_auto: parse_bool(&m, "themeAuto", d.theme_auto),
        auto_light_start: parse_str(&m, "autoLightStart", &d.auto_light_start),
        auto_dark_start: parse_str(&m, "autoDarkStart", &d.auto_dark_start),
        close_window_behavior: parse_str(&m, "closeWindowBehavior", &d.close_window_behavior),
        silent_start: parse_bool(&m, "silentStart", d.silent_start),
        auto_run: parse_bool(&m, "autoRun", d.auto_run),
        models_cache_ttl: parse_i64(&m, "modelsCacheTtl", d.models_cache_ttl),
        proxy_url: parse_str(&m, "proxyUrl", &d.proxy_url),
        proxy_enabled: parse_bool(&m, "proxyEnabled", d.proxy_enabled),
        proxy_for_update: parse_bool(&m, "proxyForUpdate", d.proxy_for_update),
        openai_ua: parse_str_allow_empty(&m, "openaiUa", &d.openai_ua),
        claude_cli_ua: parse_str_allow_empty(&m, "claudeCliUa", &d.claude_cli_ua),
        circuit_breaker_enabled: parse_bool(&m, "circuitBreakerEnabled", d.circuit_breaker_enabled),
        circuit_breaker_failure_threshold: parse_i64(
            &m,
            "circuitBreakerFailureThreshold",
            d.circuit_breaker_failure_threshold as i64,
        ) as u32,
        circuit_breaker_timeout: parse_i64(
            &m,
            "circuitBreakerTimeout",
            d.circuit_breaker_timeout as i64,
        ) as u64,
        update: UpdateSettings {
            auto_check: parse_bool(&m, "update_autoCheck", true),
            check_interval: parse_i64(&m, "update_checkInterval", 24),
            skipped_version: parse_str(&m, "update_skippedVersion", ""),
            last_check_time: parse_str(&m, "update_lastCheckTime", ""),
        },
        webdav: WebDavConfig {
            url: parse_str(&m, "webdav_url", ""),
            username: parse_str(&m, "webdav_username", ""),
            password: parse_str(&m, "webdav_password", ""),
            config_path: parse_str(&m, "webdav_configPath", ""),
            stats_path: parse_str(&m, "webdav_statsPath", ""),
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::storage::migration::run_migrations;

    fn db() -> Connection {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        c
    }

    #[test]
    fn port_defaults_when_absent() {
        let c = db();
        // 未写入任何端口键时回落默认端口（与 AppConfig::default 一致）
        assert_eq!(get_config(&c).unwrap().port, AppConfig::default().port);
    }

    #[test]
    fn startup_flags_default_and_roundtrip() {
        let c = db();
        // 默认：静默关、自动运行开（与 AppConfig::default 一致）
        let cfg = get_config(&c).unwrap();
        assert!(!cfg.silent_start);
        assert!(cfg.auto_run);
        // 写入后正确回读（沿用 parse_bool 的 "true"/"false"）
        set_value(&c, "silentStart", "true").unwrap();
        set_value(&c, "autoRun", "false").unwrap();
        let cfg = get_config(&c).unwrap();
        assert!(cfg.silent_start);
        assert!(!cfg.auto_run);
    }

    #[test]
    fn port_reads_port_key_not_proxy_port() {
        let c = db();
        // 历史 bug：曾误读 proxy_port；写入它不应影响端口解析
        set_value(&c, "proxy_port", "9999").unwrap();
        assert_eq!(get_config(&c).unwrap().port, AppConfig::default().port);
        // 真相源是 port 键
        set_value(&c, "port", "3002").unwrap();
        assert_eq!(get_config(&c).unwrap().port, 3002);
    }

    #[test]
    fn openai_ua_defaults_to_codex_but_allows_empty_override() {
        let c = db();
        let cfg = get_config(&c).unwrap();
        assert!(cfg.openai_ua.starts_with("codex_cli_rs/"));

        set_value(&c, "openaiUa", "").unwrap();
        assert_eq!(get_config(&c).unwrap().openai_ua, "");

        set_value(&c, "openaiUa", "custom-agent").unwrap();
        assert_eq!(get_config(&c).unwrap().openai_ua, "custom-agent");
    }
}
