use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::models::usage::UsageRecord;

use super::{local_date, ts_millis};

/// 解析单个 Claude Code 会话 JSONL（同一 message.id 取 token 总量最大的一条去重）。
pub fn parse_file(path: &Path) -> Vec<UsageRecord> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let lines = BufReader::new(file).lines().map_while(Result::ok);
    parse_lines(lines)
}

/// 纯解析逻辑（便于单测）：逐行取 type=="assistant" 且含 message.id+usage 的记录。
pub fn parse_lines(lines: impl Iterator<Item = String>) -> Vec<UsageRecord> {
    let mut by_id: HashMap<String, UsageRecord> = HashMap::new();
    for line in lines {
        let line = line.trim();
        if line.is_empty() || !line.contains("\"assistant\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("assistant") {
            continue;
        }
        let Some(msg) = v.get("message") else {
            continue;
        };
        let Some(id) = msg.get("id").and_then(|x| x.as_str()) else {
            continue;
        };
        let Some(usage) = msg.get("usage") else {
            continue;
        };
        let field = |k: &str| usage.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
        let input = field("input_tokens");
        let output = field("output_tokens");
        let cache_creation = field("cache_creation_input_tokens");
        let cache_read = field("cache_read_input_tokens");
        if input == 0 && output == 0 && cache_creation == 0 && cache_read == 0 {
            continue;
        }
        let ts_str = v.get("timestamp").and_then(|t| t.as_str());
        let ts = ts_str.and_then(ts_millis);
        let date = ts_str
            .map(local_date)
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "unknown".to_string());
        let model = msg
            .get("model")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let rec = UsageRecord {
            app_type: "claude".to_string(),
            record_key: id.to_string(),
            date,
            ts,
            model,
            requests: 1,
            input_tokens: input,
            output_tokens: output,
            cache_creation_tokens: cache_creation,
            cache_read_tokens: cache_read,
        };
        // 同 id 取 token 合计更大的一条（防流式分片低估）
        let total = |r: &UsageRecord| {
            r.input_tokens + r.output_tokens + r.cache_creation_tokens + r.cache_read_tokens
        };
        match by_id.get(id) {
            Some(existing) if total(existing) >= total(&rec) => {}
            _ => {
                by_id.insert(id.to_string(), rec);
            }
        }
    }
    by_id.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_assistant_usage_with_cache() {
        let lines = vec![
            r#"{"type":"user","message":{"content":"hi"}}"#.to_string(),
            r#"{"type":"assistant","timestamp":"2026-06-07T10:00:00Z","message":{"id":"m1","model":"claude-opus","stop_reason":"end_turn","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":20,"cache_read_input_tokens":30}}}"#.to_string(),
        ];
        let recs = parse_lines(lines.into_iter());
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r.app_type, "claude");
        assert_eq!(r.record_key, "m1");
        assert_eq!(r.model, "claude-opus");
        assert_eq!(r.input_tokens, 100);
        assert_eq!(r.cache_creation_tokens, 20);
        assert_eq!(r.cache_read_tokens, 30);
        assert_eq!(r.requests, 1);
        // ts 为该 RFC3339 时间戳的 Unix 毫秒
        assert_eq!(r.ts, Some(1_780_826_400_000)); // 2026-06-07T10:00:00Z
    }

    #[test]
    fn dedupes_same_id_keeping_max_tokens() {
        let lines = vec![
            r#"{"type":"assistant","timestamp":"2026-06-07T10:00:00Z","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":1}}}"#.to_string(),
            r#"{"type":"assistant","timestamp":"2026-06-07T10:00:00Z","message":{"id":"m1","usage":{"input_tokens":10,"output_tokens":80}}}"#.to_string(),
        ];
        let recs = parse_lines(lines.into_iter());
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].output_tokens, 80);
    }

    #[test]
    fn skips_zero_and_non_assistant() {
        let lines = vec![
            r#"{"type":"assistant","message":{"id":"z","usage":{"input_tokens":0,"output_tokens":0}}}"#.to_string(),
            r#"{"type":"system","message":{"id":"s"}}"#.to_string(),
        ];
        assert!(parse_lines(lines.into_iter()).is_empty());
    }
}
