//! Claude Code 用户级 `~/.claude.json` 增量补丁（不是 `~/.claude/settings.json`）。
//!
//! 当前只管理根键 `hasCompletedOnboarding`。其它键（mcpServers / projects 等）原样保留。
//! 关开关 = 删除该键，不写成 `false`。

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::error::{AppError, AppResult};
use crate::utils::atomic_write::atomic_write_str;

const K_ONBOARDING: &str = "hasCompletedOnboarding";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUserFlags {
    pub skip_onboarding: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUserFlagsPatch {
    pub skip_onboarding: Option<bool>,
}

/// 仅当根键为 JSON bool `true` 时视为开启。缺文件 / 缺键 / 其它类型一律为关。
pub fn read_flags(path: &Path) -> AppResult<ClaudeUserFlags> {
    let skip_onboarding = match load_object(path)? {
        None => false,
        Some(root) => is_true(root.get(K_ONBOARDING)),
    };
    Ok(ClaudeUserFlags { skip_onboarding })
}

/// 按 patch 增量改盘；空 patch 只读。已是目标态则不写盘。
pub fn set_flags(path: &Path, patch: &ClaudeUserFlagsPatch) -> AppResult<ClaudeUserFlags> {
    let Some(enabled) = patch.skip_onboarding else {
        return read_flags(path);
    };

    if !enabled && !path.exists() {
        return Ok(ClaudeUserFlags {
            skip_onboarding: false,
        });
    }

    let mut root = match load_object(path)? {
        None => {
            if !enabled {
                return Ok(ClaudeUserFlags {
                    skip_onboarding: false,
                });
            }
            Map::new()
        }
        Some(map) => map,
    };

    if apply_onboarding(&mut root, enabled) {
        write_object(path, &root)?;
    }
    Ok(ClaudeUserFlags {
        skip_onboarding: is_true(root.get(K_ONBOARDING)),
    })
}

fn is_true(v: Option<&Value>) -> bool {
    matches!(v, Some(Value::Bool(true)))
}

/// ON：写入 bool `true`（已是 `true` 则跳过）。OFF：删除该键（不存在则跳过）。
fn apply_onboarding(root: &mut Map<String, Value>, enabled: bool) -> bool {
    if enabled {
        if matches!(root.get(K_ONBOARDING), Some(Value::Bool(true))) {
            return false;
        }
        root.insert(K_ONBOARDING.to_string(), Value::Bool(true));
        true
    } else {
        root.remove(K_ONBOARDING).is_some()
    }
}

fn load_object(path: &Path) -> AppResult<Option<Map<String, Value>>> {
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(path)?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|e| AppError::InvalidArgument(format!("解析 ~/.claude.json 失败: {e}")))?;
    match value {
        Value::Object(map) => Ok(Some(map)),
        _ => Err(AppError::InvalidArgument(
            "~/.claude.json 根必须是对象".into(),
        )),
    }
}

fn write_object(path: &Path, map: &Map<String, Value>) -> AppResult<()> {
    let text = serde_json::to_string_pretty(map)?;
    atomic_write_str(path, &text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn path_in(tmp: &tempfile::TempDir) -> std::path::PathBuf {
        tmp.path().join(".claude.json")
    }

    fn parse(path: &Path) -> Value {
        serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
    }

    #[test]
    fn missing_file_get_is_false_and_does_not_create() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        let flags = read_flags(&path).unwrap();
        assert!(!flags.skip_onboarding);
        assert!(!path.exists());
    }

    #[test]
    fn set_true_creates_file() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        let flags = set_flags(
            &path,
            &ClaudeUserFlagsPatch {
                skip_onboarding: Some(true),
            },
        )
        .unwrap();
        assert!(flags.skip_onboarding);
        let v = parse(&path);
        assert_eq!(v["hasCompletedOnboarding"], Value::Bool(true));
    }

    #[test]
    fn set_true_preserves_other_keys() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        fs::write(
            &path,
            r#"{"mcpServers":{"x":{}},"theme":"dark"}"#,
        )
        .unwrap();
        set_flags(
            &path,
            &ClaudeUserFlagsPatch {
                skip_onboarding: Some(true),
            },
        )
        .unwrap();
        let v = parse(&path);
        assert_eq!(v["hasCompletedOnboarding"], Value::Bool(true));
        assert_eq!(v["theme"], "dark");
        assert!(v["mcpServers"].get("x").is_some());
    }

    #[test]
    fn set_false_removes_key_keeps_others() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        fs::write(
            &path,
            r#"{"hasCompletedOnboarding":true,"mcpServers":{"x":{}}}"#,
        )
        .unwrap();
        let flags = set_flags(
            &path,
            &ClaudeUserFlagsPatch {
                skip_onboarding: Some(false),
            },
        )
        .unwrap();
        assert!(!flags.skip_onboarding);
        let v = parse(&path);
        assert!(v.get("hasCompletedOnboarding").is_none());
        assert!(v["mcpServers"].get("x").is_some());
    }

    #[test]
    fn set_false_on_missing_file_is_noop() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        let flags = set_flags(
            &path,
            &ClaudeUserFlagsPatch {
                skip_onboarding: Some(false),
            },
        )
        .unwrap();
        assert!(!flags.skip_onboarding);
        assert!(!path.exists());
    }

    #[test]
    fn already_true_does_not_rewrite() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        let original = "{\"hasCompletedOnboarding\": true, \"theme\": \"dark\"}";
        fs::write(&path, original).unwrap();
        set_flags(
            &path,
            &ClaudeUserFlagsPatch {
                skip_onboarding: Some(true),
            },
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), original);
    }

    #[test]
    fn root_array_errors_and_does_not_write() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        fs::write(&path, "[]").unwrap();
        let err = set_flags(
            &path,
            &ClaudeUserFlagsPatch {
                skip_onboarding: Some(true),
            },
        )
        .unwrap_err();
        assert!(err.to_string().contains("根必须是对象"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "[]");
    }

    #[test]
    fn invalid_json_errors_and_does_not_write() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        fs::write(&path, "{").unwrap();
        let err = read_flags(&path).unwrap_err();
        assert!(err.to_string().contains("解析"));
        assert_eq!(fs::read_to_string(&path).unwrap(), "{");
    }

    #[test]
    fn empty_patch_is_read_only() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        fs::write(&path, r#"{"hasCompletedOnboarding":true}"#).unwrap();
        let flags = set_flags(&path, &ClaudeUserFlagsPatch::default()).unwrap();
        assert!(flags.skip_onboarding);
    }

    #[test]
    fn non_bool_true_reads_as_off_and_set_normalizes() {
        let tmp = tempdir().unwrap();
        let path = path_in(&tmp);
        fs::write(&path, r#"{"hasCompletedOnboarding":"true"}"#).unwrap();
        assert!(!read_flags(&path).unwrap().skip_onboarding);
        set_flags(
            &path,
            &ClaudeUserFlagsPatch {
                skip_onboarding: Some(true),
            },
        )
        .unwrap();
        assert_eq!(parse(&path)["hasCompletedOnboarding"], Value::Bool(true));
    }
}
