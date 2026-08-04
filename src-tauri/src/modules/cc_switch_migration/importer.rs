//! 导入编排：对勾选的 cc-switch 供应商探测模型并写入 ccMesh endpoints。
//!
//! - 复用 `probe_models` 探测 `/v1/models`；探测失败仍入库 `enabled=false`。
//! - 同名端点自动加 `(cc-switch)` 后缀（`mapper::unique_name`）。
//! - 写库后由命令层 emit endpoints-changed。

use std::time::Duration;

use rusqlite::Connection;

use crate::error::AppResult;
use crate::models::endpoint::CreateEndpointRequest;
use crate::modules::cc_switch_migration::mapper::MappedProvider;
use crate::modules::cc_switch_migration::url_normalize::normalize_api_url_for_ccmesh;
use crate::modules::models_probe::probe_models;
use crate::modules::proxy::client::{build_client, should_use_proxy};
use crate::modules::storage::{config_repo, endpoint_repo};

/// 一条导入结果（命令 payload 项）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportItem {
    pub name: String,
    /// "imported" | "skipped"。
    pub status: String,
    pub model_count: usize,
    pub enabled: bool,
    pub skip_reason: Option<String>,
}

/// 导入摘要（命令 payload）。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub total: usize,
    pub imported: usize,
    pub enabled_count: usize,
    pub disabled_no_models: usize,
    pub skipped: usize,
    pub items: Vec<ImportItem>,
}

/// hint 命中探测列表则锁定该模型，否则空（透传）。
fn pick_lock_model(hints: &[String], probed: &[String]) -> String {
    for h in hints {
        if probed.iter().any(|p| p == h) {
            return h.clone();
        }
    }
    String::new()
}

/// 对已识别（status=ok）且被勾选的供应商执行探测 + 写库。
///
/// `providers` 应为预览阶段的全部映射项；`selected_ids` 为用户勾选的 `{app_type}:{id}` 集合。
/// skipped 项即使被勾选也不会导入（前端已置灰，这里双保险）。
pub async fn import(
    conn: &mut Connection,
    client: &reqwest::Client,
    providers: &[MappedProvider],
    selected_ids: &[String],
) -> AppResult<ImportSummary> {
    let selected: std::collections::HashSet<&str> =
        selected_ids.iter().map(|s| s.as_str()).collect();

    // 本轮已生成名称集合，避免批量导入时同源重名互相冲突。
    let mut used_names: std::collections::HashSet<String> = {
        let existing = endpoint_repo::list_all(conn)?;
        existing.iter().map(|e| e.name.clone()).collect()
    };

    let mut items = Vec::new();
    let mut imported = 0usize;
    let mut enabled_count = 0usize;
    let mut disabled_no_models = 0usize;
    let mut skipped = 0usize;
    let mut total = 0usize;

    for p in providers {
        if !selected.contains(p.cc_switch_id.as_str()) {
            continue;
        }
        if p.status != "ok" {
            skipped += 1;
            items.push(ImportItem {
                name: p.name.clone(),
                status: "skipped".into(),
                model_count: 0,
                enabled: false,
                skip_reason: p.skip_reason.clone(),
            });
            continue;
        }
        total += 1;

        // URL 规整失败 → 跳过该项
        let api_url = match normalize_api_url_for_ccmesh(&p.raw_url) {
            Ok(u) => u,
            Err(_) => {
                skipped += 1;
                items.push(ImportItem {
                    name: p.name.clone(),
                    status: "skipped".into(),
                    model_count: 0,
                    enabled: false,
                    skip_reason: Some("invalid_api_url".into()),
                });
                continue;
            }
        };

        // 探测模型（失败返回空 Vec，不报错）
        let model_ids = probe_models(client, &api_url, &p.api_key, &p.transformer).await;
        let probed = !model_ids.is_empty();

        let name = crate::modules::cc_switch_migration::mapper::unique_name(&p.name, |n| {
            used_names.contains(n)
        });
        used_names.insert(name.clone());

        let req = CreateEndpointRequest {
            name: name.clone(),
            api_url,
            api_key: p.api_key.clone(),
            auth_mode: "api_key".into(),
            enabled: probed,
            use_proxy: false,
            transformer: p.transformer.clone(),
            model: pick_lock_model(&p.models_hint, &model_ids),
            models: model_ids.clone(),
            active_models: vec![],
            model_mappings: vec![],
            model_mappings_enabled: true,
            remark: p.remark.clone(),
            fast: false,
        };
        endpoint_repo::create(conn, &req)?;

        imported += 1;
        if probed {
            enabled_count += 1;
        } else {
            disabled_no_models += 1;
        }
        items.push(ImportItem {
            name,
            status: "imported".into(),
            model_count: model_ids.len(),
            enabled: probed,
            skip_reason: None,
        });
    }

    Ok(ImportSummary {
        total,
        imported,
        enabled_count,
        disabled_no_models,
        skipped,
        items,
    })
}

/// 构建迁移导入用的 HTTP client：默认直连，除非全局开启代理且地址非空。
pub fn build_import_client(conn: &Connection) -> AppResult<reqwest::Client> {
    let cfg = config_repo::get_config(conn)?;
    let want = should_use_proxy(false, cfg.proxy_enabled, &cfg.proxy_url);
    build_client(want, &cfg.proxy_url, Duration::from_secs(15))
}
