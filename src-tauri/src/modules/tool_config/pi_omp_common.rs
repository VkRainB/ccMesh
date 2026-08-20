//! pi / omp 共享工具层：路径解析辅助、文件读写、provider id 校验、
//! 拆分文件存储结构、provider model id 提取等与 app 类型无关的纯工具。
//!
//! pi.rs / omp.rs 各自实现 default_selection 解析、sync、save、delete、apply 等业务逻辑，
//! 通过本模块复用底层文件 IO 与校验。

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::utils::atomic_write::atomic_write_str;
use crate::utils::paths;

/// 配置文件格式：JSON 或 YAML。OMP 默认 YAML，Pi 默认 JSON。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfigFileFormat {
    Json,
    Yaml,
}

impl ConfigFileFormat {
    pub fn from_path(path: &Path) -> Self {
        match path.extension().and_then(|extension| extension.to_str()) {
            Some("json") => Self::Json,
            _ => Self::Yaml,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Yaml => "yaml",
        }
    }
}

/// 拆分渠道存储结构（pi 与 omp 共用同一形态）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredProvider {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub order: usize,
    pub provider: Value,
    pub created_at: String,
    pub updated_at: String,
    pub configured_at: String,
    #[serde(default)]
    pub applied_at: Option<String>,
}

/// 应用时前端提交的排序和启用状态（pi 与 omp 共用）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyItem {
    pub id: String,
    pub enabled: bool,
    pub order: usize,
}

pub fn now_rfc3339() -> String {
    chrono::Local::now().to_rfc3339()
}

pub fn path_to_string(path: &Path) -> String {
    path.display().to_string()
}

/// provider id 校验：仅字母、数字、点、下划线、短横线，长度 1..=128，非 `.`/`..`。
pub fn validate_provider_id(provider_id: &str) -> AppResult<()> {
    let provider_id = provider_id.trim();
    let valid_characters = provider_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '-'));
    if provider_id.is_empty()
        || provider_id == "."
        || provider_id == ".."
        || provider_id.len() > 128
        || !valid_characters
    {
        return Err(AppError::InvalidArgument(format!(
            "非法 provider id: {provider_id}；仅支持字母、数字、点、下划线、短横线"
        )));
    }
    Ok(())
}

pub fn empty_models_document() -> Value {
    serde_json::json!({ "providers": {} })
}

pub fn empty_settings_document() -> Value {
    serde_json::json!({})
}

pub fn read_document(path: &Path, format: ConfigFileFormat, fallback: Value) -> AppResult<Value> {
    if !path.exists() {
        return Ok(fallback);
    }
    let text = fs::read_to_string(path)?;
    if text.trim().is_empty() {
        return Ok(fallback);
    }
    match format {
        ConfigFileFormat::Json => serde_json::from_str(&text).map_err(|error| {
            AppError::InvalidArgument(format!("解析失败 {}: {error}", path.display()))
        }),
        ConfigFileFormat::Yaml => serde_yaml::from_str(&text).map_err(|error| {
            AppError::InvalidArgument(format!("解析失败 {}: {error}", path.display()))
        }),
    }
}

pub fn format_document(format: ConfigFileFormat, value: &Value) -> AppResult<String> {
    match format {
        ConfigFileFormat::Json => serde_json::to_string_pretty(value).map_err(AppError::from),
        ConfigFileFormat::Yaml => serde_yaml::to_string(value)
            .map_err(|error| AppError::InvalidArgument(format!("YAML 序列化失败: {error}"))),
    }
}

pub fn write_document(path: &Path, format: ConfigFileFormat, value: &Value) -> AppResult<()> {
    atomic_write_str(path, &format_document(format, value)?)
}

pub fn provider_file_path(profiles_dir: &Path, provider_id: &str) -> PathBuf {
    profiles_dir.join(format!("{provider_id}.json"))
}

pub fn read_json_file<T: for<'de> Deserialize<'de>>(path: &Path) -> AppResult<T> {
    let text = fs::read_to_string(path)?;
    serde_json::from_str(&text)
        .map_err(|error| AppError::InvalidArgument(format!("解析失败 {}: {error}", path.display())))
}

pub fn write_json_file<T: Serialize>(path: &Path, value: &T) -> AppResult<()> {
    let text = serde_json::to_string_pretty(value)?;
    atomic_write_str(path, &text)
}

pub fn read_stored_provider(path: &Path) -> AppResult<StoredProvider> {
    let stored_provider: StoredProvider = read_json_file(path)?;
    validate_provider_id(&stored_provider.id)?;
    if !stored_provider.provider.is_object() {
        return Err(AppError::InvalidArgument(format!(
            "拆分渠道不是 JSON 对象: {}",
            path.display()
        )));
    }
    Ok(stored_provider)
}

pub fn read_stored_provider_optional(path: &Path) -> AppResult<Option<StoredProvider>> {
    if !path.exists() {
        return Ok(None);
    }
    read_stored_provider(path).map(Some)
}

pub fn list_stored_providers(profiles_dir: &Path) -> AppResult<Vec<StoredProvider>> {
    fs::create_dir_all(profiles_dir)?;
    let mut stored_providers = Vec::new();
    for entry_result in fs::read_dir(profiles_dir)? {
        let entry = entry_result?;
        let entry_path = entry.path();
        if !entry_path.is_file() {
            continue;
        }
        if entry_path
            .extension()
            .and_then(|extension| extension.to_str())
            != Some("json")
        {
            continue;
        }
        stored_providers.push(read_stored_provider(&entry_path)?);
    }
    sort_stored_providers(&mut stored_providers);
    Ok(stored_providers)
}

pub fn sort_stored_providers(stored_providers: &mut [StoredProvider]) {
    stored_providers.sort_by(|left_provider, right_provider| {
        left_provider
            .order
            .cmp(&right_provider.order)
            .then_with(|| {
                left_provider
                    .name
                    .to_lowercase()
                    .cmp(&right_provider.name.to_lowercase())
            })
            .then_with(|| left_provider.id.cmp(&right_provider.id))
    });
}

pub fn collect_live_provider_entries(models_document: &Value) -> AppResult<Vec<(String, Value)>> {
    let root_object = models_document
        .as_object()
        .ok_or_else(|| AppError::InvalidArgument("模型汇总文件根节点必须是对象".into()))?;
    let Some(providers_value) = root_object.get("providers") else {
        return Ok(Vec::new());
    };
    let providers_object = providers_value
        .as_object()
        .ok_or_else(|| AppError::InvalidArgument("模型汇总文件 providers 必须是对象".into()))?;
    providers_object
        .iter()
        .map(|(provider_id, provider_json)| {
            validate_provider_id(provider_id)?;
            if !provider_json.is_object() {
                return Err(AppError::InvalidArgument(format!(
                    "provider {provider_id} 必须是对象"
                )));
            }
            Ok((provider_id.clone(), provider_json.clone()))
        })
        .collect()
}

pub fn set_live_provider_entries(
    models_document: &mut Value,
    provider_entries: Vec<(String, Value)>,
) -> AppResult<()> {
    let root_object = models_document
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidArgument("模型汇总文件根节点必须是对象".into()))?;
    let mut providers_object = Map::new();
    for (provider_id, provider_json) in provider_entries {
        validate_provider_id(&provider_id)?;
        if !provider_json.is_object() {
            return Err(AppError::InvalidArgument(format!(
                "provider {provider_id} 必须是对象"
            )));
        }
        providers_object.insert(provider_id, provider_json);
    }
    root_object.insert("providers".to_string(), Value::Object(providers_object));
    Ok(())
}

/// 在 live entries 里把 `old_id` 的键改成 `new_id`，保持原位置（serde_json 已开 preserve_order）。
/// 返回是否发生了替换（old_id 不在汇总文件里时返回 false，如未启用/未应用的渠道）。
pub fn rename_live_provider_entry(
    provider_entries: &mut [(String, Value)],
    old_id: &str,
    new_id: &str,
) -> bool {
    for (provider_id, _provider_json) in provider_entries.iter_mut() {
        if provider_id == old_id {
            *provider_id = new_id.to_string();
            return true;
        }
    }
    false
}

pub fn provider_model_ids(provider_json: &Value) -> Vec<String> {
    provider_json
        .get("models")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

pub fn provider_has_model(provider_json: &Value, model_id: &str) -> bool {
    provider_model_ids(provider_json)
        .iter()
        .any(|candidate_model_id| candidate_model_id == model_id)
}

/// 校验 apply 请求的 items：去重 + provider id 合法性。
pub fn validate_apply_items(items: &[ApplyItem]) -> AppResult<()> {
    let mut seen_provider_ids = HashSet::new();
    for item in items {
        validate_provider_id(&item.id)?;
        if !seen_provider_ids.insert(item.id.clone()) {
            return Err(AppError::InvalidArgument(format!(
                "重复 provider id: {}",
                item.id
            )));
        }
    }
    Ok(())
}

/// pi / omp 共用的路径解析结果（不含 app_type 字段，由各自 DTO 包装）。
pub struct ResolvedPaths {
    pub models_path: PathBuf,
    pub settings_path: PathBuf,
    pub profiles_dir: PathBuf,
    pub models_format: ConfigFileFormat,
    pub settings_format: ConfigFileFormat,
}

/// pi 路径解析：`~/.pi/agent/models.json` + `~/.pi/agent/settings.json` + `<app_data>/profiles/pi`。
pub fn resolve_pi_paths(app: &AppHandle) -> AppResult<ResolvedPaths> {
    let models_path =
        paths::pi_models_path().ok_or_else(|| AppError::Config("无法定位用户主目录".into()))?;
    let settings_path = paths::pi_settings_path()
        .ok_or_else(|| AppError::Config("无法定位程序配置文件路径".into()))?;
    let profiles_dir = paths::pi_profiles_dir(app)?;
    let models_format = ConfigFileFormat::from_path(&models_path);
    let settings_format = ConfigFileFormat::from_path(&settings_path);
    Ok(ResolvedPaths {
        models_path,
        settings_path,
        profiles_dir,
        models_format,
        settings_format,
    })
}

/// omp 路径解析：`~/.omp/agent/models.yml` + `~/.omp/agent/config.yml` + `<app_data>/profiles/omp`。
pub fn resolve_omp_paths(app: &AppHandle) -> AppResult<ResolvedPaths> {
    let models_path =
        paths::omp_models_path().ok_or_else(|| AppError::Config("无法定位用户主目录".into()))?;
    let settings_path = paths::omp_settings_path()
        .ok_or_else(|| AppError::Config("无法定位程序配置文件路径".into()))?;
    let profiles_dir = paths::omp_profiles_dir(app)?;
    let models_format = ConfigFileFormat::from_path(&models_path);
    let settings_format = ConfigFileFormat::from_path(&settings_path);
    Ok(ResolvedPaths {
        models_path,
        settings_path,
        profiles_dir,
        models_format,
        settings_format,
    })
}

/// 拆分文件存在「已保存但未应用」的本地编辑：configuredAt 晚于 appliedAt，或从未应用过。
fn has_pending_edits(stored_provider: &StoredProvider) -> bool {
    let Some(applied_at) = stored_provider.applied_at.as_deref() else {
        return true;
    };
    match (
        chrono::DateTime::parse_from_rfc3339(&stored_provider.configured_at),
        chrono::DateTime::parse_from_rfc3339(applied_at),
    ) {
        (Ok(configured_at), Ok(applied_at)) => configured_at > applied_at,
        // ponytail: 时间戳均出自 now_rfc3339，解析失败只会是文件被手改坏，按字符串比较兜底
        _ => stored_provider.configured_at.as_str() > applied_at,
    }
}

/// 真实汇总文件 → 拆分目录 单向同步（pi/omp 共用）：
/// - 汇总有、拆分无：导入为已启用拆分文件；
/// - 两边都有：以汇总为准刷新（外部编辑生效），并推进 appliedAt（刷新后两边内容一致）；
/// - 拆分有、汇总无：视为外部删除，置为停用并把 order 排到汇总条目之后；
/// - 例外：拆分文件有「保存未应用」的挂起编辑时整体跳过，保住用户攒着的修改。
pub fn sync_live_providers(resolved: &ResolvedPaths) -> AppResult<()> {
    let models_document = read_document(
        &resolved.models_path,
        resolved.models_format,
        empty_models_document(),
    )?;
    let live_provider_entries = collect_live_provider_entries(&models_document)?;
    let live_provider_ids: HashSet<String> = live_provider_entries
        .iter()
        .map(|(provider_id, _)| provider_id.clone())
        .collect();
    let now = now_rfc3339();
    let mut stored_provider_map: HashMap<String, StoredProvider> =
        list_stored_providers(&resolved.profiles_dir)?
            .into_iter()
            .map(|stored_provider| (stored_provider.id.clone(), stored_provider))
            .collect();
    for (provider_order, (provider_id, provider_json)) in live_provider_entries.iter().enumerate() {
        let existing_provider = stored_provider_map.remove(provider_id);
        if existing_provider.as_ref().is_some_and(has_pending_edits) {
            continue;
        }
        let mut stored_provider = existing_provider.unwrap_or_else(|| StoredProvider {
            id: provider_id.clone(),
            name: provider_id.clone(),
            enabled: true,
            order: provider_order,
            provider: provider_json.clone(),
            created_at: now.clone(),
            updated_at: now.clone(),
            configured_at: now.clone(),
            applied_at: Some(now.clone()),
        });
        let provider_changed = stored_provider.provider != *provider_json;
        let enabled_changed = !stored_provider.enabled;
        let order_changed = stored_provider.order != provider_order;
        stored_provider.enabled = true;
        stored_provider.order = provider_order;
        stored_provider.provider = provider_json.clone();
        if provider_changed || enabled_changed || order_changed {
            stored_provider.updated_at = now.clone();
            stored_provider.configured_at = now.clone();
            // 刷新后拆分内容与汇总一致，appliedAt 同步推进，避免被误判为挂起编辑
            stored_provider.applied_at = Some(now.clone());
        }
        write_json_file(
            &provider_file_path(&resolved.profiles_dir, provider_id),
            &stored_provider,
        )?;
    }
    let mut trailing_order = live_provider_ids.len();
    for mut stored_provider in stored_provider_map.into_values() {
        if has_pending_edits(&stored_provider) {
            continue;
        }
        // 此循环只剩汇总里没有的条目：仍启用的说明被外部删除，置为停用
        if stored_provider.enabled {
            stored_provider.enabled = false;
            stored_provider.updated_at = now.clone();
        }
        if stored_provider.order < live_provider_ids.len() {
            stored_provider.order = trailing_order;
            trailing_order += 1;
        }
        write_json_file(
            &provider_file_path(&resolved.profiles_dir, &stored_provider.id),
            &stored_provider,
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_provider_id_rejects_unsafe() {
        assert!(validate_provider_id("../etc").is_err());
        assert!(validate_provider_id("a/b").is_err());
        assert!(validate_provider_id("").is_err());
        assert!(validate_provider_id("ok-id_1.0").is_ok());
    }

    #[test]
    fn collect_live_provider_entries_returns_empty_when_no_providers() {
        let doc = serde_json::json!({});
        assert!(collect_live_provider_entries(&doc).unwrap().is_empty());
    }

    #[test]
    fn rename_live_provider_entry_keeps_position_and_value() {
        let mut entries = vec![
            ("a".to_string(), serde_json::json!({ "baseUrl": "u1" })),
            ("b".to_string(), serde_json::json!({ "baseUrl": "u2" })),
            ("c".to_string(), serde_json::json!({ "baseUrl": "u3" })),
        ];
        assert!(rename_live_provider_entry(&mut entries, "b", "b2"));
        assert_eq!(entries[1].0, "b2");
        assert_eq!(entries[1].1, serde_json::json!({ "baseUrl": "u2" }));
        assert!(!rename_live_provider_entry(&mut entries, "missing", "x"));
    }

    fn stored_provider(
        id: &str,
        enabled: bool,
        provider: Value,
        configured_at: &str,
        applied_at: Option<&str>,
    ) -> StoredProvider {
        StoredProvider {
            id: id.to_string(),
            name: id.to_string(),
            enabled,
            order: 0,
            provider,
            created_at: "2026-01-01T00:00:00+08:00".to_string(),
            updated_at: configured_at.to_string(),
            configured_at: configured_at.to_string(),
            applied_at: applied_at.map(str::to_string),
        }
    }

    #[test]
    fn has_pending_edits_compares_timestamps_not_strings() {
        let clean = stored_provider(
            "a",
            true,
            serde_json::json!({}),
            "2026-01-01T00:00:00+08:00",
            Some("2026-01-02T00:00:00+08:00"),
        );
        assert!(!has_pending_edits(&clean));
        let saved_after_apply = stored_provider(
            "a",
            true,
            serde_json::json!({}),
            "2026-01-03T00:00:00+08:00",
            Some("2026-01-02T00:00:00+08:00"),
        );
        assert!(has_pending_edits(&saved_after_apply));
        let never_applied = stored_provider(
            "a",
            true,
            serde_json::json!({}),
            "2026-01-01T00:00:00+08:00",
            None,
        );
        assert!(has_pending_edits(&never_applied));
        // 跨时区偏移：09:00+08:00(=01:00Z) 早于 02:00Z，字符串序会误判为挂起
        let cross_timezone = stored_provider(
            "a",
            true,
            serde_json::json!({}),
            "2026-01-02T09:00:00+08:00",
            Some("2026-01-02T02:00:00+00:00"),
        );
        assert!(!has_pending_edits(&cross_timezone));
    }

    #[test]
    fn sync_live_providers_preserves_pending_edits() {
        let temp_dir = tempfile::tempdir().unwrap();
        let resolved = ResolvedPaths {
            models_path: temp_dir.path().join("models.json"),
            settings_path: temp_dir.path().join("settings.json"),
            profiles_dir: temp_dir.path().join("profiles"),
            models_format: ConfigFileFormat::Json,
            settings_format: ConfigFileFormat::Json,
        };
        // edited：保存晚于应用（含停用），live 里仍有旧版 → 必须保持原样
        write_json_file(
            &provider_file_path(&resolved.profiles_dir, "edited"),
            &stored_provider(
                "edited",
                false,
                serde_json::json!({ "baseUrl": "local-edit" }),
                "2026-01-03T00:00:00+08:00",
                Some("2026-01-02T00:00:00+08:00"),
            ),
        )
        .unwrap();
        // clean：应用晚于保存，live 内容变了 → 以 live 为准刷新
        write_json_file(
            &provider_file_path(&resolved.profiles_dir, "clean"),
            &stored_provider(
                "clean",
                true,
                serde_json::json!({ "baseUrl": "old" }),
                "2026-01-01T00:00:00+08:00",
                Some("2026-01-02T00:00:00+08:00"),
            ),
        )
        .unwrap();
        // fresh：新建从未应用、live 里没有 → 不得被停用
        write_json_file(
            &provider_file_path(&resolved.profiles_dir, "fresh"),
            &stored_provider(
                "fresh",
                true,
                serde_json::json!({ "baseUrl": "new" }),
                "2026-01-03T00:00:00+08:00",
                None,
            ),
        )
        .unwrap();
        let models_document = serde_json::json!({ "providers": {
            "edited": { "baseUrl": "live" },
            "clean": { "baseUrl": "live-updated" },
            "imported": { "baseUrl": "external" },
        }});
        write_document(
            &resolved.models_path,
            ConfigFileFormat::Json,
            &models_document,
        )
        .unwrap();

        sync_live_providers(&resolved).unwrap();

        let edited =
            read_stored_provider(&provider_file_path(&resolved.profiles_dir, "edited")).unwrap();
        assert_eq!(
            edited.provider,
            serde_json::json!({ "baseUrl": "local-edit" })
        );
        assert!(!edited.enabled);
        let clean =
            read_stored_provider(&provider_file_path(&resolved.profiles_dir, "clean")).unwrap();
        assert_eq!(
            clean.provider,
            serde_json::json!({ "baseUrl": "live-updated" })
        );
        assert!(!has_pending_edits(&clean), "sync 刷新后不应被视为挂起编辑");
        let imported =
            read_stored_provider(&provider_file_path(&resolved.profiles_dir, "imported")).unwrap();
        assert!(imported.enabled);
        assert_eq!(
            imported.provider,
            serde_json::json!({ "baseUrl": "external" })
        );
        let fresh =
            read_stored_provider(&provider_file_path(&resolved.profiles_dir, "fresh")).unwrap();
        assert!(fresh.enabled, "新建未应用的渠道不应被 sync 停用");
        assert_eq!(fresh.provider, serde_json::json!({ "baseUrl": "new" }));
    }
}
