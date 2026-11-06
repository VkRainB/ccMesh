use std::collections::BTreeMap;
use std::str::FromStr;

use rusqlite::{params, Connection, OptionalExtension};
use rust_decimal::Decimal;

use crate::error::{AppError, AppResult};
use crate::models::stats::{DailyStat, EndpointStat, PeriodStats};

fn decimal(value: &str) -> AppResult<Decimal> {
    Decimal::from_str(value).map_err(|e| AppError::Db(format!("无效的已计价金额: {e}")))
}

fn add_cost(total: Decimal, value: Decimal) -> AppResult<Decimal> {
    total.checked_add(value).ok_or_else(|| AppError::Db("已计价金额累计溢出".into()))
}

/// 累加写入一行（UPSERT，按 endpoint_name+date+device_id 累加）。
pub fn upsert(
    conn: &Connection,
    endpoint_name: &str,
    date: &str,
    device_id: &str,
    requests: i64,
    errors: i64,
    input_tokens: i64,
    output_tokens: i64,
    cache_creation_tokens: i64,
    cache_read_tokens: i64,
    priced_cost: Decimal,
    priced_requests: i64,
    unpriced_requests: i64,
) -> AppResult<()> {
    // 调用方持有写事务，读取旧金额后用 Decimal 累计，禁止 SQLite 对 TEXT 做浮点运算。
    let old: Option<String> = conn.query_row(
        "SELECT priced_cost FROM daily_stats WHERE endpoint_name=?1 AND date=?2 AND device_id=?3",
        params![endpoint_name, date, device_id], |r| r.get(0),
    ).optional()?;
    let total = add_cost(old.as_deref().map(decimal).transpose()?.unwrap_or(Decimal::ZERO), priced_cost)?;
    conn.execute(
        "INSERT INTO daily_stats(endpoint_name,date,requests,errors,input_tokens,output_tokens,cache_creation_tokens,cache_read_tokens,device_id,priced_cost,priced_requests,unpriced_requests)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(endpoint_name,date,device_id) DO UPDATE SET
            requests              = requests + excluded.requests,
            errors                = errors + excluded.errors,
            input_tokens          = input_tokens + excluded.input_tokens,
            output_tokens         = output_tokens + excluded.output_tokens,
            cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
            cache_read_tokens     = cache_read_tokens + excluded.cache_read_tokens,
            priced_cost           = excluded.priced_cost,
            priced_requests       = priced_requests + excluded.priced_requests,
            unpriced_requests     = unpriced_requests + excluded.unpriced_requests",
        params![endpoint_name, date, requests, errors, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, device_id, total.normalize().to_string(), priced_requests, unpriced_requests],
    )?;
    Ok(())
}

/// 聚合某日期范围（闭区间）内每端点统计 + 周期总量。
pub fn period_stats(conn: &Connection, start: &str, end: &str) -> AppResult<PeriodStats> {
    let mut stmt = conn.prepare(
        "SELECT endpoint_name, date, requests, errors, input_tokens, output_tokens,
                cache_creation_tokens, cache_read_tokens, priced_cost, priced_requests, unpriced_requests
         FROM daily_stats WHERE date >= ?1 AND date <= ?2",
    )?;
    let rows = stmt.query_map(params![start, end], row_to_daily)?;
    let mut endpoints: BTreeMap<String, (EndpointStat, Decimal)> = BTreeMap::new();
    for row in rows {
        let row = row?;
        let (e, cost) = endpoints.entry(row.endpoint_name).or_default();
        e.requests += row.requests;
        e.errors += row.errors;
        e.input_tokens += row.input_tokens;
        e.output_tokens += row.output_tokens;
        e.cache_creation_tokens += row.cache_creation_tokens;
        e.cache_read_tokens += row.cache_read_tokens;
        e.priced_requests += row.priced_requests;
        e.unpriced_requests += row.unpriced_requests;
        *cost = add_cost(*cost, decimal(&row.priced_cost)?)?;
    }
    let mut ps = PeriodStats::default();
    let mut total_cost = Decimal::ZERO;
    for (name, (mut e, cost)) in endpoints {
        e.endpoint_name = name;
        e.priced_cost = cost.normalize().to_string();
        ps.requests += e.requests;
        ps.errors += e.errors;
        ps.input_tokens += e.input_tokens;
        ps.output_tokens += e.output_tokens;
        ps.cache_creation_tokens += e.cache_creation_tokens;
        ps.cache_read_tokens += e.cache_read_tokens;
        ps.priced_requests += e.priced_requests;
        ps.unpriced_requests += e.unpriced_requests;
        total_cost = add_cost(total_cost, cost)?;
        ps.endpoints.push(e);
    }
    ps.priced_cost = total_cost.normalize().to_string();
    Ok(ps)
}

/// 行映射：daily_stats 聚合行 → DailyStat。
fn row_to_daily(r: &rusqlite::Row) -> rusqlite::Result<DailyStat> {
    Ok(DailyStat {
        endpoint_name: r.get(0)?,
        date: r.get(1)?,
        requests: r.get::<_, Option<i64>>(2)?.unwrap_or(0),
        errors: r.get::<_, Option<i64>>(3)?.unwrap_or(0),
        input_tokens: r.get::<_, Option<i64>>(4)?.unwrap_or(0),
        output_tokens: r.get::<_, Option<i64>>(5)?.unwrap_or(0),
        cache_creation_tokens: r.get::<_, Option<i64>>(6)?.unwrap_or(0),
        cache_read_tokens: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
        priced_cost: r.get(8)?,
        priced_requests: r.get(9)?,
        unpriced_requests: r.get(10)?,
    })
}

/// 跨全时间分页历史明细（按端点×日聚合行，date 倒序）。返回 (当前页, 分组总数)。
pub fn history_page(
    conn: &Connection,
    limit: i64,
    offset: i64,
) -> AppResult<(Vec<DailyStat>, i64)> {
    let total: i64 = conn.query_row(
        "SELECT COUNT(*) FROM (SELECT 1 FROM daily_stats GROUP BY endpoint_name, date)",
        [],
        |r| r.get(0),
    )?;
    let mut stmt = conn.prepare(
        "WITH page AS (
            SELECT endpoint_name,date FROM daily_stats GROUP BY endpoint_name,date
            ORDER BY date DESC,endpoint_name LIMIT ?1 OFFSET ?2
         )
         SELECT d.endpoint_name,d.date,d.requests,d.errors,d.input_tokens,d.output_tokens,
                d.cache_creation_tokens,d.cache_read_tokens,d.priced_cost,d.priced_requests,d.unpriced_requests
         FROM daily_stats d JOIN page p ON p.endpoint_name=d.endpoint_name AND p.date=d.date
         ORDER BY d.date DESC,d.endpoint_name",
    )?;
    let rows = stmt.query_map(params![limit, offset], row_to_daily)?;
    let mut groups: Vec<(DailyStat, Decimal)> = Vec::new();
    for row in rows {
        let row = row?;
        let cost = decimal(&row.priced_cost)?;
        if let Some((last, total_cost)) = groups.last_mut().filter(|(last, _)| {
            last.endpoint_name == row.endpoint_name && last.date == row.date
        }) {
            last.requests += row.requests;
            last.errors += row.errors;
            last.input_tokens += row.input_tokens;
            last.output_tokens += row.output_tokens;
            last.cache_creation_tokens += row.cache_creation_tokens;
            last.cache_read_tokens += row.cache_read_tokens;
            last.priced_requests += row.priced_requests;
            last.unpriced_requests += row.unpriced_requests;
            *total_cost = add_cost(*total_cost, cost)?;
        } else {
            groups.push((row, cost));
        }
    }
    let items = groups.into_iter().map(|(mut row, cost)| {
        row.priced_cost = cost.normalize().to_string();
        row
    }).collect();
    Ok((items, total))
}

/// 删除单端点单日的统计行。返回删除行数。
pub fn delete_row(conn: &Connection, endpoint_name: &str, date: &str) -> AppResult<usize> {
    let n = conn.execute(
        "DELETE FROM daily_stats WHERE endpoint_name = ?1 AND date = ?2",
        params![endpoint_name, date],
    )?;
    Ok(n)
}

/// 删除某一天全部端点的统计行。返回删除行数。
pub fn delete_by_date(conn: &Connection, date: &str) -> AppResult<usize> {
    let n = conn.execute("DELETE FROM daily_stats WHERE date = ?1", params![date])?;
    Ok(n)
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

    #[test]
    fn upsert_accumulates_and_period_sums() {
        let c = db();
        upsert(&c, "ep", "2026-06-05", "dev", 1, 0, 10, 5, 2, 3, decimal("0.1").unwrap(), 1, 0).unwrap();
        upsert(&c, "ep", "2026-06-05", "dev", 2, 1, 20, 10, 4, 6, decimal("0.2").unwrap(), 1, 1).unwrap();
        let ps = period_stats(&c, "2026-06-05", "2026-06-05").unwrap();
        assert_eq!(ps.requests, 3);
        assert_eq!(ps.errors, 1);
        assert_eq!(ps.input_tokens, 30);
        assert_eq!(ps.output_tokens, 15);
        assert_eq!(ps.cache_creation_tokens, 6);
        assert_eq!(ps.cache_read_tokens, 9);
        assert_eq!(ps.endpoints.len(), 1);
        assert_eq!(ps.priced_cost, "0.3");
        assert_eq!((ps.priced_requests, ps.unpriced_requests), (2, 1));
    }

    #[test]
    fn money_sums_across_days_and_devices_without_float_rounding() {
        let c = db();
        let large = decimal("9007199254740993.000000000001").unwrap();
        let tiny = decimal("0.000000000002").unwrap();
        upsert(&c, "a", "2026-06-01", "first", 1, 0, 0, 0, 0, 0, large, 1, 0).unwrap();
        upsert(&c, "a", "2026-06-01", "second", 1, 0, 0, 0, 0, 0, tiny, 1, 0).unwrap();
        upsert(&c, "a", "2026-06-02", "first", 1, 0, 0, 0, 0, 0, tiny, 1, 0).unwrap();
        let period = period_stats(&c, "2026-06-01", "2026-06-02").unwrap();
        assert_eq!(period.priced_cost, "9007199254740993.000000000005");
        assert_eq!(period.endpoints[0].priced_cost, period.priced_cost);
        assert_eq!(period.priced_requests, 3);
        let (rows, total) = history_page(&c, 1, 1).unwrap();
        assert_eq!(total, 2);
        assert_eq!(rows[0].date, "2026-06-01");
        assert_eq!(rows[0].priced_cost, "9007199254740993.000000000003");
        assert_eq!(rows[0].priced_requests, 2);
        assert_eq!(period_stats(&c, "2020-01-01", "2020-01-01").unwrap().priced_cost, "0");
    }

    #[test]
    fn history_paginates_and_row_delete() {
        let c = db();
        upsert(&c, "a", "2026-06-01", "dev", 1, 0, 0, 0, 0, 0, Decimal::ZERO, 0, 1).unwrap();
        upsert(&c, "b", "2026-06-02", "dev", 1, 0, 0, 0, 0, 0, Decimal::ZERO, 0, 1).unwrap();
        upsert(&c, "a", "2026-06-03", "dev", 1, 0, 0, 0, 0, 0, Decimal::ZERO, 0, 1).unwrap();
        let (page1, total) = history_page(&c, 2, 0).unwrap();
        assert_eq!(total, 3);
        assert_eq!(page1.len(), 2);
        assert_eq!(page1[0].date, "2026-06-03"); // date 倒序
        assert_eq!(delete_row(&c, "a", "2026-06-03").unwrap(), 1);
        assert_eq!(history_page(&c, 50, 0).unwrap().1, 2);
        assert_eq!(delete_by_date(&c, "2026-06-02").unwrap(), 1);
        assert_eq!(history_page(&c, 50, 0).unwrap().1, 1);
    }
}
