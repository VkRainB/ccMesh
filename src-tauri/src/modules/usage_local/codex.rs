use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::models::usage::UsageRecord;

use super::{local_date, ts_millis};

/// 解析单个 Codex 会话 JSONL：token_count 事件携带累计用量，按相邻差求每次增量。
pub fn parse_file(path: &Path) -> Vec<UsageRecord> {
    let Ok(file) = fs::File::open(path) else {
        return Vec::new();
    };
    let fallback_date = date_from_path(path);
    let lines = BufReader::new(file).lines().map_while(Result::ok);
    parse_lines(lines, &fallback_date)
}

/// 纯解析逻辑（便于单测）。`fallback_date` 用于事件缺时间戳时的日期归属。
pub fn parse_lines(lines: impl Iterator<Item = String>, fallback_date: &str) -> Vec<UsageRecord> {
    let mut out = Vec::new();
    let mut session_id: Option<String> = None;
    let mut model = "unknown".to_string();
    let mut prev: Option<(i64, i64, i64)> = None; // 累计 (input, cached, output)
    let mut event_index: i64 = 0;

    for line in lines {
        let t = line.trim();
        if t.is_empty() {
            continue;
        }
        let is_event = t.contains("\"event_msg\"");
        let is_turn = t.contains("\"turn_context\"");
        let is_meta = t.contains("\"session_meta\"");
        if !is_event && !is_turn && !is_meta {
            continue;
        }
        if is_event && !t.contains("\"token_count\"") {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(t) else {
            continue;
        };
        match v.get("type").and_then(|x| x.as_str()) {
            Some("session_meta") if session_id.is_none() => {
                session_id = v
                    .get("payload")
                    .and_then(|p| {
                        p.get("session_id")
                            .or_else(|| p.get("sessionId"))
                            .or_else(|| p.get("id"))
                    })
                    .and_then(|x| x.as_str())
                    .map(String::from);
            }
            Some("turn_context") => {
                if let Some(m) = v
                    .get("payload")
                    .and_then(|p| {
                        p.get("model")
                            .or_else(|| p.get("info").and_then(|i| i.get("model")))
                    })
                    .and_then(|x| x.as_str())
                {
                    model = normalize_model(m);
                }
            }
            Some("event_msg") => {
                let Some(payload) = v.get("payload") else {
                    continue;
                };
                if payload.get("type").and_then(|x| x.as_str()) != Some("token_count") {
                    continue;
                }
                let Some(info) = payload.get("info").filter(|i| !i.is_null()) else {
                    continue;
                };
                if let Some(m) = info
                    .get("model")
                    .or_else(|| info.get("model_name"))
                    .or_else(|| payload.get("model"))
                    .and_then(|x| x.as_str())
                {
                    model = normalize_model(m);
                }
                let Some(total) = info.get("total_token_usage") else {
                    continue;
                };
                let g = |k: &str| total.get(k).and_then(|x| x.as_i64()).unwrap_or(0);
                let cur_input = g("input_tokens");
                let cur_cached = total
                    .get("cached_input_tokens")
                    .or_else(|| total.get("cache_read_input_tokens"))
                    .and_then(|x| x.as_i64())
                    .unwrap_or(0);
                let cur_output = g("output_tokens");

                let (mut d_in, mut d_cached, d_out) = match prev {
                    None => (cur_input, cur_cached, cur_output),
                    Some((pi, pc, po)) => (
                        (cur_input - pi).max(0),
                        (cur_cached - pc).max(0),
                        (cur_output - po).max(0),
                    ),
                };
                prev = Some((cur_input, cur_cached, cur_output));
                d_cached = d_cached.min(d_in); // 钳制：缓存不超过输入
                d_in -= d_cached; // 拆出非缓存输入，避免与缓存重复计数
                if d_in == 0 && d_cached == 0 && d_out == 0 {
                    continue; // 跳过零 delta（任务边界）
                }
                event_index += 1;
                let ts_str = v.get("timestamp").and_then(|x| x.as_str());
                let ts = ts_str.and_then(ts_millis);
                let date = ts_str
                    .map(local_date)
                    .filter(|s| !s.is_empty())
                    .unwrap_or_else(|| fallback_date.to_string());
                let sid = session_id.as_deref().unwrap_or("unknown");
                out.push(UsageRecord {
                    app_type: "codex".to_string(),
                    record_key: format!("codex_session:{sid}:{event_index}"),
                    date,
                    ts,
                    model: model.clone(),
                    requests: 1,
                    input_tokens: d_in,
                    output_tokens: d_out,
                    cache_creation_tokens: 0,
                    cache_read_tokens: d_cached,
                });
            }
            _ => {}
        }
    }
    out
}

/// 归一化 Codex 模型名：小写 + 去 `provider/` 前缀 + 去 `-YYYY-MM-DD` / `-YYYYMMDD` 日期后缀。
fn normalize_model(raw: &str) -> String {
    let mut name = raw.to_lowercase();
    if let Some(pos) = name.rfind('/') {
        name = name[pos + 1..].to_string();
    }
    // -YYYY-MM-DD（11 字符）
    if name.len() > 11 {
        let s = &name[name.len() - 11..];
        let b = s.as_bytes();
        if s.is_ascii()
            && b[0] == b'-'
            && s[1..5].chars().all(|c| c.is_ascii_digit())
            && b[5] == b'-'
            && s[6..8].chars().all(|c| c.is_ascii_digit())
            && b[8] == b'-'
            && s[9..11].chars().all(|c| c.is_ascii_digit())
        {
            name.truncate(name.len() - 11);
            return name;
        }
    }
    // -YYYYMMDD（9 字符）
    if name.len() > 9 {
        if let Some((head, suffix)) = name.rsplit_once('-') {
            if suffix.len() == 8 && suffix.chars().all(|c| c.is_ascii_digit()) {
                return head.to_string();
            }
        }
    }
    name
}

/// 从路径中提取 `YYYY/MM/DD` 作为日期回退；找不到用今天。
fn date_from_path(path: &Path) -> String {
    let comps: Vec<String> = path
        .components()
        .filter_map(|c| c.as_os_str().to_str().map(String::from))
        .collect();
    for w in comps.windows(3) {
        let digits = |s: &str, n: usize| s.len() == n && s.chars().all(|c| c.is_ascii_digit());
        if digits(&w[0], 4) && digits(&w[1], 2) && digits(&w[2], 2) {
            return format!("{}-{}-{}", w[0], w[1], w[2]);
        }
    }
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn computes_per_event_deltas() {
        let lines = vec![
            r#"{"type":"session_meta","payload":{"id":"sess-1"}}"#.to_string(),
            r#"{"type":"turn_context","payload":{"model":"openai/gpt-5.4-2026-03-05"}}"#.to_string(),
            r#"{"type":"event_msg","timestamp":"2026-06-07T10:00:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":30}}}}"#.to_string(),
            r#"{"type":"event_msg","timestamp":"2026-06-07T10:01:00Z","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":250,"cached_input_tokens":60,"output_tokens":90}}}}"#.to_string(),
        ];
        let recs = parse_lines(lines.into_iter(), "2026-06-07");
        assert_eq!(recs.len(), 2);
        // 第一次：input=100,cached=20 → 非缓存输入=80，缓存读取=20，输出=30
        assert_eq!(recs[0].model, "gpt-5.4");
        assert_eq!(recs[0].input_tokens, 80);
        assert_eq!(recs[0].cache_read_tokens, 20);
        assert_eq!(recs[0].output_tokens, 30);
        assert_eq!(recs[0].record_key, "codex_session:sess-1:1");
        // 第二次 delta：input 150,cached 40 → 非缓存=110，缓存=40，输出=60
        assert_eq!(recs[1].input_tokens, 110);
        assert_eq!(recs[1].cache_read_tokens, 40);
        assert_eq!(recs[1].output_tokens, 60);
    }

    #[test]
    fn skips_zero_delta_events() {
        let lines = vec![
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":10}}}}"#.to_string(),
            r#"{"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":50,"cached_input_tokens":0,"output_tokens":10}}}}"#.to_string(),
        ];
        let recs = parse_lines(lines.into_iter(), "2026-06-07");
        assert_eq!(recs.len(), 1); // 第二条 delta 为零被跳过
    }

    #[test]
    fn normalize_model_strips_prefix_and_date() {
        assert_eq!(normalize_model("OpenAI/GPT-5.4"), "gpt-5.4");
        assert_eq!(normalize_model("gpt-5.4-2026-03-05"), "gpt-5.4");
        assert_eq!(normalize_model("gpt-5.4-20260305"), "gpt-5.4");
        assert_eq!(normalize_model("glm-4.6"), "glm-4.6");
    }
}
