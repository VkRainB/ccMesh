//! Pi 配置管理：`~/.pi/agent/models.json` + `~/.pi/agent/settings.json`。
//! 拆分文件存 `<app_data>/profiles/pi/<id>.json`，默认选择用 `defaultProvider`/`defaultModel`。
//! 与 omp.rs 共享 pi_omp_common.rs 的底层 IO 与校验。

use std::collections::HashMap;
use std::fs;

use serde_json::Value;
use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::models::pi_config::{
    ApplyPiConfigRequest, ApplyPiConfigResult, PiConfigPaths, PiDefaultSelection, PiProviderData,
    PiProviderMeta, PiWorkspaceState, SavePiProviderRequest,
};
use crate::modules::tool_config::pi_omp_common::{
    self, collect_live_provider_entries, list_stored_providers, now_rfc3339, path_to_string,
    provider_file_path, provider_has_model, provider_model_ids, read_document,
    read_stored_provider_optional, rename_live_provider_entry, set_live_provider_entries,
    sync_live_providers, validate_apply_items, validate_provider_id, write_document,
    write_json_file, ResolvedPaths, StoredProvider,
};

pub fn resolve_config_paths(app: &AppHandle) -> AppResult<PiConfigPaths> {
    let resolved = pi_omp_common::resolve_pi_paths(app)?;
    Ok(pi_paths_dto(&resolved))
}

pub fn sync_and_list(app: &AppHandle) -> AppResult<PiWorkspaceState> {
    build_workspace_state(app, true)
}

pub fn get_provider(app: &AppHandle, provider_id: &str) -> AppResult<PiProviderData> {
    validate_provider_id(provider_id)?;
    let resolved = pi_omp_common::resolve_pi_paths(app)?;
    let provider_path = provider_file_path(&resolved.profiles_dir, provider_id);
    let stored_provider = read_stored_provider_optional(&provider_path)?
        .ok_or_else(|| AppError::NotFound(format!("渠道不存在: {provider_id}")))?;
    let models_document = read_document(
        &resolved.models_path,
        resolved.models_format,
        pi_omp_common::empty_models_document(),
    )?;
    let settings_document = read_document(
        &resolved.settings_path,
        resolved.settings_format,
        pi_omp_common::empty_settings_document(),
    )?;
    let default_selection = parse_default_selection(&settings_document);
    let provider_text = serde_json::to_string_pretty(&stored_provider.provider)?;
    Ok(PiProviderData {
        meta: build_provider_meta(&stored_provider, &default_selection),
        provider_json: stored_provider.provider,
        provider_text,
        models_text: pi_omp_common::format_document(resolved.models_format, &models_document)?,
        settings_text: pi_omp_common::format_document(
            resolved.settings_format,
            &settings_document,
        )?,
        paths: pi_paths_dto(&resolved),
        default_selection,
    })
}

pub fn save_provider(app: &AppHandle, request: SavePiProviderRequest) -> AppResult<PiProviderMeta> {
    let provider_id = request.id.trim().to_string();
    validate_provider_id(&provider_id)?;
    if !request.provider_json.is_object() {
        return Err(AppError::InvalidArgument(
            "providerJson 必须是 JSON 对象".into(),
        ));
    }
    let resolved = pi_omp_common::resolve_pi_paths(app)?;
    let provider_path = provider_file_path(&resolved.profiles_dir, &provider_id);
    let now = now_rfc3339();
    let existing_provider = read_stored_provider_optional(&provider_path)?;
    let provider_name = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(&provider_id)
        .to_string();
    let stored_provider = StoredProvider {
        id: provider_id.clone(),
        name: provider_name,
        enabled: request.enabled,
        order: request.order,
        provider: request.provider_json,
        created_at: existing_provider
            .as_ref()
            .map(|provider| provider.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now.clone(),
        configured_at: now,
        applied_at: existing_provider.and_then(|provider| provider.applied_at),
    };
    write_json_file(&provider_path, &stored_provider)?;
    let settings_document = read_document(
        &resolved.settings_path,
        resolved.settings_format,
        pi_omp_common::empty_settings_document(),
    )?;
    let default_selection = parse_default_selection(&settings_document);
    Ok(build_provider_meta(&stored_provider, &default_selection))
}

pub fn delete_provider(app: &AppHandle, provider_id: &str) -> AppResult<PiWorkspaceState> {
    validate_provider_id(provider_id)?;
    let resolved = pi_omp_common::resolve_pi_paths(app)?;
    let provider_path = provider_file_path(&resolved.profiles_dir, provider_id);
    if provider_path.exists() {
        fs::remove_file(&provider_path)?;
    }
    let mut models_document = read_document(
        &resolved.models_path,
        resolved.models_format,
        pi_omp_common::empty_models_document(),
    )?;
    let mut live_provider_entries = collect_live_provider_entries(&models_document)?;
    live_provider_entries
        .retain(|(candidate_provider_id, _provider_json)| candidate_provider_id != provider_id);
    set_live_provider_entries(&mut models_document, live_provider_entries)?;
    let mut settings_document = read_document(
        &resolved.settings_path,
        resolved.settings_format,
        pi_omp_common::empty_settings_document(),
    )?;
    if parse_default_selection(&settings_document)
        .provider
        .as_deref()
        == Some(provider_id)
    {
        remove_default_selection(&mut settings_document)?;
    }
    write_document(
        &resolved.models_path,
        resolved.models_format,
        &models_document,
    )?;
    write_document(
        &resolved.settings_path,
        resolved.settings_format,
        &settings_document,
    )?;
    build_workspace_state(app, false)
}

/// 重命名渠道：一次迁移拆分文件名、汇总文件 providers 键（保持原位置）、settings.json 默认引用。
/// 写入顺序：新拆分文件 → 汇总文件 → settings → 删除旧拆分文件；
/// 中途失败最多残留一个旧拆分文件（下次 sync 可见、可手动删除），不会丢真实配置。
pub fn rename_provider(app: &AppHandle, old_id: &str, new_id: &str) -> AppResult<PiWorkspaceState> {
    let old_id = old_id.trim();
    let new_id = new_id.trim();
    validate_provider_id(old_id)?;
    validate_provider_id(new_id)?;
    if old_id == new_id {
        return Err(AppError::InvalidArgument("新旧 provider id 相同".into()));
    }
    let resolved = pi_omp_common::resolve_pi_paths(app)?;
    let old_provider_path = provider_file_path(&resolved.profiles_dir, old_id);
    let new_provider_path = provider_file_path(&resolved.profiles_dir, new_id);
    let mut stored_provider = read_stored_provider_optional(&old_provider_path)?
        .ok_or_else(|| AppError::NotFound(format!("渠道不存在: {old_id}")))?;
    if new_provider_path.exists() {
        return Err(AppError::InvalidArgument(format!("渠道已存在: {new_id}")));
    }

    let mut models_document = read_document(
        &resolved.models_path,
        resolved.models_format,
        pi_omp_common::empty_models_document(),
    )?;
    let mut live_provider_entries = collect_live_provider_entries(&models_document)?;
    if live_provider_entries
        .iter()
        .any(|(provider_id, _)| provider_id == new_id)
    {
        return Err(AppError::InvalidArgument(format!(
            "汇总文件中已存在 provider: {new_id}"
        )));
    }
    let live_renamed = rename_live_provider_entry(&mut live_provider_entries, old_id, new_id);

    let mut settings_document = read_document(
        &resolved.settings_path,
        resolved.settings_format,
        pi_omp_common::empty_settings_document(),
    )?;
    let default_selection = parse_default_selection(&settings_document);
    let default_renamed = default_selection.provider.as_deref() == Some(old_id);
    if default_renamed {
        if let Some(model_id) = default_selection.model.as_deref() {
            write_default_selection(&mut settings_document, new_id, model_id)?;
        }
    }

    let now = now_rfc3339();
    stored_provider.id = new_id.to_string();
    if stored_provider.name == old_id {
        stored_provider.name = new_id.to_string();
    }
    stored_provider.updated_at = now.clone();
    stored_provider.configured_at = now;

    write_json_file(&new_provider_path, &stored_provider)?;
    if live_renamed {
        set_live_provider_entries(&mut models_document, live_provider_entries)?;
        write_document(
            &resolved.models_path,
            resolved.models_format,
            &models_document,
        )?;
    }
    if default_renamed {
        write_document(
            &resolved.settings_path,
            resolved.settings_format,
            &settings_document,
        )?;
    }
    fs::remove_file(&old_provider_path)?;
    build_workspace_state(app, false)
}

pub fn apply_config(
    app: &AppHandle,
    request: ApplyPiConfigRequest,
) -> AppResult<ApplyPiConfigResult> {
    let resolved = pi_omp_common::resolve_pi_paths(app)?;
    let mut requested_items = request.items;
    requested_items.sort_by(|left_item, right_item| {
        left_item
            .order
            .cmp(&right_item.order)
            .then_with(|| left_item.id.cmp(&right_item.id))
    });
    validate_apply_items(&requested_items)?;

    let mut stored_provider_map: HashMap<String, StoredProvider> =
        list_stored_providers(&resolved.profiles_dir)?
            .into_iter()
            .map(|stored_provider| (stored_provider.id.clone(), stored_provider))
            .collect();
    let now = now_rfc3339();
    let mut enabled_provider_entries = Vec::new();
    for requested_item in &requested_items {
        let stored_provider = stored_provider_map
            .get_mut(&requested_item.id)
            .ok_or_else(|| AppError::NotFound(format!("渠道不存在: {}", requested_item.id)))?;
        stored_provider.enabled = requested_item.enabled;
        stored_provider.order = requested_item.order;
        stored_provider.updated_at = now.clone();
        stored_provider.applied_at = Some(now.clone());
        if requested_item.enabled {
            enabled_provider_entries
                .push((stored_provider.id.clone(), stored_provider.provider.clone()));
        }
    }
    let mut models_document = read_document(
        &resolved.models_path,
        resolved.models_format,
        pi_omp_common::empty_models_document(),
    )?;
    set_live_provider_entries(&mut models_document, enabled_provider_entries.clone())?;
    let mut settings_document = read_document(
        &resolved.settings_path,
        resolved.settings_format,
        pi_omp_common::empty_settings_document(),
    )?;
    reconcile_default_selection(
        &mut settings_document,
        &enabled_provider_entries,
        request.default_provider,
        request.default_model,
    )?;
    write_document(
        &resolved.models_path,
        resolved.models_format,
        &models_document,
    )?;
    write_document(
        &resolved.settings_path,
        resolved.settings_format,
        &settings_document,
    )?;
    for requested_item in &requested_items {
        let stored_provider = stored_provider_map
            .get(&requested_item.id)
            .ok_or_else(|| AppError::NotFound(format!("渠道不存在: {}", requested_item.id)))?;
        write_json_file(
            &provider_file_path(&resolved.profiles_dir, &requested_item.id),
            stored_provider,
        )?;
    }
    let workspace_state = build_workspace_state(app, false)?;
    Ok(ApplyPiConfigResult {
        paths: workspace_state.paths,
        providers: workspace_state.providers,
        default_selection: workspace_state.default_selection,
        enabled_count: enabled_provider_entries.len(),
    })
}

fn pi_paths_dto(resolved: &ResolvedPaths) -> PiConfigPaths {
    PiConfigPaths {
        app_type: "pi".to_string(),
        agent_dir: path_to_string(
            &resolved
                .models_path
                .parent()
                .unwrap_or(&resolved.models_path),
        ),
        models_path: path_to_string(&resolved.models_path),
        settings_path: path_to_string(&resolved.settings_path),
        profiles_dir: path_to_string(&resolved.profiles_dir),
        models_format: resolved.models_format.as_str().to_string(),
        settings_format: resolved.settings_format.as_str().to_string(),
        models_exists: resolved.models_path.exists(),
        settings_exists: resolved.settings_path.exists(),
    }
}

fn parse_default_selection(settings_document: &Value) -> PiDefaultSelection {
    let provider = settings_document
        .get("defaultProvider")
        .and_then(Value::as_str)
        .filter(|provider_id| !provider_id.trim().is_empty())
        .map(str::to_string);
    let model = settings_document
        .get("defaultModel")
        .and_then(Value::as_str)
        .filter(|model_id| !model_id.trim().is_empty())
        .map(str::to_string);
    let selector = provider
        .as_ref()
        .zip(model.as_ref())
        .map(|(provider_id, model_id)| format!("{provider_id}/{model_id}"));
    PiDefaultSelection {
        provider,
        model,
        selector,
    }
}

fn remove_default_selection(settings_document: &mut Value) -> AppResult<()> {
    let root_object = settings_document
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidArgument("程序配置文件根节点必须是对象".into()))?;
    root_object.remove("defaultProvider");
    root_object.remove("defaultModel");
    Ok(())
}

fn write_default_selection(
    settings_document: &mut Value,
    provider_id: &str,
    model_id: &str,
) -> AppResult<()> {
    let root_object = settings_document
        .as_object_mut()
        .ok_or_else(|| AppError::InvalidArgument("程序配置文件根节点必须是对象".into()))?;
    root_object.insert(
        "defaultProvider".to_string(),
        Value::String(provider_id.to_string()),
    );
    root_object.insert(
        "defaultModel".to_string(),
        Value::String(model_id.to_string()),
    );
    Ok(())
}

fn default_selection_is_valid(
    default_selection: &PiDefaultSelection,
    enabled_provider_map: &HashMap<String, Value>,
) -> bool {
    let Some(provider_id) = default_selection.provider.as_deref() else {
        return false;
    };
    let Some(model_id) = default_selection.model.as_deref() else {
        return false;
    };
    enabled_provider_map
        .get(provider_id)
        .map(|provider_json| provider_has_model(provider_json, model_id))
        .unwrap_or(false)
}

fn reconcile_default_selection(
    settings_document: &mut Value,
    enabled_provider_entries: &[(String, Value)],
    requested_provider: Option<String>,
    requested_model: Option<String>,
) -> AppResult<()> {
    let enabled_provider_map: HashMap<String, Value> =
        enabled_provider_entries.iter().cloned().collect();
    let normalized_requested_provider = requested_provider
        .as_deref()
        .map(str::trim)
        .filter(|provider_id| !provider_id.is_empty());
    let normalized_requested_model = requested_model
        .as_deref()
        .map(str::trim)
        .filter(|model_id| !model_id.is_empty());
    if let (Some(provider_id), Some(model_id)) =
        (normalized_requested_provider, normalized_requested_model)
    {
        let requested_default = PiDefaultSelection {
            provider: Some(provider_id.to_string()),
            model: Some(model_id.to_string()),
            selector: None,
        };
        if default_selection_is_valid(&requested_default, &enabled_provider_map) {
            write_default_selection(settings_document, provider_id, model_id)?;
            return Ok(());
        }
    }
    let current_default = parse_default_selection(settings_document);
    if !default_selection_is_valid(&current_default, &enabled_provider_map) {
        remove_default_selection(settings_document)?;
    }
    Ok(())
}

fn build_provider_meta(
    stored_provider: &StoredProvider,
    default_selection: &PiDefaultSelection,
) -> PiProviderMeta {
    let is_default = default_selection.provider.as_deref() == Some(stored_provider.id.as_str())
        && default_selection.model.is_some();
    PiProviderMeta {
        id: stored_provider.id.clone(),
        name: stored_provider.name.clone(),
        enabled: stored_provider.enabled,
        order: stored_provider.order,
        model_count: provider_model_ids(&stored_provider.provider).len(),
        is_default,
        updated_at: stored_provider.updated_at.clone(),
        configured_at: stored_provider.configured_at.clone(),
        applied_at: stored_provider.applied_at.clone(),
    }
}

fn build_workspace_state(app: &AppHandle, sync_from_live: bool) -> AppResult<PiWorkspaceState> {
    let resolved = pi_omp_common::resolve_pi_paths(app)?;
    if sync_from_live {
        sync_live_providers(&resolved)?;
    }
    let models_document = read_document(
        &resolved.models_path,
        resolved.models_format,
        pi_omp_common::empty_models_document(),
    )?;
    let settings_document = read_document(
        &resolved.settings_path,
        resolved.settings_format,
        pi_omp_common::empty_settings_document(),
    )?;
    let default_selection = parse_default_selection(&settings_document);
    let provider_metas = list_stored_providers(&resolved.profiles_dir)?
        .iter()
        .map(|p| build_provider_meta(p, &default_selection))
        .collect();
    Ok(PiWorkspaceState {
        paths: pi_paths_dto(&resolved),
        providers: provider_metas,
        default_selection,
        models_text: pi_omp_common::format_document(resolved.models_format, &models_document)?,
        settings_text: pi_omp_common::format_document(
            resolved.settings_format,
            &settings_document,
        )?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_default_selection_reads_provider_and_model() {
        let settings = json!({ "defaultProvider": "local", "defaultModel": "deepseek-v4-flash" });
        let selection = parse_default_selection(&settings);
        assert_eq!(selection.provider.as_deref(), Some("local"));
        assert_eq!(selection.model.as_deref(), Some("deepseek-v4-flash"));
        assert_eq!(
            selection.selector.as_deref(),
            Some("local/deepseek-v4-flash")
        );
    }

    #[test]
    fn parse_default_selection_ignores_empty_strings() {
        let settings = json!({ "defaultProvider": "", "defaultModel": "  " });
        let selection = parse_default_selection(&settings);
        assert!(selection.provider.is_none());
        assert!(selection.model.is_none());
    }

    #[test]
    fn remove_default_selection_clears_both_keys() {
        let mut settings = json!({ "defaultProvider": "local", "defaultModel": "m", "other": 1 });
        remove_default_selection(&mut settings).unwrap();
        assert!(settings.get("defaultProvider").is_none());
        assert!(settings.get("defaultModel").is_none());
        assert_eq!(settings.get("other"), Some(&json!(1)));
    }

    #[test]
    fn reconcile_removes_invalid_default_when_provider_disabled() {
        let mut settings = json!({ "defaultProvider": "remote-gpt", "defaultModel": "gpt-5.5" });
        reconcile_default_selection(&mut settings, &[], None, None).unwrap();
        assert!(settings.get("defaultProvider").is_none());
        assert!(settings.get("defaultModel").is_none());
    }

    #[test]
    fn reconcile_writes_requested_default_when_model_exists() {
        let provider_json = json!({ "models": [{ "id": "gpt-5.5" }] });
        let mut settings = json!({});
        reconcile_default_selection(
            &mut settings,
            &[("remote-gpt".to_string(), provider_json)],
            Some("remote-gpt".to_string()),
            Some("gpt-5.5".to_string()),
        )
        .unwrap();
        assert_eq!(
            settings.get("defaultProvider").and_then(Value::as_str),
            Some("remote-gpt")
        );
        assert_eq!(
            settings.get("defaultModel").and_then(Value::as_str),
            Some("gpt-5.5")
        );
    }
}
