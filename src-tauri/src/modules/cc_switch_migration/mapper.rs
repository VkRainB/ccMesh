//! cc-switch 供应商行 → ccMesh 迁移映射项。
//!
//! `settings_config` / `meta` 是 TEXT 存 JSON 字符串，弱类型 `serde_json::Value` 接收后按
//! `app_type` 分支解析 url/key/transformer/models_hint，并应用跳过规则。
//! 字段映射 / 跳过规则见 plan-doc/cc-switch-field-mapping.md §4–6。

use serde_json::Value;

use crate::error::AppResult;
use crate::modules::cc_switch_migration::reader::ProviderRow;

/// 迁移映射项（内部结构，非命令 payload）。
#[derive(Debug, Clone)]
pub struct MappedProvider {
    pub cc_switch_id: String,
    pub app_type: String,
    pub name: String,
    /// 规整前的原始上游地址（导入阶段再 normalize）。
    pub raw_url: String,
    pub api_key: String,
    pub transformer: String,
    pub models_hint: Vec<String>,
    pub remark: String,
    /// "ok" | "skipped"。
    pub status: String,
    pub skip_reason: Option<String>,
}

/// cc-switch 复合主键 (id, app_type) → 前端勾选 / 导入用的唯一标识。
fn cc_switch_selection_id(row: &ProviderRow) -> String {
    format!("{}:{}", row.app_type, row.id)
}

/// 占位/无效密钥：cc-switch 的 OAuth/托管账号会写入这些占位值，迁移时跳过。
fn is_placeholder_key(key: &str) -> bool {
    let k = key.trim();
    k.is_empty() || k == "PROXY_MANAGED" || k.starts_with("${")
}

/// 取 JSON 对象里多个候选键的第一个非空字符串值（模拟 JS `||`）。
fn first_non_empty(obj: Option<&Value>, keys: &[&str]) -> String {
    let obj = match obj.and_then(|v| v.as_object()) {
        Some(o) => o,
        None => return String::new(),
    };
    for k in keys {
        if let Some(v) = obj.get(*k).and_then(|x| x.as_str()) {
            if !v.trim().is_empty() {
                return v.to_string();
            }
        }
    }
    String::new()
}

/// 从 codex 的 TOML `config` 字符串解析 active provider 的 base_url。
/// 优先 `[model_providers.<active model_provider>].base_url`，回退顶层 `base_url`。
fn codex_base_url_from_toml(config: &str) -> String {
    let doc: Value = match toml::from_str::<toml::Value>(config)
        .ok()
        .and_then(|v| serde_json::to_value(v).ok())
    {
        Some(v) => v,
        None => return String::new(),
    };

    if let Some(active) = doc.get("model_provider").and_then(|v| v.as_str()) {
        if let Some(base) = doc
            .get("model_providers")
            .and_then(|p| p.get(active))
            .and_then(|provider| provider.get("base_url"))
            .and_then(|v| v.as_str())
        {
            return base.to_string();
        }
    }
    doc.get("base_url")
        .and_then(|v| v.as_str())
        .map(String::from)
        .unwrap_or_default()
}

/// `meta.apiFormat` → ccMesh transformer。
/// anthropic → claude；openai_chat/openai_responses → openai；缺省按 app_type 回落。
fn transformer_from(meta: &Value, app_type: &str) -> String {
    let fmt = meta.get("apiFormat").and_then(|v| v.as_str()).unwrap_or("");
    match fmt {
        "anthropic" | "gemini_native" => "claude".into(),
        "openai_chat" | "openai_responses" => "openai".into(),
        _ => match app_type {
            "codex" => "openai".into(),
            _ => "claude".into(),
        },
    }
}

/// 是否应跳过该供应商（OAuth / 托管账号）。
fn skip_reason(meta: &Value) -> Option<String> {
    // providerType 标识 OAuth/托管
    if let Some(pt) = meta.get("providerType").and_then(|v| v.as_str()) {
        if pt == "github_copilot" || pt == "codex_oauth" {
            return Some(format!("oauth:{pt}"));
        }
    }
    // authBinding.source = managed_account
    if let Some(src) = meta
        .get("authBinding")
        .and_then(|b| b.get("source"))
        .and_then(|v| v.as_str())
    {
        if src == "managed_account" {
            return Some("managed_account".into());
        }
    }
    None
}

/// 解析单行为 MappedProvider。
pub fn map_row(row: &ProviderRow) -> AppResult<MappedProvider> {
    let settings: Value = serde_json::from_str(&row.settings_config).unwrap_or(Value::Null);
    let meta: Value = serde_json::from_str(&row.meta).unwrap_or(Value::Null);

    let remark = format!(
        "{}{}[cc-switch:id={};app={}]",
        row.notes.as_deref().unwrap_or("").trim(),
        if row.notes.as_deref().unwrap_or("").trim().is_empty() {
            ""
        } else {
            " "
        },
        row.id,
        row.app_type
    );

    // OAuth / 托管账号先行跳过（无需解析 url/key）
    if let Some(reason) = skip_reason(&meta) {
        return Ok(MappedProvider {
            cc_switch_id: cc_switch_selection_id(row),
            app_type: row.app_type.clone(),
            name: row.name.clone(),
            raw_url: String::new(),
            api_key: String::new(),
            transformer: transformer_from(&meta, &row.app_type),
            models_hint: vec![],
            remark,
            status: "skipped".into(),
            skip_reason: Some(reason),
        });
    }

    let (raw_url, api_key, models_hint) = match row.app_type.as_str() {
        "claude" => {
            let env = settings.get("env");
            let url = env
                .and_then(|e| e.get("ANTHROPIC_BASE_URL"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim_end_matches('/')
                .to_string();
            // key 优先级：apiKey(顶层) → ANTHROPIC_AUTH_TOKEN → ANTHROPIC_API_KEY
            let key = {
                let top = settings
                    .get("apiKey")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if !top.trim().is_empty() {
                    top.to_string()
                } else {
                    first_non_empty(env, &["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY"])
                }
            };
            let hints = [
                "ANTHROPIC_DEFAULT_SONNET_MODEL",
                "ANTHROPIC_DEFAULT_OPUS_MODEL",
                "ANTHROPIC_DEFAULT_FABLE_MODEL",
                "ANTHROPIC_DEFAULT_HAIKU_MODEL",
                "ANTHROPIC_MODEL",
            ]
            .iter()
            .filter_map(|k| {
                env.and_then(|e| e.get(*k))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.trim().is_empty())
                    .map(String::from)
            })
            .collect::<Vec<_>>();
            (url, key, hints)
        }
        "codex" => {
            let key = first_non_empty(settings.get("auth"), &["OPENAI_API_KEY"]);
            let config = settings
                .get("config")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let url = codex_base_url_from_toml(config)
                .trim_end_matches('/')
                .to_string();
            let mut hints = Vec::new();
            if let Ok(doc) = toml::from_str::<toml::Value>(config) {
                if let Some(m) = doc.get("model").and_then(|v| v.as_str()) {
                    if !m.trim().is_empty() {
                        hints.push(m.to_string());
                    }
                }
            }
            (url, key, hints)
        }
        other => {
            return Ok(MappedProvider {
                cc_switch_id: cc_switch_selection_id(row),
                app_type: row.app_type.clone(),
                name: row.name.clone(),
                raw_url: String::new(),
                api_key: String::new(),
                transformer: transformer_from(&meta, &row.app_type),
                models_hint: vec![],
                remark,
                status: "skipped".into(),
                skip_reason: Some(format!("unsupported_app:{other}")),
            });
        }
    };

    // url / key 缺失或占位 → 跳过
    let skip_reason = if raw_url.trim().is_empty() {
        Some("no_url".into())
    } else if is_placeholder_key(&api_key) {
        Some("no_key".into())
    } else {
        None
    };

    Ok(MappedProvider {
        cc_switch_id: cc_switch_selection_id(row),
        app_type: row.app_type.clone(),
        name: row.name.clone(),
        raw_url,
        api_key,
        transformer: transformer_from(&meta, &row.app_type),
        models_hint,
        remark,
        status: if skip_reason.is_some() {
            "skipped".into()
        } else {
            "ok".into()
        },
        skip_reason,
    })
}

/// 在 ccMesh 已有同名端点时，生成不冲突的名称：`name` → `name (cc-switch)` → `name (cc-switch)-2`…
/// `exists` 返回某名称是否已被占用（含本轮已生成）。
pub fn unique_name(base: &str, exists: impl Fn(&str) -> bool) -> String {
    if !exists(base) {
        return base.to_string();
    }
    let cand1 = format!("{base} (cc-switch)");
    if !exists(&cand1) {
        return cand1;
    }
    let mut n = 2;
    loop {
        let cand = format!("{base} (cc-switch)-{n}");
        if !exists(&cand) {
            return cand;
        }
        n += 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::cc_switch_migration::reader::ProviderRow;

    fn row(app: &str, settings: &str, meta: &str) -> ProviderRow {
        ProviderRow {
            id: "p1".into(),
            app_type: app.into(),
            name: "Test".into(),
            settings_config: settings.into(),
            meta: meta.into(),
            notes: Some("自用".into()),
        }
    }

    #[test]
    fn claude_picks_auth_token_first() {
        let settings = r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.x.com/v1/","ANTHROPIC_AUTH_TOKEN":"sk-auth","ANTHROPIC_API_KEY":"sk-key","ANTHROPIC_DEFAULT_SONNET_MODEL":"sonnet-x","ANTHROPIC_DEFAULT_FABLE_MODEL":"fable-x"}}"#;
        let m = map_row(&row("claude", settings, r#"{"apiFormat":"anthropic"}"#)).unwrap();
        assert_eq!(m.status, "ok");
        assert_eq!(m.raw_url, "https://api.x.com/v1"); // 仅去尾斜杠，/v1 由 normalize 处理
        assert_eq!(m.api_key, "sk-auth");
        assert_eq!(m.transformer, "claude");
        assert_eq!(
            m.models_hint,
            vec!["sonnet-x".to_string(), "fable-x".to_string()]
        );
        assert!(m.remark.contains("[cc-switch:id=p1;app=claude]"));
    }

    #[test]
    fn claude_falls_back_to_api_key() {
        let settings =
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.x.com","ANTHROPIC_API_KEY":"sk-key"}}"#;
        let m = map_row(&row("claude", settings, "{}")).unwrap();
        assert_eq!(m.api_key, "sk-key");
        assert_eq!(m.transformer, "claude"); // 缺省 claude→claude
    }

    #[test]
    fn claude_top_apikey_preferred() {
        let settings = r#"{"env":{"ANTHROPIC_BASE_URL":"https://api.x.com","ANTHROPIC_AUTH_TOKEN":"sk-env"},"apiKey":"sk-top"}"#;
        let m = map_row(&row("claude", settings, "{}")).unwrap();
        assert_eq!(m.api_key, "sk-top");
    }

    #[test]
    fn codex_parses_toml_active_provider() {
        let settings = r#"{"auth":{"OPENAI_API_KEY":"sk-or"},"config":"model_provider = \"OpenRouter\"\nmodel = \"gpt-5-codex\"\n[model_providers.OpenRouter]\nbase_url = \"https://openrouter.ai/api/v1\""}"#;
        let m = map_row(&row(
            "codex",
            settings,
            r#"{"apiFormat":"openai_responses"}"#,
        ))
        .unwrap();
        assert_eq!(m.status, "ok");
        assert_eq!(m.api_key, "sk-or");
        assert_eq!(m.raw_url, "https://openrouter.ai/api/v1");
        assert_eq!(m.transformer, "openai");
        assert_eq!(m.models_hint, vec!["gpt-5-codex".to_string()]);
    }

    #[test]
    fn codex_base_url_top_level_fallback() {
        let settings =
            r#"{"auth":{"OPENAI_API_KEY":"sk"},"config":"base_url = \"https://api.o.com/v1\""}"#;
        let m = map_row(&row("codex", settings, "{}")).unwrap();
        assert_eq!(m.raw_url, "https://api.o.com/v1");
        assert_eq!(m.transformer, "openai"); // 缺省 codex→openai
    }

    #[test]
    fn skip_oauth_provider_type() {
        let m = map_row(&row("claude", "{}", r#"{"providerType":"github_copilot"}"#)).unwrap();
        assert_eq!(m.status, "skipped");
        assert_eq!(m.skip_reason.as_deref(), Some("oauth:github_copilot"));
    }

    #[test]
    fn skip_managed_account() {
        let m = map_row(&row(
            "claude",
            "{}",
            r#"{"authBinding":{"source":"managed_account"}}"#,
        ))
        .unwrap();
        assert_eq!(m.status, "skipped");
        assert_eq!(m.skip_reason.as_deref(), Some("managed_account"));
    }

    #[test]
    fn skip_no_url() {
        let settings = r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"sk"}}"#;
        let m = map_row(&row("claude", settings, "{}")).unwrap();
        assert_eq!(m.status, "skipped");
        assert_eq!(m.skip_reason.as_deref(), Some("no_url"));
    }

    #[test]
    fn skip_placeholder_key() {
        let settings =
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://x.com","ANTHROPIC_API_KEY":"PROXY_MANAGED"}}"#;
        let m = map_row(&row("claude", settings, "{}")).unwrap();
        assert_eq!(m.status, "skipped");
        assert_eq!(m.skip_reason.as_deref(), Some("no_key"));
    }

    #[test]
    fn skip_template_var_key() {
        let settings = r#"{"env":{"ANTHROPIC_BASE_URL":"https://x.com","ANTHROPIC_AUTH_TOKEN":"${CC_TOKEN}"}}"#;
        let m = map_row(&row("claude", settings, "{}")).unwrap();
        assert_eq!(m.status, "skipped");
        assert_eq!(m.skip_reason.as_deref(), Some("no_key"));
    }

    #[test]
    fn selection_id_is_app_type_scoped() {
        let claude = row(
            "claude",
            r#"{"env":{"ANTHROPIC_BASE_URL":"https://a.com","ANTHROPIC_API_KEY":"sk-a"}}"#,
            "{}",
        );
        let codex = row(
            "codex",
            r#"{"auth":{"OPENAI_API_KEY":"sk-b"},"config":"base_url = \"https://b.com/v1\""}"#,
            "{}",
        );
        let m1 = map_row(&claude).unwrap();
        let m2 = map_row(&codex).unwrap();
        assert_eq!(m1.cc_switch_id, "claude:p1");
        assert_eq!(m2.cc_switch_id, "codex:p1");
        assert_ne!(m1.cc_switch_id, m2.cc_switch_id);
    }

    #[test]
    fn unique_name_no_conflict() {
        assert_eq!(unique_name("A", |_| false), "A");
    }

    #[test]
    fn unique_name_one_conflict() {
        let taken = ["A".to_string()];
        assert_eq!(
            unique_name("A", |n| taken.contains(&n.to_string())),
            "A (cc-switch)"
        );
    }

    #[test]
    fn unique_name_two_conflicts() {
        let taken = ["A".to_string(), "A (cc-switch)".to_string()];
        assert_eq!(
            unique_name("A", |n| taken.contains(&n.to_string())),
            "A (cc-switch)-2"
        );
    }
}
