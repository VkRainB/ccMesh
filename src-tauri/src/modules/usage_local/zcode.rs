use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use crate::models::usage::UsageRecord;

/// ZCode 应用用量数据库默认路径：<home>/.zcode/cli/db/db.sqlite
///
/// ZCode 源码用 `path.join(os.homedir(), ".zcode", "cli", "db", "db.sqlite")` 唯一生成，
/// 无平台分支（见 docs/ZCode使用统计数据存储与读取分析.md §2.1）。
pub fn default_db_path(home: &Path) -> PathBuf {
    home.join(".zcode").join("cli").join("db").join("db.sqlite")
}

/// 只读读取 ZCode `model_usage` 表，转为 `UsageRecord` 列表。
///
/// db 不存在或不可读 → 返回空 Vec（用户可能未安装 ZCode，不视为错误）。
/// 只读连接 + busy_timeout：ZCode 运行中也可安全读，WAL 已提交数据可见。
pub fn read_records(db_path: &Path) -> Vec<UsageRecord> {
    if !db_path.exists() {
        return Vec::new();
    }
    let conn = match Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, db = %db_path.display(), "打开 ZCode 用量数据库失败");
            return Vec::new();
        }
    };
    if conn.busy_timeout(Duration::from_secs(2)).is_err() {
        // ponytail: 忽略 busy_timeout 设置失败，查询阶段仍可能成功
    }
    read_from_conn(&conn)
}

fn read_from_conn(conn: &Connection) -> Vec<UsageRecord> {
    // 字段映射见 docs/ZCode使用统计功能设计.md §4。
    // 不过滤 status：error/cancelled 通常 token 为 0，由下方的零值跳过处理。
    let sql = "SELECT id, model_id, started_at, input_tokens, output_tokens,
                      cache_creation_input_tokens, cache_read_input_tokens
               FROM model_usage";
    let Ok(mut stmt) = conn.prepare(sql) else {
        return Vec::new();
    };
    let rows = match stmt.query_map([], |r| {
        let id: String = r.get(0)?;
        let model: String = r.get::<_, Option<String>>(1)?.unwrap_or_default();
        let started_at: i64 = r.get(2)?;
        let input: i64 = r.get(3)?;
        let output: i64 = r.get(4)?;
        let cache_create: i64 = r.get(5)?;
        let cache_read: i64 = r.get(6)?;
        Ok((id, model, started_at, input, output, cache_create, cache_read))
    }) {
        Ok(rows) => rows,
        Err(e) => {
            tracing::warn!(error = %e, "查询 ZCode model_usage 失败");
            return Vec::new();
        }
    };
    let mut out = Vec::new();
    for row in rows.flatten() {
        let (id, model, started_at, input, output, cache_create, cache_read) = row;
        if input == 0 && output == 0 && cache_create == 0 && cache_read == 0 {
            continue; // 跳过零 token 行（error/cancelled），与 claude.rs 语义一致
        }
        out.push(UsageRecord {
            app_type: "zcode".to_string(),
            record_key: format!("zcode:{id}"),
            date: local_date_from_ms(started_at),
            ts: Some(started_at),
            model,
            requests: 1,
            input_tokens: input,
            output_tokens: output,
            cache_creation_tokens: cache_create,
            cache_read_tokens: cache_read,
        });
    }
    out
}

/// Unix 毫秒 → 本地日期 `YYYY-MM-DD`。解析失败回退 `"unknown"`。
fn local_date_from_ms(ms: i64) -> String {
    use chrono::TimeZone;
    let secs = ms.div_euclid(1000);
    let nanos = ((ms.rem_euclid(1000)) * 1_000_000) as u32;
    chrono::Local
        .timestamp_opt(secs, nanos)
        .single()
        .map(|t| t.format("%Y-%m-%d").to_string())
        .unwrap_or_else(|| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mock_schema(conn: &Connection) {
        conn.execute_batch(
            "CREATE TABLE model_usage (
               id TEXT, model_id TEXT, started_at INTEGER,
               input_tokens INTEGER, output_tokens INTEGER,
               cache_creation_input_tokens INTEGER, cache_read_input_tokens INTEGER)",
        )
        .unwrap();
    }

    #[test]
    fn maps_rows_and_skips_zero_tokens() {
        let c = Connection::open_in_memory().unwrap();
        mock_schema(&c);
        c.execute(
            "INSERT INTO model_usage VALUES ('a','GLM-5.3-Flash',1788232572895,100,50,0,30)",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO model_usage VALUES ('b','gpt-5-5',1788232572895,0,0,0,0)",
            [],
        )
        .unwrap();
        let recs = read_from_conn(&c);
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r.app_type, "zcode");
        assert_eq!(r.record_key, "zcode:a");
        assert_eq!(r.model, "GLM-5.3-Flash");
        assert_eq!(r.input_tokens, 100);
        assert_eq!(r.output_tokens, 50);
        assert_eq!(r.cache_read_tokens, 30);
        assert_eq!(r.requests, 1);
        assert_eq!(r.ts, Some(1788232572895));
        assert_eq!(r.date.len(), 10); // YYYY-MM-DD
    }

    #[test]
    fn missing_db_returns_empty() {
        let p = Path::new("/nope/does-not-exist.sqlite");
        assert!(read_records(p).is_empty());
    }

    #[test]
    fn default_db_path_joins_home() {
        let p = default_db_path(Path::new("/home/me"));
        assert_eq!(
            p,
            Path::new("/home/me/.zcode/cli/db/db.sqlite")
        );
    }
}
