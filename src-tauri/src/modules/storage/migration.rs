use rusqlite::Connection;

use crate::error::AppResult;

/// 版本化迁移脚本。新增表/列时在末尾追加一条，`run_migrations` 会按当前版本幂等增量执行。
const MIGRATIONS: &[&str] = &[
    // v1：核心表 + 索引
    "CREATE TABLE IF NOT EXISTS endpoints (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        name         TEXT    NOT NULL UNIQUE,
        api_url      TEXT    NOT NULL,
        api_key      TEXT    NOT NULL DEFAULT '',
        auth_mode    TEXT    NOT NULL DEFAULT 'api_key',
        enabled      INTEGER NOT NULL DEFAULT 1,
        transformer  TEXT    NOT NULL DEFAULT 'claude',
        model        TEXT    NOT NULL DEFAULT '',
        remark       TEXT    NOT NULL DEFAULT '',
        sort_order   INTEGER NOT NULL DEFAULT 0,
        test_status  TEXT    NOT NULL DEFAULT 'unknown',
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS endpoint_credentials (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_id  INTEGER NOT NULL,
        api_key      TEXT    NOT NULL,
        enabled      INTEGER NOT NULL DEFAULT 1,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY(endpoint_id) REFERENCES endpoints(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_name TEXT    NOT NULL,
        date          TEXT    NOT NULL,
        requests      INTEGER NOT NULL DEFAULT 0,
        errors        INTEGER NOT NULL DEFAULT 0,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        device_id     TEXT    NOT NULL DEFAULT '',
        UNIQUE(endpoint_name, date, device_id)
    );
    CREATE INDEX IF NOT EXISTS idx_daily_stats_date     ON daily_stats(date);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_endpoint ON daily_stats(endpoint_name);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_device   ON daily_stats(device_id);

    CREATE TABLE IF NOT EXISTS credential_usage (
        id               INTEGER PRIMARY KEY AUTOINCREMENT,
        endpoint_name    TEXT    NOT NULL,
        credential_index INTEGER NOT NULL DEFAULT 0,
        date             TEXT    NOT NULL,
        requests         INTEGER NOT NULL DEFAULT 0,
        errors           INTEGER NOT NULL DEFAULT 0,
        input_tokens     INTEGER NOT NULL DEFAULT 0,
        output_tokens    INTEGER NOT NULL DEFAULT 0,
        device_id        TEXT    NOT NULL DEFAULT '',
        UNIQUE(endpoint_name, credential_index, date, device_id)
    );

    CREATE TABLE IF NOT EXISTS app_config (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
    // v2：端点一对多模型清单 + 端点级代理开关
    "ALTER TABLE endpoints ADD COLUMN models    TEXT    NOT NULL DEFAULT '[]';
     ALTER TABLE endpoints ADD COLUMN use_proxy INTEGER NOT NULL DEFAULT 0;",
    // v3：daily_stats 增加缓存创建/读取 token 列；新增逐条请求明细表 request_logs
    "ALTER TABLE daily_stats ADD COLUMN cache_creation_tokens INTEGER NOT NULL DEFAULT 0;
     ALTER TABLE daily_stats ADD COLUMN cache_read_tokens     INTEGER NOT NULL DEFAULT 0;

     CREATE TABLE IF NOT EXISTS request_logs (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        ts                    INTEGER NOT NULL,
        endpoint_name         TEXT    NOT NULL,
        inbound_format        TEXT    NOT NULL DEFAULT '',
        upstream_url          TEXT    NOT NULL DEFAULT '',
        status_code           INTEGER,
        is_error              INTEGER NOT NULL DEFAULT 0,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        model                 TEXT,
        duration_ms           INTEGER,
        device_id             TEXT    NOT NULL DEFAULT ''
     );
     CREATE INDEX IF NOT EXISTS idx_request_logs_ts       ON request_logs(ts);
     CREATE INDEX IF NOT EXISTS idx_request_logs_endpoint ON request_logs(endpoint_name);",
    // v4：本机用量统计（Claude Code / Codex 会话 JSONL 增量同步）
    "CREATE TABLE IF NOT EXISTS usage_records (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        app_type              TEXT    NOT NULL,
        record_key            TEXT    NOT NULL,
        date                  TEXT    NOT NULL,
        model                 TEXT    NOT NULL DEFAULT '',
        requests              INTEGER NOT NULL DEFAULT 0,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        UNIQUE(app_type, record_key)
     );
     CREATE INDEX IF NOT EXISTS idx_usage_records_date ON usage_records(date);
     CREATE INDEX IF NOT EXISTS idx_usage_records_app  ON usage_records(app_type);

     CREATE TABLE IF NOT EXISTS usage_sync_state (
        file_path TEXT PRIMARY KEY,
        mtime_ns  INTEGER NOT NULL
     );",
    // v5：request_logs 记录真实入站/出站路由路径（监控"入站/出站"列展示用）。
    // 旧行默认空串，前端按 inbound_format 协议推断兜底。
    "ALTER TABLE request_logs ADD COLUMN inbound_path  TEXT NOT NULL DEFAULT '';
     ALTER TABLE request_logs ADD COLUMN upstream_path TEXT NOT NULL DEFAULT '';",
    // v6：request_logs 记录首字节延迟（首字）。流式取首个内容分片到达耗时，缓冲取响应头到达。
    // 旧行 / 无数据为 NULL，前端显示 —。
    "ALTER TABLE request_logs ADD COLUMN first_byte_ms INTEGER;",
    // v7：端点入站→出站模型映射（JSON 数组 [{from,to}]）。旧行默认空数组。
    "ALTER TABLE endpoints ADD COLUMN model_mappings TEXT NOT NULL DEFAULT '[]';",
];

/// 幂等执行迁移：读取 `schema_version` 当前版本，仅应用尚未执行的脚本。
pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_version (
            version    INTEGER NOT NULL,
            applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
        );",
    )?;

    let current: i64 = conn.query_row(
        "SELECT COALESCE(MAX(version), 0) FROM schema_version",
        [],
        |row| row.get(0),
    )?;

    for (idx, script) in MIGRATIONS.iter().enumerate() {
        let version = (idx + 1) as i64;
        if version > current {
            conn.execute_batch(script)?;
            conn.execute("INSERT INTO schema_version(version) VALUES (?1)", [version])?;
            tracing::info!(version, "已应用数据库迁移");
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrations_are_idempotent() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        run_migrations(&c).unwrap(); // 第二次为空操作
        let version: i64 = c
            .query_row("SELECT MAX(version) FROM schema_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(version, MIGRATIONS.len() as i64);
        // 关键表存在
        let n: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('endpoints','daily_stats','app_config')",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 3);
    }

    #[test]
    fn v2_adds_models_and_use_proxy_columns() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        let cols: Vec<String> = {
            let mut stmt = c.prepare("PRAGMA table_info(endpoints)").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
            rows.filter_map(Result::ok).collect()
        };
        assert!(cols.contains(&"models".to_string()));
        assert!(cols.contains(&"use_proxy".to_string()));
    }

    #[test]
    fn v3_adds_cache_columns_and_request_logs() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        let daily_cols: Vec<String> = {
            let mut stmt = c.prepare("PRAGMA table_info(daily_stats)").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
            rows.filter_map(Result::ok).collect()
        };
        assert!(daily_cols.contains(&"cache_creation_tokens".to_string()));
        assert!(daily_cols.contains(&"cache_read_tokens".to_string()));
        let has_table: i64 = c
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='request_logs'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(has_table, 1);
    }

    #[test]
    fn v5_adds_request_log_path_columns() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        let cols: Vec<String> = {
            let mut stmt = c.prepare("PRAGMA table_info(request_logs)").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
            rows.filter_map(Result::ok).collect()
        };
        assert!(cols.contains(&"inbound_path".to_string()));
        assert!(cols.contains(&"upstream_path".to_string()));
    }

    #[test]
    fn v6_adds_first_byte_ms_column() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        let cols: Vec<String> = {
            let mut stmt = c.prepare("PRAGMA table_info(request_logs)").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
            rows.filter_map(Result::ok).collect()
        };
        assert!(cols.contains(&"first_byte_ms".to_string()));
    }

    #[test]
    fn v7_adds_model_mappings_column() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        let cols: Vec<String> = {
            let mut stmt = c.prepare("PRAGMA table_info(endpoints)").unwrap();
            let rows = stmt.query_map([], |r| r.get::<_, String>(1)).unwrap();
            rows.filter_map(Result::ok).collect()
        };
        assert!(cols.contains(&"model_mappings".to_string()));
    }
}
