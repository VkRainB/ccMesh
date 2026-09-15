use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppResult;
use crate::models::cursor_usage::{CursorUsageEventRow, CursorUsageSnapshot};

pub fn upsert_events(conn: &Connection, rows: &[CursorUsageEventRow]) -> AppResult<i64> {
    let mut n = 0i64;
    let mut stmt = conn.prepare(
        "INSERT INTO cursor_usage_events(
            event_key, ts, date, hour, model, kind, chargeable,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
         ON CONFLICT(event_key) DO UPDATE SET
            ts=excluded.ts, date=excluded.date, hour=excluded.hour, model=excluded.model,
            kind=excluded.kind, chargeable=excluded.chargeable,
            input_tokens=excluded.input_tokens, output_tokens=excluded.output_tokens,
            cache_read_tokens=excluded.cache_read_tokens, cache_write_tokens=excluded.cache_write_tokens,
            cost_cents=excluded.cost_cents",
    )?;
    for r in rows {
        stmt.execute(params![
            r.event_key,
            r.ts,
            r.date,
            r.hour,
            r.model,
            r.kind,
            if r.chargeable { 1 } else { 0 },
            r.input_tokens,
            r.output_tokens,
            r.cache_read_tokens,
            r.cache_write_tokens,
            r.cost_cents,
        ])?;
        n += 1;
    }
    Ok(n)
}

pub fn max_ts(conn: &Connection) -> AppResult<Option<i64>> {
    let v: Option<i64> =
        conn.query_row("SELECT MAX(ts) FROM cursor_usage_events", [], |r| r.get(0))?;
    Ok(v)
}

fn map_row(r: &rusqlite::Row<'_>) -> rusqlite::Result<CursorUsageEventRow> {
    Ok(CursorUsageEventRow {
        event_key: r.get(0)?,
        ts: r.get(1)?,
        date: r.get(2)?,
        hour: r.get(3)?,
        model: r.get(4)?,
        kind: r.get(5)?,
        chargeable: r.get::<_, i64>(6)? != 0,
        input_tokens: r.get::<_, Option<i64>>(7)?.unwrap_or(0),
        output_tokens: r.get::<_, Option<i64>>(8)?.unwrap_or(0),
        cache_read_tokens: r.get::<_, Option<i64>>(9)?.unwrap_or(0),
        cache_write_tokens: r.get::<_, Option<i64>>(10)?.unwrap_or(0),
        cost_cents: r.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
    })
}

const SELECT_COLS: &str = "event_key, ts, date, hour, model, kind, chargeable,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents";

pub fn events_in_range(
    conn: &Connection,
    start_ms: i64,
    end_ms: i64,
) -> AppResult<Vec<CursorUsageEventRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM cursor_usage_events WHERE ts >= ?1 AND ts <= ?2 ORDER BY ts"
    ))?;
    let rows = stmt.query_map(params![start_ms, end_ms], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn recent(conn: &Connection, limit: i64) -> AppResult<Vec<CursorUsageEventRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {SELECT_COLS} FROM cursor_usage_events ORDER BY ts DESC LIMIT ?1"
    ))?;
    let rows = stmt.query_map(params![limit], map_row)?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn save_snapshot(conn: &Connection, snap: &CursorUsageSnapshot) -> AppResult<()> {
    let json = serde_json::to_string(snap)?;
    conn.execute(
        "INSERT INTO cursor_usage_snapshot(id, json, fetched_at) VALUES(1, ?1, ?2)
         ON CONFLICT(id) DO UPDATE SET json=excluded.json, fetched_at=excluded.fetched_at",
        params![json, snap.fetched_at],
    )?;
    Ok(())
}

pub fn load_snapshot(conn: &Connection) -> AppResult<Option<CursorUsageSnapshot>> {
    let json: Option<String> = conn
        .query_row(
            "SELECT json FROM cursor_usage_snapshot WHERE id=1",
            [],
            |r| r.get(0),
        )
        .optional()?;
    match json {
        Some(s) => Ok(Some(serde_json::from_str(&s)?)),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::storage::migration::run_migrations;

    fn sample(key: &str, ts: i64) -> CursorUsageEventRow {
        CursorUsageEventRow {
            event_key: key.into(),
            ts,
            date: "2026-09-15".into(),
            hour: 10,
            model: "claude".into(),
            kind: None,
            chargeable: true,
            input_tokens: 1,
            output_tokens: 2,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            cost_cents: 12.5,
        }
    }

    #[test]
    fn upsert_dedupes_and_max_ts() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        upsert_events(&c, &[sample("k1", 100), sample("k1", 100)]).unwrap();
        let n: i64 = c
            .query_row("SELECT COUNT(*) FROM cursor_usage_events", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
        upsert_events(&c, &[sample("k2", 200)]).unwrap();
        assert_eq!(max_ts(&c).unwrap(), Some(200));
        assert_eq!(events_in_range(&c, 100, 150).unwrap().len(), 1);
        assert_eq!(recent(&c, 10).unwrap().len(), 2);
    }

    #[test]
    fn snapshot_roundtrip() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        assert!(load_snapshot(&c).unwrap().is_none());
        let mut snap = CursorUsageSnapshot::default();
        snap.fetched_at = 42;
        snap.email = Some("a@b.c".into());
        save_snapshot(&c, &snap).unwrap();
        let loaded = load_snapshot(&c).unwrap().unwrap();
        assert_eq!(loaded.fetched_at, 42);
        assert_eq!(loaded.email.as_deref(), Some("a@b.c"));
    }
}
