use std::path::Path;

use rusqlite::{params_from_iter, Connection};

use crate::error::AppResult;
use crate::modules::storage::config_repo::SAFE_CONFIG_KEYS;

fn sql_quote(path: &Path) -> String {
    path.to_string_lossy().replace('\'', "''")
}

fn placeholders(n: usize) -> String {
    vec!["?"; n].join(",")
}

/// 生成可上传的数据库副本：VACUUM INTO 临时文件，剔除设备特定配置与统计数据。
pub fn create_backup_copy(conn: &Connection, temp_path: &Path) -> AppResult<()> {
    if temp_path.exists() {
        let _ = std::fs::remove_file(temp_path);
    }
    conn.execute_batch(&format!("VACUUM INTO '{}'", sql_quote(temp_path)))?;

    let backup = Connection::open(temp_path)?;
    backup.execute(
        &format!(
            "DELETE FROM app_config WHERE key NOT IN ({})",
            placeholders(SAFE_CONFIG_KEYS.len())
        ),
        params_from_iter(SAFE_CONFIG_KEYS.iter()),
    )?;
    // ponytail: 统计不同步；云端体积与隐私一并收口。request_logs/usage 恢复本就不写，上传仍保留。
    backup.execute("DELETE FROM daily_stats", [])?;
    Ok(())
}

/// 将备份库 ATTACH 后合并到本地：
/// - app_config：仅安全键；overwrite=REPLACE / keep=IGNORE
/// - endpoints：按 name，含模型清单/点亮/映射等完整配置字段
pub fn merge_from_backup(
    conn: &mut Connection,
    backup_path: &Path,
    overwrite: bool,
) -> AppResult<()> {
    conn.execute_batch(&format!(
        "ATTACH DATABASE '{}' AS backup",
        sql_quote(backup_path)
    ))?;

    let result = (|| -> AppResult<()> {
        let mode = if overwrite { "OR REPLACE" } else { "OR IGNORE" };
        let tx = conn.transaction()?;

        tx.execute(
            &format!(
                "INSERT {mode} INTO app_config(key, value)
                 SELECT key, value FROM backup.app_config WHERE key IN ({})",
                placeholders(SAFE_CONFIG_KEYS.len())
            ),
            params_from_iter(SAFE_CONFIG_KEYS.iter()),
        )?;

        // 旧备份缺列时 SELECT 会失败——需用当前版本重新上传后再恢复。
        tx.execute(
            &format!(
                "INSERT {mode} INTO endpoints
                    (name, api_url, api_key, auth_mode, enabled, use_proxy, transformer,
                     model, models, active_models, model_mappings, model_mappings_enabled, remark,
                     sort_order, fast, fast_sort_order, test_status, archived)
                 SELECT name, api_url, api_key, auth_mode, enabled, use_proxy, transformer,
                     model, models, active_models, model_mappings, model_mappings_enabled, remark,
                     sort_order, fast, fast_sort_order, test_status, archived
                 FROM backup.endpoints"
            ),
            [],
        )?;

        tx.commit()?;
        Ok(())
    })();

    let _ = conn.execute_batch("DETACH DATABASE backup");
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::storage::migration::run_migrations;
    use rusqlite::Connection;

    #[test]
    fn backup_strips_device_config_and_stats_merge_endpoints_full() {
        let dir = std::env::temp_dir();
        let pid = std::process::id();
        let src_path = dir.join(format!("ccx_src_{pid}.db"));
        let bk_path = dir.join(format!("ccx_bk_{pid}.db"));
        let tgt_path = dir.join(format!("ccx_tgt_{pid}.db"));
        for p in [&src_path, &bk_path, &tgt_path] {
            let _ = std::fs::remove_file(p);
        }

        let src = Connection::open(&src_path).unwrap();
        run_migrations(&src).unwrap();
        src.execute(
            "INSERT INTO app_config(key,value) VALUES('theme','dark'),('device_id','SRC')",
            [],
        )
        .unwrap();
        src.execute(
            "INSERT INTO daily_stats(endpoint_name,date,requests,errors,input_tokens,output_tokens,device_id)
             VALUES('ep','2026-06-05',5,0,0,0,'SRC')",
            [],
        )
        .unwrap();
        src.execute(
            "INSERT INTO endpoints
                (name, api_url, api_key, auth_mode, enabled, use_proxy, transformer,
                 model, models, active_models, model_mappings, model_mappings_enabled, remark,
                 sort_order, fast, fast_sort_order, test_status, archived)
             VALUES ('ep','https://x','k','api_key',1,1,'claude',
                 '','[\"a\",\"b\"]','[\"a\"]','[{\"from\":\"x\",\"to\":\"a\"}]',0,'r',
                 0,1,0,'ok',0)",
            [],
        )
        .unwrap();

        create_backup_copy(&src, &bk_path).unwrap();

        let bk = Connection::open(&bk_path).unwrap();
        let theme: Option<String> = bk
            .query_row("SELECT value FROM app_config WHERE key='theme'", [], |r| {
                r.get(0)
            })
            .ok();
        assert_eq!(theme.as_deref(), Some("dark"));
        let dev: Option<String> = bk
            .query_row(
                "SELECT value FROM app_config WHERE key='device_id'",
                [],
                |r| r.get(0),
            )
            .ok();
        assert!(dev.is_none());
        let stats: i64 = bk
            .query_row("SELECT COUNT(*) FROM daily_stats", [], |r| r.get(0))
            .unwrap();
        assert_eq!(stats, 0);
        drop(bk);

        let mut tgt = Connection::open(&tgt_path).unwrap();
        run_migrations(&tgt).unwrap();
        // 本地已有同名端点（缺模型字段）与本地统计，恢复后统计应保留、端点应被补齐
        tgt.execute(
            "INSERT INTO endpoints (name, api_url, api_key) VALUES ('ep','https://old','old')",
            [],
        )
        .unwrap();
        tgt.execute(
            "INSERT INTO daily_stats(endpoint_name,date,requests,errors,input_tokens,output_tokens,device_id)
             VALUES('ep','2026-06-05',9,0,0,0,'LOCAL')",
            [],
        )
        .unwrap();

        merge_from_backup(&mut tgt, &bk_path, true).unwrap();

        let (models, active, mappings, mappings_enabled, use_proxy, fast): (
            String,
            String,
            String,
            i64,
            i64,
            i64,
        ) = tgt
            .query_row(
                "SELECT models, active_models, model_mappings, model_mappings_enabled, use_proxy, fast
                 FROM endpoints WHERE name='ep'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)),
            )
            .unwrap();
        assert_eq!(models, r#"["a","b"]"#);
        assert_eq!(active, r#"["a"]"#);
        assert!(mappings.contains("\"from\":\"x\""));
        assert_eq!(mappings_enabled, 0);
        assert_eq!(use_proxy, 1);
        assert_eq!(fast, 1);

        let local_stats: i64 = tgt
            .query_row(
                "SELECT requests FROM daily_stats WHERE endpoint_name='ep'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(local_stats, 9);

        let theme: String = tgt
            .query_row("SELECT value FROM app_config WHERE key='theme'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(theme, "dark");

        drop(tgt);
        for p in [&src_path, &bk_path, &tgt_path] {
            let _ = std::fs::remove_file(p);
        }
    }
}
