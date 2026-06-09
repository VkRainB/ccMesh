use std::collections::BTreeMap;

use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::backup::{ConfigBundle, CredentialItem, EndpointExport, ImportSummary};
use crate::modules::storage::{config_repo, endpoint_repo};

const BUNDLE_TYPE: &str = "ccmesh-config";
const BUNDLE_VERSION: u32 = 1;

/// 迁移用配置键：取 `SAFE_CONFIG_KEYS` 去掉 webdav_* 同步凭证（换机重填，避免明文外泄）。
const MIGRATION_CONFIG_KEYS: &[&str] = &[
    "port",
    "logLevel",
    "language",
    "theme",
    "themeAuto",
    "autoLightStart",
    "autoDarkStart",
    "closeWindowBehavior",
    "modelsCacheTtl",
    "update_autoCheck",
    "update_checkInterval",
    "openaiUa",
    "claudeCliUa",
];

fn read_credentials(conn: &Connection, endpoint_id: i64) -> AppResult<Vec<CredentialItem>> {
    let mut stmt = conn.prepare(
        "SELECT api_key, enabled, sort_order FROM endpoint_credentials
         WHERE endpoint_id = ?1 ORDER BY sort_order ASC, id ASC",
    )?;
    let rows = stmt.query_map([endpoint_id], |r| {
        Ok(CredentialItem {
            api_key: r.get(0)?,
            enabled: r.get::<_, i64>(1)? != 0,
            sort_order: r.get(2)?,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 构造配置迁移包：所有端点（全字段 + 多凭证）+ 白名单配置键。
pub fn build_config_bundle(conn: &Connection) -> AppResult<ConfigBundle> {
    let mut endpoints = Vec::new();
    for e in endpoint_repo::list_all(conn)? {
        let credentials = read_credentials(conn, e.id)?;
        endpoints.push(EndpointExport {
            name: e.name,
            api_url: e.api_url,
            api_key: e.api_key,
            auth_mode: e.auth_mode,
            enabled: e.enabled,
            use_proxy: e.use_proxy,
            transformer: e.transformer,
            model: e.model,
            models: e.models,
            remark: e.remark,
            sort_order: e.sort_order,
            credentials,
        });
    }
    let mut config = BTreeMap::new();
    for &k in MIGRATION_CONFIG_KEYS {
        if let Some(v) = config_repo::get_value(conn, k)? {
            config.insert(k.to_string(), v);
        }
    }
    Ok(ConfigBundle {
        kind: BUNDLE_TYPE.to_string(),
        version: BUNDLE_VERSION,
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        exported_at: chrono::Local::now().to_rfc3339(),
        endpoints,
        config,
    })
}

/// 导入配置迁移包。`overwrite` 为真时同名端点覆盖更新并重置凭证、配置键覆盖；否则跳过同名、配置键保留本地。
pub fn import_config_bundle(
    conn: &mut Connection,
    bundle: &ConfigBundle,
    overwrite: bool,
) -> AppResult<ImportSummary> {
    if bundle.kind != BUNDLE_TYPE {
        return Err(AppError::InvalidArgument(
            "文件类型不是 ccmesh-config 配置导出".to_string(),
        ));
    }
    if bundle.version > BUNDLE_VERSION {
        return Err(AppError::InvalidArgument(format!(
            "配置版本 {} 高于当前支持的 {}，请升级应用",
            bundle.version, BUNDLE_VERSION
        )));
    }

    let tx = conn.transaction()?;
    let mut s = ImportSummary::default();

    for ep in &bundle.endpoints {
        if ep.name.trim().is_empty() || ep.api_url.trim().is_empty() {
            continue;
        }
        let existing: Option<i64> = tx
            .query_row(
                "SELECT id FROM endpoints WHERE name = ?1",
                params![ep.name],
                |r| r.get(0),
            )
            .optional()?;

        let models_json = serde_json::to_string(&ep.models).unwrap_or_else(|_| "[]".to_string());
        let id = match existing {
            Some(id) if overwrite => {
                tx.execute(
                    "UPDATE endpoints SET api_url=?1, api_key=?2, auth_mode=?3, enabled=?4,
                        use_proxy=?5, transformer=?6, model=?7, models=?8, remark=?9,
                        sort_order=?10, updated_at=datetime('now') WHERE id=?11",
                    params![
                        ep.api_url,
                        ep.api_key,
                        ep.auth_mode,
                        ep.enabled as i64,
                        ep.use_proxy as i64,
                        ep.transformer,
                        ep.model,
                        models_json,
                        ep.remark,
                        ep.sort_order,
                        id,
                    ],
                )?;
                tx.execute(
                    "DELETE FROM endpoint_credentials WHERE endpoint_id=?1",
                    params![id],
                )?;
                s.endpoints_updated += 1;
                id
            }
            Some(_) => {
                s.endpoints_skipped += 1;
                continue;
            }
            None => {
                tx.execute(
                    "INSERT INTO endpoints
                        (name, api_url, api_key, auth_mode, enabled, use_proxy, transformer, model, models, remark, sort_order)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
                    params![
                        ep.name,
                        ep.api_url,
                        ep.api_key,
                        ep.auth_mode,
                        ep.enabled as i64,
                        ep.use_proxy as i64,
                        ep.transformer,
                        ep.model,
                        models_json,
                        ep.remark,
                        ep.sort_order,
                    ],
                )?;
                s.endpoints_added += 1;
                tx.last_insert_rowid()
            }
        };

        for c in &ep.credentials {
            tx.execute(
                "INSERT INTO endpoint_credentials(endpoint_id, api_key, enabled, sort_order)
                 VALUES(?1,?2,?3,?4)",
                params![id, c.api_key, c.enabled as i64, c.sort_order],
            )?;
            s.credentials += 1;
        }
    }

    for (k, v) in &bundle.config {
        if !MIGRATION_CONFIG_KEYS.contains(&k.as_str()) {
            continue; // 仅接受白名单键
        }
        let sql = if overwrite {
            "INSERT INTO app_config(key, value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        } else {
            "INSERT INTO app_config(key, value) VALUES(?1,?2) ON CONFLICT(key) DO NOTHING"
        };
        tx.execute(sql, params![k, v])?;
        s.config_keys += 1;
    }

    tx.commit()?;
    Ok(s)
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

    fn seed(conn: &Connection) {
        conn.execute(
            "INSERT INTO endpoints(name, api_url, api_key, enabled, use_proxy, transformer, model, models, remark)
             VALUES('ep1','https://a','k1',1,1,'openai','gpt', '[\"gpt\",\"o3\"]','r1')",
            [],
        )
        .unwrap();
        let id = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO endpoint_credentials(endpoint_id, api_key, enabled, sort_order) VALUES(?1,'cred-a',1,0)",
            params![id],
        )
        .unwrap();
        conn.execute("INSERT INTO app_config(key,value) VALUES('theme','dark')", [])
            .unwrap();
        conn.execute(
            "INSERT INTO app_config(key,value) VALUES('webdav_password','secret')",
            [],
        )
        .unwrap();
    }

    #[test]
    fn export_includes_endpoints_credentials_and_whitelist_only() {
        let c = db();
        seed(&c);
        let bundle = build_config_bundle(&c).unwrap();
        assert_eq!(bundle.kind, "ccmesh-config");
        assert_eq!(bundle.endpoints.len(), 1);
        let ep = &bundle.endpoints[0];
        assert_eq!(ep.models, vec!["gpt".to_string(), "o3".to_string()]);
        assert!(ep.use_proxy);
        assert_eq!(ep.credentials.len(), 1);
        assert_eq!(ep.credentials[0].api_key, "cred-a");
        assert_eq!(bundle.config.get("theme").map(String::as_str), Some("dark"));
        // webdav_password 被排除
        assert!(!bundle.config.contains_key("webdav_password"));
    }

    #[test]
    fn import_adds_then_skips_or_overwrites() {
        let src = db();
        seed(&src);
        let bundle = build_config_bundle(&src).unwrap();

        // 导入到空库：新增
        let mut dst = db();
        let s1 = import_config_bundle(&mut dst, &bundle, false).unwrap();
        assert_eq!(s1.endpoints_added, 1);
        assert_eq!(s1.credentials, 1);
        assert_eq!(s1.config_keys, 1); // 仅 theme

        // 再次非覆盖导入：跳过同名
        let s2 = import_config_bundle(&mut dst, &bundle, false).unwrap();
        assert_eq!(s2.endpoints_skipped, 1);
        assert_eq!(s2.endpoints_added, 0);

        // 覆盖导入：更新 + 重置凭证（仍为 1 条，不翻倍）
        let s3 = import_config_bundle(&mut dst, &bundle, true).unwrap();
        assert_eq!(s3.endpoints_updated, 1);
        let cred_count: i64 = dst
            .query_row("SELECT COUNT(*) FROM endpoint_credentials", [], |r| r.get(0))
            .unwrap();
        assert_eq!(cred_count, 1);
    }

    #[test]
    fn import_rejects_wrong_type() {
        let mut dst = db();
        let bad = ConfigBundle {
            kind: "something-else".to_string(),
            version: 1,
            app_version: "0".to_string(),
            exported_at: String::new(),
            endpoints: vec![],
            config: BTreeMap::new(),
        };
        assert!(import_config_bundle(&mut dst, &bad, false).is_err());
    }
}
