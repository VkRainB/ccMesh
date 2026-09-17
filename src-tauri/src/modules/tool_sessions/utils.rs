use std::fs::File;
use std::io::{self, BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use chrono::{DateTime, FixedOffset};
use serde_json::Value;

use crate::modules::tool_sessions::SessionMessage;

/// Maximum number of characters for session titles (shared across providers).
pub const TITLE_MAX_CHARS: usize = 80;

/// Read the first `head_n` lines and last `tail_n` lines from a file.
/// For small files (< 16 KB), reads all lines once to avoid unnecessary seeking.
pub fn read_head_tail_lines(
    path: &Path,
    head_n: usize,
    tail_n: usize,
) -> io::Result<(Vec<String>, Vec<String>)> {
    let file = File::open(path)?;
    let file_len = file.metadata()?.len();

    // For small files, read all lines once and split
    if file_len < 16_384 {
        let reader = BufReader::new(file);
        let all: Vec<String> = reader.lines().map_while(Result::ok).collect();
        let head = all.iter().take(head_n).cloned().collect();
        let skip = all.len().saturating_sub(tail_n);
        let tail = all.into_iter().skip(skip).collect();
        return Ok((head, tail));
    }

    // Read head lines from the beginning
    let reader = BufReader::new(file);
    let head: Vec<String> = reader.lines().take(head_n).map_while(Result::ok).collect();

    // Seek to last ~16 KB for tail lines
    let seek_pos = file_len.saturating_sub(16_384);
    let mut file2 = File::open(path)?;
    file2.seek(SeekFrom::Start(seek_pos))?;
    let tail_reader = BufReader::new(file2);
    let all_tail: Vec<String> = tail_reader.lines().map_while(Result::ok).collect();

    // Skip first partial line if we seeked into the middle of a line
    let skip_first = if seek_pos > 0 { 1 } else { 0 };
    let usable: Vec<String> = all_tail.into_iter().skip(skip_first).collect();
    let skip = usable.len().saturating_sub(tail_n);
    let tail = usable.into_iter().skip(skip).collect();

    Ok((head, tail))
}

pub fn parse_timestamp_to_ms(value: &Value) -> Option<i64> {
    // Integer: milliseconds (>1e12) or seconds
    if let Some(n) = value.as_i64() {
        return Some(if n > 1_000_000_000_000 { n } else { n * 1000 });
    }
    if let Some(n) = value.as_f64() {
        let n = n as i64;
        return Some(if n > 1_000_000_000_000 { n } else { n * 1000 });
    }
    // RFC3339 string
    let raw = value.as_str()?;
    DateTime::parse_from_rfc3339(raw)
        .ok()
        .map(|dt: DateTime<FixedOffset>| dt.timestamp_millis())
}

pub fn extract_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.to_string(),
        Value::Array(items) => items
            .iter()
            .filter_map(extract_text_from_item)
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .get("text")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    }
}

fn extract_text_from_item(item: &Value) -> Option<String> {
    let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");

    // tool_use: show tool name
    if item_type == "tool_use" {
        let name = item
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        return Some(format!("[Tool: {name}]"));
    }

    // tool_result: extract nested content
    if item_type == "tool_result" {
        if let Some(content) = item.get("content") {
            let text = extract_text(content);
            if !text.is_empty() {
                return Some(text);
            }
        }
        return None;
    }

    if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
        return Some(text.to_string());
    }

    if let Some(text) = item.get("input_text").and_then(|v| v.as_str()) {
        return Some(text.to_string());
    }

    if let Some(text) = item.get("output_text").and_then(|v| v.as_str()) {
        return Some(text.to_string());
    }

    if let Some(content) = item.get("content") {
        let text = extract_text(content);
        if !text.is_empty() {
            return Some(text);
        }
    }

    None
}

pub fn truncate_summary(text: &str, max_chars: usize) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }

    let mut result = trimmed.chars().take(max_chars).collect::<String>();
    result.push_str("...");
    result
}

pub fn path_basename(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = trimmed.trim_end_matches(['/', '\\']);
    let last = normalized
        .split(['/', '\\'])
        .next_back()
        .filter(|segment| !segment.is_empty())?;
    Some(last.to_string())
}

/// 递归收集目录下所有 `*.jsonl` 文件。pi/omp 与 codex/claude 共用同一布局扫描。
pub fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) {
    if !root.exists() {
        return;
    }
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl_files(&path, files);
        } else if path.extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(path);
        }
    }
}

/// pi/omp message content part → 文本（JSONL version=3，pi 与 omp 互通）。
///
/// `text` 原文；`toolCall` → `[Tool: name]`（对齐 codex function_call 呈现）；
/// `image` → `[图片]`；`thinking` 跳过（不混入正文）；`toolResult` 取其内嵌 text。
pub fn extract_pi_omp_content(content: &Value) -> String {
    match content {
        Value::String(text) => text.to_string(),
        Value::Array(items) => items
            .iter()
            .filter_map(|item| {
                let item_type = item.get("type").and_then(Value::as_str).unwrap_or("");
                match item_type {
                    "text" => item.get("text").and_then(Value::as_str).map(String::from),
                    "toolCall" => {
                        let name = item
                            .get("name")
                            .or_else(|| item.get("toolName"))
                            .and_then(Value::as_str)
                            .unwrap_or("unknown");
                        Some(format!("[Tool: {name}]"))
                    }
                    "image" => Some("[图片]".to_string()),
                    "thinking" => None,
                    "toolResult" => {
                        let text = extract_text(item.get("content").unwrap_or(&Value::Null));
                        if text.trim().is_empty() {
                            None
                        } else {
                            Some(text)
                        }
                    }
                    _ => {
                        let text = extract_text(item);
                        if text.trim().is_empty() {
                            None
                        } else {
                            Some(text)
                        }
                    }
                }
            })
            .filter(|text| !text.trim().is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        _ => String::new(),
    }
}

/// pi/omp 消息 role 映射到 ccMesh 的 4 角色（`toolResult` → `tool`）。
pub fn map_pi_omp_role(role: &str) -> String {
    match role {
        "user" => "user".to_string(),
        "assistant" => "assistant".to_string(),
        "toolResult" => "tool".to_string(),
        other => other.to_string(),
    }
}

/// 从 head/tail 采样行解析 pi/omp 会话的公共元数据（version=3）。
///
/// head 提供：`type:"title"` 槽标题、`type:"session"` 头（id/cwd/timestamp/title）、
/// 首条 user 消息。tail 提供：`last_active_at`、末条 summary、最后一条
/// `source=="user"` 的 `title_change`（omp 用户重命名）。
pub struct PiOmpScanFields {
    pub session_id: Option<String>,
    pub project_dir: Option<String>,
    pub created_at: Option<i64>,
    pub last_active_at: Option<i64>,
    pub first_user_message: Option<String>,
    pub summary: Option<String>,
    pub title_slot: Option<String>,
    pub session_title: Option<String>,
    pub user_title_change: Option<String>,
}

pub fn parse_pi_omp_scan_fields(head: &[String], tail: &[String]) -> PiOmpScanFields {
    let mut fields = PiOmpScanFields {
        session_id: None,
        project_dir: None,
        created_at: None,
        last_active_at: None,
        first_user_message: None,
        summary: None,
        title_slot: None,
        session_title: None,
        user_title_change: None,
    };

    for line in head {
        let Ok(value): Result<Value, _> = serde_json::from_str(line) else {
            continue;
        };
        let entry_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        match entry_type {
            "title" if fields.title_slot.is_none() => {
                fields.title_slot = value
                    .get("title")
                    .and_then(Value::as_str)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
            "session" => {
                if fields.session_id.is_none() {
                    fields.session_id = value.get("id").and_then(Value::as_str).map(String::from);
                }
                if fields.project_dir.is_none() {
                    fields.project_dir = value.get("cwd").and_then(Value::as_str).map(String::from);
                }
                if fields.created_at.is_none() {
                    fields.created_at = value.get("timestamp").and_then(parse_timestamp_to_ms);
                }
                if fields.session_title.is_none() {
                    fields.session_title = value
                        .get("title")
                        .and_then(Value::as_str)
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                }
            }
            "message" if fields.first_user_message.is_none() => {
                if let Some(message) = value.get("message") {
                    if message.get("role").and_then(Value::as_str) == Some("user") {
                        let text = message
                            .get("content")
                            .map(extract_pi_omp_content)
                            .unwrap_or_default();
                        let trimmed = text.trim();
                        if !trimmed.is_empty() {
                            fields.first_user_message = Some(trimmed.to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }

    for line in tail.iter().rev() {
        let Ok(value): Result<Value, _> = serde_json::from_str(line) else {
            continue;
        };
        let entry_type = value.get("type").and_then(Value::as_str).unwrap_or("");
        if fields.last_active_at.is_none() {
            fields.last_active_at = value.get("timestamp").and_then(parse_timestamp_to_ms);
        }
        if fields.user_title_change.is_none() && entry_type == "title_change" {
            if value.get("source").and_then(Value::as_str) == Some("user") {
                fields.user_title_change = value
                    .get("title")
                    .and_then(Value::as_str)
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty());
            }
        }
        if fields.summary.is_none() && entry_type == "message" {
            if let Some(message) = value.get("message") {
                let text = message
                    .get("content")
                    .map(extract_pi_omp_content)
                    .unwrap_or_default();
                if !text.trim().is_empty() {
                    fields.summary = Some(text);
                }
            }
        }
        if fields.last_active_at.is_some()
            && fields.user_title_change.is_some()
            && fields.summary.is_some()
        {
            break;
        }
    }

    fields
}

/// 从 `<ISO时间戳>_<uuid>.jsonl` 文件名提取 uuid 作 session_id 兜底。
pub fn infer_pi_omp_session_id_from_filename(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_string_lossy();
    // 文件名形如 2026-06-30T11-26-32-818Z_019f1847-e572-7261-85c1-f3fac09447c5
    let uuid_start = stem.find('_')?;
    let candidate = &stem[uuid_start + 1..];
    // 简单校验：uuid 含 4 个连字符且长度合理
    if candidate.matches('-').count() >= 3 && candidate.len() >= 16 {
        Some(candidate.to_string())
    } else {
        None
    }
}

/// 仅读 head 取 session id（删除校验用，避免读 tail 的开销）。
pub fn read_pi_omp_session_id(path: &Path) -> Option<String> {
    let (head, _tail) = read_head_tail_lines(path, 10, 0).ok()?;
    for line in &head {
        let Ok(value): Result<Value, _> = serde_json::from_str(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("session") {
            if let Some(id) = value.get("id").and_then(Value::as_str) {
                return Some(id.to_string());
            }
        }
    }
    infer_pi_omp_session_id_from_filename(path)
}

/// pi/omp 共用：全文逐行解析 `type:"message"` 条目为 SessionMessage。
pub fn load_pi_omp_messages(path: &Path) -> Result<Vec<SessionMessage>, String> {
    let file =
        std::fs::File::open(path).map_err(|e| format!("Failed to open session file: {e}"))?;
    let reader = std::io::BufReader::new(file);
    let mut messages = Vec::new();
    for line in std::io::BufRead::lines(reader) {
        let line = match line {
            Ok(value) => value,
            Err(_) => continue,
        };
        let Ok(value): Result<Value, _> = serde_json::from_str(&line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) != Some("message") {
            continue;
        }
        let Some(message) = value.get("message") else {
            continue;
        };
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let content = message
            .get("content")
            .map(extract_pi_omp_content)
            .unwrap_or_default();
        if content.trim().is_empty() {
            continue;
        }
        let ts = message
            .get("timestamp")
            .and_then(parse_timestamp_to_ms)
            .or_else(|| value.get("timestamp").and_then(parse_timestamp_to_ms));
        messages.push(SessionMessage {
            role: map_pi_omp_role(role),
            content,
            ts,
        });
    }
    Ok(messages)
}

/// pi/omp 共用：校验 session id 后删除 jsonl 与同名伴生目录（omp bash log）。
pub fn delete_pi_omp_session(
    provider_label: &str,
    path: &Path,
    session_id: &str,
) -> Result<bool, String> {
    let parsed_id = read_pi_omp_session_id(path).ok_or_else(|| {
        format!(
            "Failed to parse {provider_label} session metadata: {}",
            path.display()
        )
    })?;
    if parsed_id != session_id {
        return Err(format!(
            "{provider_label} session ID mismatch: expected {session_id}, found {parsed_id}"
        ));
    }
    if let Some(stem) = path.file_stem() {
        let sibling = path.parent().unwrap_or_else(|| Path::new("")).join(stem);
        remove_path_if_exists(&sibling).map_err(|e| {
            format!(
                "Failed to delete {provider_label} session sidecar {}: {e}",
                sibling.display()
            )
        })?;
    }
    std::fs::remove_file(path).map_err(|e| {
        format!(
            "Failed to delete {provider_label} session file {}: {e}",
            path.display()
        )
    })?;
    Ok(true)
}

fn remove_path_if_exists(path: &Path) -> std::io::Result<()> {
    match std::fs::metadata(path) {
        Ok(meta) => {
            if meta.is_dir() {
                std::fs::remove_dir_all(path)
            } else {
                std::fs::remove_file(path)
            }
        }
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_timestamp_to_ms_supports_integers_and_rfc3339() {
        assert_eq!(
            parse_timestamp_to_ms(&json!(1_771_061_953_033_i64)),
            Some(1_771_061_953_033)
        );
        assert_eq!(
            parse_timestamp_to_ms(&json!(1_771_061_953_i64)),
            Some(1_771_061_953_000)
        );
        assert_eq!(
            parse_timestamp_to_ms(&json!("1970-01-01T00:00:01Z")),
            Some(1_000)
        );
    }
}
