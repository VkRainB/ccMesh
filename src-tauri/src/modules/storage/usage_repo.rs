use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection};

use crate::error::AppResult;
use crate::models::usage::{DailyUsage, DayModelUsage, ModelUsage, UsageRecord, UsageSummary};

/// 读取文件上次同步的 mtime（纳秒）。无记录返回 0。
pub fn synced_mtime(conn: &Connection, file_path: &str) -> AppResult<i64> {
    let v: Option<i64> = conn
        .query_row(
            "SELECT mtime_ns FROM usage_sync_state WHERE file_path = ?1",
            params![file_path],
            |r| r.get(0),
        )
        .ok();
    Ok(v.unwrap_or(0))
}

/// 记录文件已同步到的 mtime（纳秒）。
pub fn set_synced_mtime(conn: &Connection, file_path: &str, mtime_ns: i64) -> AppResult<()> {
    conn.execute(
        "INSERT INTO usage_sync_state(file_path, mtime_ns) VALUES(?1, ?2)
         ON CONFLICT(file_path) DO UPDATE SET mtime_ns = excluded.mtime_ns",
        params![file_path, mtime_ns],
    )?;
    Ok(())
}

/// 插入一条用量记录（按 app_type+record_key 去重）。返回是否写入。
/// 冲突时仅回填缺失的 ts（v17 升级后首次全量重扫为旧行补时间戳，不动聚合值）。
pub fn insert_record(conn: &Connection, r: &UsageRecord) -> AppResult<bool> {
    let n = conn.execute(
        "INSERT INTO usage_records(
            app_type, record_key, date, model, requests,
            input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, ts)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(app_type, record_key) DO UPDATE SET ts = excluded.ts
             WHERE usage_records.ts IS NULL AND excluded.ts IS NOT NULL",
        params![
            r.app_type,
            r.record_key,
            r.date,
            r.model,
            r.requests,
            r.input_tokens,
            r.output_tokens,
            r.cache_creation_tokens,
            r.cache_read_tokens,
            r.ts,
        ],
    )?;
    Ok(n == 1)
}

/// 查询过滤条件：date 闭区间（预设周期）或 ts 毫秒闭区间（自定义时分范围），加可选 app_type。
#[derive(Debug, Clone, Copy, Default)]
pub struct UsageFilter<'a> {
    pub start: Option<&'a str>,
    pub end: Option<&'a str>,
    pub start_ts: Option<i64>,
    pub end_ts: Option<i64>,
    pub app_type: Option<&'a str>,
}

/// 构造可选过滤的 WHERE 子句与参数。
/// ts 过滤对 NULL 行退化为 date 天粒度比较（仅升级后源文件已删除的孤儿行会命中，
/// ponytail: 这些行按整天归属，无法精确到时分，可接受）。
fn build_filter(f: &UsageFilter<'_>) -> (String, Vec<SqlValue>) {
    let mut sql = String::from(" WHERE 1=1");
    let mut args: Vec<SqlValue> = Vec::new();
    if let Some(s) = f.start {
        sql.push_str(" AND date >= ?");
        args.push(SqlValue::Text(s.to_string()));
    }
    if let Some(e) = f.end {
        sql.push_str(" AND date <= ?");
        args.push(SqlValue::Text(e.to_string()));
    }
    if let Some(ts) = f.start_ts {
        sql.push_str(" AND (ts >= ? OR (ts IS NULL AND date >= date(?/1000, 'unixepoch', 'localtime')))");
        args.push(SqlValue::Integer(ts));
        args.push(SqlValue::Integer(ts));
    }
    if let Some(ts) = f.end_ts {
        sql.push_str(" AND (ts <= ? OR (ts IS NULL AND date <= date(?/1000, 'unixepoch', 'localtime')))");
        args.push(SqlValue::Integer(ts));
        args.push(SqlValue::Integer(ts));
    }
    if let Some(a) = f.app_type {
        if !a.is_empty() {
            sql.push_str(" AND app_type = ?");
            args.push(SqlValue::Text(a.to_string()));
        }
    }
    (sql, args)
}

pub fn summary(conn: &Connection, f: &UsageFilter<'_>) -> AppResult<UsageSummary> {
    let (where_sql, args) = build_filter(f);
    let sql = format!(
        "SELECT COALESCE(SUM(requests),0), COALESCE(SUM(input_tokens),0),
                COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_creation_tokens),0),
                COALESCE(SUM(cache_read_tokens),0)
         FROM usage_records{where_sql}"
    );
    let s = conn.query_row(&sql, params_from_iter(args.iter()), |r| {
        Ok(UsageSummary {
            total_requests: r.get(0)?,
            total_input_tokens: r.get(1)?,
            total_output_tokens: r.get(2)?,
            total_cache_creation_tokens: r.get(3)?,
            total_cache_read_tokens: r.get(4)?,
        })
    })?;
    Ok(s)
}

pub fn by_model(conn: &Connection, f: &UsageFilter<'_>) -> AppResult<Vec<ModelUsage>> {
    let (where_sql, args) = build_filter(f);
    let sql = format!(
        "SELECT app_type, model, SUM(requests), SUM(input_tokens), SUM(output_tokens),
                SUM(cache_creation_tokens), SUM(cache_read_tokens)
         FROM usage_records{where_sql}
         GROUP BY app_type, model
         ORDER BY SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), |r| {
        Ok(ModelUsage {
            app_type: r.get(0)?,
            model: r.get(1)?,
            requests: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
            input_tokens: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            output_tokens: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            cache_creation_tokens: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            cache_read_tokens: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn by_day(conn: &Connection, f: &UsageFilter<'_>) -> AppResult<Vec<DailyUsage>> {
    let (where_sql, args) = build_filter(f);
    let sql = format!(
        "SELECT date, app_type, SUM(requests), SUM(input_tokens), SUM(output_tokens),
                SUM(cache_creation_tokens), SUM(cache_read_tokens)
         FROM usage_records{where_sql}
         GROUP BY date, app_type
         ORDER BY date DESC, app_type"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), |r| {
        Ok(DailyUsage {
            date: r.get(0)?,
            app_type: r.get(1)?,
            requests: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
            input_tokens: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            output_tokens: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            cache_creation_tokens: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            cache_read_tokens: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

/// 按 (date, app_type, model) 三维聚合：date 倒序，组内按 token 合计降序。
/// 供用量统计「日期合并表」使用。
pub fn by_day_model(conn: &Connection, f: &UsageFilter<'_>) -> AppResult<Vec<DayModelUsage>> {
    let (where_sql, args) = build_filter(f);
    let sql = format!(
        "SELECT date, app_type, model, SUM(requests), SUM(input_tokens), SUM(output_tokens),
                SUM(cache_creation_tokens), SUM(cache_read_tokens)
         FROM usage_records{where_sql}
         GROUP BY date, app_type, model
         ORDER BY date DESC,
                  SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens) DESC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(args.iter()), |r| {
        Ok(DayModelUsage {
            date: r.get(0)?,
            app_type: r.get(1)?,
            model: r.get(2)?,
            requests: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            input_tokens: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
            output_tokens: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
            cache_creation_tokens: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
            cache_read_tokens: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
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

    fn rec(app: &str, key: &str, date: &str, model: &str, inp: i64, out: i64) -> UsageRecord {
        UsageRecord {
            app_type: app.to_string(),
            record_key: key.to_string(),
            date: date.to_string(),
            ts: None,
            model: model.to_string(),
            requests: 1,
            input_tokens: inp,
            output_tokens: out,
            cache_creation_tokens: 0,
            cache_read_tokens: 0,
        }
    }

    fn filter<'a>(
        start: Option<&'a str>,
        end: Option<&'a str>,
        app_type: Option<&'a str>,
    ) -> UsageFilter<'a> {
        UsageFilter {
            start,
            end,
            app_type,
            ..Default::default()
        }
    }

    #[test]
    fn insert_dedupes_by_key() {
        let c = db();
        assert!(insert_record(&c, &rec("claude", "m1", "2026-06-01", "x", 10, 5)).unwrap());
        // 同 key 第二次忽略
        assert!(!insert_record(&c, &rec("claude", "m1", "2026-06-01", "x", 10, 5)).unwrap());
        let s = summary(&c, &filter(None, None, None)).unwrap();
        assert_eq!(s.total_requests, 1);
        assert_eq!(s.total_input_tokens, 10);
    }

    #[test]
    fn conflict_backfills_missing_ts_without_touching_tokens() {
        let c = db();
        // 旧行无 ts
        insert_record(&c, &rec("claude", "m1", "2026-06-01", "x", 10, 5)).unwrap();
        // 重扫同 key 带 ts（token 值不同也不覆盖聚合列，仅回填 ts）
        let mut with_ts = rec("claude", "m1", "2026-06-01", "x", 999, 999);
        with_ts.ts = Some(1_780_000_000_000);
        insert_record(&c, &with_ts).unwrap();
        let (ts, inp): (Option<i64>, i64) = c
            .query_row(
                "SELECT ts, input_tokens FROM usage_records WHERE record_key='m1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(ts, Some(1_780_000_000_000));
        assert_eq!(inp, 10); // 聚合值保持首次导入
    }

    #[test]
    fn ts_filter_with_null_fallback() {
        let c = db();
        // 2026-06-02 本地 10:00 与 12:00 两条带 ts；一条同日无 ts 的孤儿行
        let day = chrono::NaiveDate::from_ymd_opt(2026, 6, 2).unwrap();
        let local_ms = |h: u32| {
            day.and_hms_opt(h, 0, 0)
                .unwrap()
                .and_local_timezone(chrono::Local)
                .unwrap()
                .timestamp_millis()
        };
        let mut a = rec("claude", "a", "2026-06-02", "x", 1, 0);
        a.ts = Some(local_ms(10));
        let mut b = rec("claude", "b", "2026-06-02", "x", 2, 0);
        b.ts = Some(local_ms(12));
        let orphan = rec("claude", "c", "2026-06-02", "x", 4, 0);
        for r in [&a, &b, &orphan] {
            insert_record(&c, r).unwrap();
        }
        // 11:00 起：精确排除 10:00 那条；NULL 行按天粒度兜底保留
        let f = UsageFilter {
            start_ts: Some(local_ms(11)),
            ..Default::default()
        };
        let s = summary(&c, &f).unwrap();
        assert_eq!(s.total_input_tokens, 2 + 4);
        // 全天区间：三条都在
        let f = UsageFilter {
            start_ts: Some(local_ms(0)),
            end_ts: Some(local_ms(23)),
            ..Default::default()
        };
        assert_eq!(summary(&c, &f).unwrap().total_input_tokens, 7);
    }

    #[test]
    fn summary_and_groupings_filter() {
        let c = db();
        insert_record(&c, &rec("claude", "m1", "2026-06-01", "opus", 10, 5)).unwrap();
        insert_record(&c, &rec("claude", "m2", "2026-06-02", "opus", 20, 8)).unwrap();
        insert_record(&c, &rec("codex", "c1", "2026-06-02", "gpt", 30, 9)).unwrap();

        let all = summary(&c, &filter(None, None, None)).unwrap();
        assert_eq!(all.total_requests, 3);
        assert_eq!(all.total_input_tokens, 60);

        let claude = summary(&c, &filter(None, None, Some("claude"))).unwrap();
        assert_eq!(claude.total_requests, 2);
        assert_eq!(claude.total_output_tokens, 13);

        let ranged = summary(&c, &filter(Some("2026-06-02"), Some("2026-06-02"), None)).unwrap();
        assert_eq!(ranged.total_requests, 2);

        let models = by_model(&c, &filter(None, None, None)).unwrap();
        assert_eq!(models.len(), 2); // opus(claude) + gpt(codex)
        let days = by_day(&c, &filter(None, None, None)).unwrap();
        assert_eq!(days.len(), 3); // (06-01,claude)(06-02,claude)(06-02,codex)
        assert_eq!(days[0].date, "2026-06-02"); // date 倒序
    }

    #[test]
    fn by_day_model_groups_and_orders() {
        let c = db();
        // 同 (date,app,model) 两条 → 累加；不同模型分行；日期倒序、组内 token 降序
        insert_record(&c, &rec("claude", "k1", "2026-06-08", "opus", 100, 200)).unwrap();
        insert_record(&c, &rec("claude", "k2", "2026-06-08", "opus", 11, 22)).unwrap();
        insert_record(&c, &rec("claude", "k3", "2026-06-08", "mimo", 5, 5)).unwrap();
        insert_record(&c, &rec("claude", "k4", "2026-06-07", "opus", 1, 1)).unwrap();

        let rows = by_day_model(&c, &filter(None, None, None)).unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].date, "2026-06-08");
        assert_eq!(rows[0].model, "opus"); // 组内 token 合计 333 > mimo 10
        assert_eq!(rows[0].requests, 2); // k1+k2 累加
        assert_eq!(rows[0].input_tokens, 111);
        assert_eq!(rows[1].model, "mimo");
        assert_eq!(rows[2].date, "2026-06-07"); // 日期倒序
    }

    #[test]
    fn sync_state_roundtrip() {
        let c = db();
        assert_eq!(synced_mtime(&c, "/a.jsonl").unwrap(), 0);
        set_synced_mtime(&c, "/a.jsonl", 12345).unwrap();
        assert_eq!(synced_mtime(&c, "/a.jsonl").unwrap(), 12345);
        set_synced_mtime(&c, "/a.jsonl", 99999).unwrap();
        assert_eq!(synced_mtime(&c, "/a.jsonl").unwrap(), 99999);
    }
}
