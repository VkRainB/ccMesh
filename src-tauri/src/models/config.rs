use serde::{Deserialize, Serialize};

use crate::utils::ua;

/// 自动更新设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateSettings {
    pub auto_check: bool,
    pub check_interval: i64, // 小时；0 表示停止自动检查
    pub skipped_version: String,
    pub last_check_time: String,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            auto_check: true,
            check_interval: 24,
            skipped_version: String::new(),
            last_check_time: String::new(),
        }
    }
}

/// WebDAV 同步设置。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebDavConfig {
    pub url: String,
    pub username: String,
    pub password: String,
    pub config_path: String,
    pub stats_path: String,
}

/// 应用配置（key-value 表 `app_config` 组装，缺省回落 [`AppConfig::default`]）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub port: u16,
    pub log_level: String, // trace/debug/info/warn/error
    pub language: String,  // zh/en
    pub theme: String,     // system/light/dark
    pub theme_auto: bool,
    pub auto_light_start: String,      // "HH:MM"
    pub auto_dark_start: String,       // "HH:MM"
    pub close_window_behavior: String, // quit/minimize/ask
    /// 静默启动：启动时不展示窗口、常驻托盘后台运行（默认关）。自启动随系统由 autostart 插件管理。
    pub silent_start: bool,
    /// 自动运行：应用打开时自动启动代理服务（默认开）。
    pub auto_run: bool,
    pub models_cache_ttl: i64, // 分钟
    /// 全局代理地址（空=直连）；端点 use_proxy 为真时经此代理出网。
    pub proxy_url: String,
    /// 全局「启用代理」总开关：开启时转发/获取模型经代理（端点未单独开 use_proxy 时按此）。
    pub proxy_enabled: bool,
    /// 「代理更新」专用开关：开启时应用更新检查/下载经同一代理地址出网。
    pub proxy_for_update: bool,
    /// 转发到 OpenAI 端点时覆盖 User-Agent（空=透传客户端）。
    pub openai_ua: String,
    /// 转发到 Claude 端点时覆盖 User-Agent（空=透传客户端）。
    pub claude_cli_ua: String,
    /// 是否启用端点熔断保护（默认开）。
    pub circuit_breaker_enabled: bool,
    /// 熔断器连续失败触发阈值（次，默认 4）。
    pub circuit_breaker_failure_threshold: u32,
    /// 熔断器冷却时长（秒，默认 60）。
    pub circuit_breaker_timeout: u64,
    pub update: UpdateSettings,
    pub webdav: WebDavConfig,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            port: 3000,
            log_level: "info".into(),
            language: "zh".into(),
            theme: "system".into(),
            theme_auto: false,
            auto_light_start: "07:00".into(),
            auto_dark_start: "19:00".into(),
            close_window_behavior: "ask".into(),
            silent_start: false,
            auto_run: true,
            models_cache_ttl: 30,
            proxy_url: String::new(),
            proxy_enabled: false,
            proxy_for_update: false,
            openai_ua: ua::codex_probe_ua(),
            claude_cli_ua: ua::CLAUDE_PROBE_UA.into(),
            circuit_breaker_enabled: true,
            circuit_breaker_failure_threshold: 4,
            circuit_breaker_timeout: 60,
            update: UpdateSettings::default(),
            webdav: WebDavConfig::default(),
        }
    }
}
