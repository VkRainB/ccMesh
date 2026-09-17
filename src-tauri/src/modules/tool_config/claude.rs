//! Claude Code 配置：操作字段 ↔ settings.json 快照 的纯逻辑。
//!
//! 字段契约（操作字段写入 `env` 下，按需求使用 `ANTHROPIC_API_KEY`）：
//! - base_url      → env.ANTHROPIC_BASE_URL
//! - api_key       → env.ANTHROPIC_API_KEY
//! - sonnet/opus/fable/haiku → env.ANTHROPIC_DEFAULT_{SONNET,OPUS,FABLE,HAIKU}_MODEL
//! - default_model → env.ANTHROPIC_MODEL

use serde_json::{json, Map, Value};

use crate::models::tool_config::ClaudeOperationFields;

const K_BASE_URL: &str = "ANTHROPIC_BASE_URL";
const K_API_KEY: &str = "ANTHROPIC_API_KEY";
const K_SONNET: &str = "ANTHROPIC_DEFAULT_SONNET_MODEL";
const K_OPUS: &str = "ANTHROPIC_DEFAULT_OPUS_MODEL";
const K_FABLE: &str = "ANTHROPIC_DEFAULT_FABLE_MODEL";
const K_HAIKU: &str = "ANTHROPIC_DEFAULT_HAIKU_MODEL";
const K_MODEL: &str = "ANTHROPIC_MODEL";

fn set_or_remove(map: &mut Map<String, Value>, key: &str, val: &str) {
    if val.is_empty() {
        map.remove(key);
    } else {
        map.insert(key.to_string(), Value::String(val.to_string()));
    }
}

/// 从快照 `env` 读取操作字段（用于初始化表单）。
pub fn parse_operation_fields(snapshot: &Value) -> ClaudeOperationFields {
    let env = snapshot.get("env");
    let get = |k: &str| {
        env.and_then(|e| e.get(k))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    ClaudeOperationFields {
        base_url: get(K_BASE_URL),
        api_key: get(K_API_KEY),
        sonnet_model: get(K_SONNET),
        opus_model: get(K_OPUS),
        fable_model: get(K_FABLE),
        haiku_model: get(K_HAIKU),
        default_model: get(K_MODEL),
    }
}

/// 把操作字段合并进基线快照（保留所有非操作字段），返回整合后的完整配置。
/// 空字符串字段视为"清除"，从 env 中移除对应键。
pub fn merge_operation_fields(base: &Value, f: &ClaudeOperationFields) -> Value {
    let mut root = base.clone();
    if !root.is_object() {
        root = json!({});
    }
    let obj = root.as_object_mut().expect("root is object");
    let env_entry = obj.entry("env").or_insert_with(|| json!({}));
    if !env_entry.is_object() {
        *env_entry = json!({});
    }
    let env = env_entry.as_object_mut().expect("env is object");
    set_or_remove(env, K_BASE_URL, &f.base_url);
    set_or_remove(env, K_API_KEY, &f.api_key);
    set_or_remove(env, K_SONNET, &f.sonnet_model);
    set_or_remove(env, K_OPUS, &f.opus_model);
    set_or_remove(env, K_FABLE, &f.fable_model);
    set_or_remove(env, K_HAIKU, &f.haiku_model);
    set_or_remove(env, K_MODEL, &f.default_model);
    root
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_reads_env_fields() {
        let snap = json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://cc",
                "ANTHROPIC_API_KEY": "sk-1",
                "ANTHROPIC_DEFAULT_SONNET_MODEL": "mimo[1m]",
                "ANTHROPIC_DEFAULT_FABLE_MODEL": "mimo-fable[1m]",
                "ANTHROPIC_MODEL": "mimo"
            }
        });
        let f = parse_operation_fields(&snap);
        assert_eq!(f.base_url, "https://cc");
        assert_eq!(f.api_key, "sk-1");
        assert_eq!(f.sonnet_model, "mimo[1m]");
        assert_eq!(f.fable_model, "mimo-fable[1m]");
        assert_eq!(f.default_model, "mimo");
        assert_eq!(f.opus_model, "");
    }

    #[test]
    fn merge_preserves_non_operation_fields() {
        let base = json!({
            "env": {
                "ANTHROPIC_BASE_URL": "https://old",
                "MY_CUSTOM_VAR": "keep-me"
            },
            "permissions": { "allow": ["*"] }
        });
        let f = ClaudeOperationFields {
            base_url: "https://new".into(),
            api_key: "sk-new".into(),
            sonnet_model: "s[1m]".into(),
            opus_model: "o".into(),
            fable_model: "f[1m]".into(),
            haiku_model: "h".into(),
            default_model: "".into(),
        };
        let merged = merge_operation_fields(&base, &f);
        let env = merged.get("env").unwrap();
        assert_eq!(env.get("ANTHROPIC_BASE_URL").unwrap(), "https://new");
        assert_eq!(env.get("ANTHROPIC_API_KEY").unwrap(), "sk-new");
        assert_eq!(env.get("ANTHROPIC_DEFAULT_SONNET_MODEL").unwrap(), "s[1m]");
        assert_eq!(env.get("ANTHROPIC_DEFAULT_FABLE_MODEL").unwrap(), "f[1m]");
        // 非操作字段保留
        assert_eq!(env.get("MY_CUSTOM_VAR").unwrap(), "keep-me");
        assert!(merged.get("permissions").is_some());
        // 空 default_model → 不写入键
        assert!(env.get("ANTHROPIC_MODEL").is_none());
    }

    #[test]
    fn merge_creates_env_when_missing() {
        let base = json!({ "other": 1 });
        let f = ClaudeOperationFields {
            base_url: "https://x".into(),
            ..Default::default()
        };
        let merged = merge_operation_fields(&base, &f);
        assert_eq!(
            merged
                .get("env")
                .unwrap()
                .get("ANTHROPIC_BASE_URL")
                .unwrap(),
            "https://x"
        );
        assert_eq!(merged.get("other").unwrap(), 1);
    }
}
