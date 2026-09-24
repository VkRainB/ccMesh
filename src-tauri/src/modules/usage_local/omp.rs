use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::models::usage::UsageRecord;

use super::{local_date_from_ms, ts_millis};

/// 解析单个 omp 会话 JSONL。
///
/// ponytail: 活跃会话每次 mtime 变化都整文件重读，耗时与文件大小成正比。
/// 升级路径：给 usage_sync_state 加 offset 列，只解析追加字节。
pub fn parse_file(path: &Path) -> Vec<UsageRecord> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let lines = BufReader::new(file).lines().map_while(Result::ok);
    parse_lines(lines)
}

/// 纯解析：assistant message 与 model_usage，且带 id / model / usage。
pub fn parse_lines(lines: impl Iterator<Item = String>) -> Vec<UsageRecord> {
    let mut out = Vec::new();
    for line in lines {
        let line = line.trim();
        if line.is_empty() || !line.contains("\"usage\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(rec) = record_from_entry(&v) {
            out.push(rec);
        }
    }
    out
}

fn record_from_entry(v: &Value) -> Option<UsageRecord> {
    let kind = v.get("type").and_then(|t| t.as_str())?;
    let (model, usage, msg_ts) = match kind {
        "message" => {
            let msg = v.get("message")?;
            if msg.get("role").and_then(|r| r.as_str()) != Some("assistant") {
                return None;
            }
            (
                msg.get("model").and_then(|m| m.as_str()),
                msg.get("usage"),
                msg.get("timestamp"),
            )
        }
        "model_usage" => (
            v.get("model").and_then(|m| m.as_str()),
            v.get("usage"),
            None,
        ),
        _ => return None,
    };
    let id = v
        .get("id")
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())?;
    let model = model.filter(|s| !s.is_empty())?;
    let usage = usage?;

    let orch = usage.get("orchestration");
    let bucket =
        |key: &str| finite_token(usage.get(key)) + finite_token(orch.and_then(|o| o.get(key)));
    let input = bucket("input");
    let output = bucket("output");
    let cache_write = finite_token(usage.get("cacheWrite"));
    let cache_read = bucket("cacheRead");
    if input == 0 && output == 0 && cache_write == 0 && cache_read == 0 {
        return None;
    }

    let ts = entry_ts(msg_ts, v.get("timestamp").and_then(|t| t.as_str()));
    let date = ts
        .map(local_date_from_ms)
        .unwrap_or_else(|| "unknown".to_string());
    let ts_ms = ts.unwrap_or(0);
    Some(UsageRecord {
        app_type: "omp".to_string(),
        record_key: format!("omp:{id}:{ts_ms}"),
        date,
        ts,
        model: model.to_string(),
        requests: 1,
        input_tokens: input,
        output_tokens: output,
        cache_creation_tokens: cache_write,
        cache_read_tokens: cache_read,
    })
}

/// `message.timestamp`（>0 的毫秒）优先，否则信封 RFC3339，都没有则为 None。
fn entry_ts(msg_ts: Option<&Value>, envelope: Option<&str>) -> Option<i64> {
    if let Some(n) = msg_ts.and_then(finite_number) {
        if n > 0.0 {
            return Some(n as i64);
        }
    }
    envelope.and_then(ts_millis)
}

fn finite_token(v: Option<&Value>) -> i64 {
    finite_number(v.unwrap_or(&Value::Null))
        .map(|n| n as i64)
        .unwrap_or(0)
}

fn finite_number(v: &Value) -> Option<f64> {
    let n = v.as_f64()?;
    n.is_finite().then_some(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::storage::migration::run_migrations;
    use crate::modules::storage::usage_repo;
    use rusqlite::Connection;

    const ASSISTANT: &str = r#"{"type":"message","id":"0739ef42","timestamp":"2026-08-27T00:46:04.599Z","message":{"role":"assistant","model":"remote-gpt/gpt-5.6-sol","timestamp":1787791562698,"usage":{"input":779,"output":271,"cacheRead":23040,"cacheWrite":12,"totalTokens":24102,"reasoningTokens":10,"cost":{"total":0.01}}}}"#;

    #[test]
    fn maps_assistant_buckets_without_subtracting_cache() {
        let recs = parse_lines(std::iter::once(ASSISTANT.to_string()));
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r.app_type, "omp");
        assert_eq!(r.record_key, "omp:0739ef42:1787791562698");
        assert_eq!(r.model, "remote-gpt/gpt-5.6-sol");
        assert_eq!(r.input_tokens, 779);
        assert_eq!(r.output_tokens, 271);
        assert_eq!(r.cache_creation_tokens, 12);
        assert_eq!(r.cache_read_tokens, 23040);
        assert_eq!(r.ts, Some(1_787_791_562_698));
        assert_eq!(r.date.len(), 10);
        assert_eq!(r.requests, 1);
    }

    #[test]
    fn model_usage_uses_envelope_timestamp_and_folds_orchestration() {
        let line = r#"{"type":"model_usage","id":"title1","timestamp":"2026-06-07T10:00:00Z","purpose":"title","model":"tiny","usage":{"input":10,"output":2,"cacheRead":0,"cacheWrite":0,"orchestration":{"input":3,"output":1,"cacheRead":4}}}"#;
        let recs = parse_lines(std::iter::once(line.to_string()));
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r.record_key, "omp:title1:1780826400000");
        assert_eq!(r.ts, Some(1_780_826_400_000));
        assert_eq!(r.input_tokens, 13);
        assert_eq!(r.output_tokens, 3);
        assert_eq!(r.cache_read_tokens, 4);
        assert_eq!(r.model, "tiny");
    }

    #[test]
    fn skips_zero_missing_id_and_non_finite_tokens() {
        let lines = [
            r#"{"type":"message","id":"z","message":{"role":"assistant","model":"m","usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0}}}"#,
            r#"{"type":"message","message":{"role":"assistant","model":"m","usage":{"input":5,"output":1}}}"#,
            r#"{"type":"message","id":"bad","message":{"role":"assistant","model":"m","usage":{"input":"nope","output":1}}}"#,
            r#"{"type":"user","id":"u","message":{"role":"user","content":"hi"}}"#,
            r#"{"type":"title","title":"x"}"#,
        ];
        let recs = parse_lines(lines.into_iter().map(str::to_string));
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].record_key, "omp:bad:0");
        assert_eq!(recs[0].input_tokens, 0);
        assert_eq!(recs[0].output_tokens, 1);
        assert_eq!(recs[0].date, "unknown");
        assert!(recs[0].ts.is_none());
    }

    #[test]
    fn fork_duplicate_inserts_once() {
        let c = Connection::open_in_memory().unwrap();
        run_migrations(&c).unwrap();
        let recs = parse_lines(std::iter::once(ASSISTANT.to_string()));
        assert!(usage_repo::insert_record(&c, &recs[0]).unwrap());
        assert!(!usage_repo::insert_record(&c, &recs[0]).unwrap());
    }
}
