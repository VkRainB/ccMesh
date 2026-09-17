use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use chrono::{DateTime, FixedOffset};
use serde_json::Value;

use crate::modules::tool_sessions::SessionMessage;

/// Maximum number of characters for session titles (shared across providers).
pub const TITLE_MAX_CHARS: usize = 80;

/// pi/omp 列表扫描的 head/tail 行数。title 槽 + session 头 + 首条 user 通常在前几行。
pub const PI_OMP_SCAN_HEAD_LINES: usize = 24;
pub const PI_OMP_SCAN_TAIL_LINES: usize = 24;

/// 列表扫描只采样文件头；单行超大 tool-result 不得把整个 payload 读进列表路径。
pub const SCAN_HEAD_BYTES_MAX: u64 = 64 * 1024;
const SCAN_TAIL_BYTES_MAX: u64 = 16_384;

/// 详情加载：跳过超大 JSONL 行，正文截断后交给前端折叠展示。
///
/// ponytail: 会话管理是预览器不是分页器（ceil: 超长 tool dump 只留 8k 字；
/// 升级路径——按消息 id 懒加载全文）。
pub const MESSAGE_LINE_MAX_BYTES: usize = 128 * 1024;
pub const MESSAGE_CONTENT_MAX_CHARS: usize = 8_000;

/// Read the first `head_n` lines and last `tail_n` lines from a file.
/// For small files (< 16 KB), reads all lines once to avoid unnecessary seeking.
/// Large files cap the head at [`SCAN_HEAD_BYTES_MAX`] so a few multi-MB JSONL
/// rows cannot stall `list_tool_sessions`.
pub fn read_head_tail_lines(
    path: &Path,
    head_n: usize,
    tail_n: usize,
) -> io::Result<(Vec<String>, Vec<String>)> {
    let file = File::open(path)?;
    let file_len = file.metadata()?.len();

    // For small files, read all lines once and split
    if file_len < SCAN_TAIL_BYTES_MAX {
        let reader = BufReader::new(file);
        let all: Vec<String> = reader.lines().map_while(Result::ok).collect();
        let head = all.iter().take(head_n).cloned().collect();
        let skip = all.len().saturating_sub(tail_n);
        let tail = all.into_iter().skip(skip).collect();
        return Ok((head, tail));
    }

    let head_reader = BufReader::new(file.take(SCAN_HEAD_BYTES_MAX));
    let head: Vec<String> = head_reader
        .lines()
        .take(head_n)
        .map_while(Result::ok)
        .collect();

    let seek_pos = file_len.saturating_sub(SCAN_TAIL_BYTES_MAX);
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

/// 收集 pi/omp 会话 jsonl：`sessions/<slug>/*.jsonl`。
///
/// 不进入 jsonl 同名 sidecar 目录（bash log 等）。全量递归会让列表扫描卡在
/// 成百上千的日志文件上。
///
/// ponytail: 只从 sessions 根往下走 1 层 slug（ceil: sidecar 里若再放 jsonl
/// 会被忽略；升级路径——布局多一层再加深 remaining_descents）。
pub fn collect_jsonl_files(root: &Path, files: &mut Vec<PathBuf>) {
    collect_jsonl_files_depth(root, files, 1);
}

fn collect_jsonl_files_depth(dir: &Path, files: &mut Vec<PathBuf>, remaining_descents: u32) {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        if file_type.is_dir() {
            if remaining_descents > 0 {
                collect_jsonl_files_depth(&entry.path(), files, remaining_descents - 1);
            }
            continue;
        }
        let name = entry.file_name();
        if Path::new(&name).extension().and_then(|ext| ext.to_str()) == Some("jsonl") {
            files.push(entry.path());
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
                            fields.first_user_message =
                                Some(truncate_summary(trimmed, TITLE_MAX_CHARS));
                        }
                    }
                }
            }
            _ => {}
        }
        // session 头 + 任一标题来源已够列表展示；不必把 head 剩余行全部 serde。
        if fields.session_id.is_some()
            && (fields.title_slot.is_some()
                || fields.session_title.is_some()
                || fields.first_user_message.is_some())
        {
            break;
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
                    fields.summary = Some(truncate_summary(&text, 160));
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
        if line.len() > MESSAGE_LINE_MAX_BYTES {
            continue;
        }
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
        let mut content = message
            .get("content")
            .map(extract_pi_omp_content)
            .unwrap_or_default();
        if content.trim().is_empty() {
            continue;
        }
        if content.len() > MESSAGE_CONTENT_MAX_CHARS {
            content = truncate_summary(&content, MESSAGE_CONTENT_MAX_CHARS);
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
    use tempfile::tempdir;

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

    #[test]
    fn collect_jsonl_files_skips_sidecar_directories() {
        let temp = tempdir().expect("tempdir");
        let slug = temp.path().join("--E--demo--");
        let sidecar = slug.join("2026-06-30T11-26-32-818Z_019f1847-e572-7261-85c1-f3fac09447c5");
        std::fs::create_dir_all(&sidecar).expect("sidecar");
        let session =
            slug.join("2026-06-30T11-26-32-818Z_019f1847-e572-7261-85c1-f3fac09447c5.jsonl");
        std::fs::write(&session, "{}\n").expect("session jsonl");
        std::fs::write(sidecar.join("bash.log"), "log").expect("log");
        std::fs::write(sidecar.join("nested.jsonl"), "{}\n").expect("nested jsonl");
        let root_jsonl = temp.path().join("loose.jsonl");
        std::fs::write(&root_jsonl, "{}\n").expect("root jsonl");

        let mut files = Vec::new();
        collect_jsonl_files(temp.path(), &mut files);
        files.sort();
        let mut expected = vec![session, root_jsonl];
        expected.sort();
        assert_eq!(files, expected);
    }

    #[test]
    fn read_head_tail_lines_caps_head_bytes_on_large_files() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("huge.jsonl");
        let mut body = String::new();
        body.push_str("{\"type\":\"session\",\"id\":\"keep-me\"}\n");
        body.push_str(&format!(
            "{}\n",
            "x".repeat(SCAN_HEAD_BYTES_MAX as usize + 8 * 1024)
        ));
        body.push_str("{\"type\":\"message\",\"id\":\"after-budget\"}\n");
        std::fs::write(&path, body).expect("write");

        let (head, _tail) = read_head_tail_lines(&path, 24, 24).expect("read");
        assert!(
            head.iter().any(|line| line.contains("keep-me")),
            "session header at byte 0 must still be sampled: {head:?}"
        );
        assert!(
            head.iter().all(|line| !line.contains("after-budget")),
            "lines past the head byte cap must not be read: {head:?}"
        );
    }

    #[test]
    fn parse_pi_omp_scan_fields_stops_after_session_and_title() {
        let title = json!({"type":"title","title":"槽标题"}).to_string();
        let session = json!({
            "type":"session",
            "id":"abc",
            "timestamp":"2026-08-27T00:44:52.410Z",
            "cwd":"C:\\proj"
        })
        .to_string();
        let user = json!({
            "type":"message",
            "message":{"role":"user","content":[{"type":"text","text":"不应作为标题"}]}
        })
        .to_string();
        let fields = parse_pi_omp_scan_fields(&[title, session, user], &[]);
        assert_eq!(fields.title_slot.as_deref(), Some("槽标题"));
        assert_eq!(fields.session_id.as_deref(), Some("abc"));
        assert!(
            fields.first_user_message.is_none(),
            "head parse should stop once title slot + session id exist"
        );
    }

    #[test]
    fn load_pi_omp_messages_truncates_huge_content_and_skips_huge_lines() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");
        let huge_text = "汉".repeat(MESSAGE_CONTENT_MAX_CHARS + 200);
        let keep = json!({
            "type":"message",
            "message":{
                "role":"user",
                "content":[{"type":"text","text": huge_text}],
                "timestamp": 1
            }
        })
        .to_string();
        let skipped = format!(
            "{{\"type\":\"message\",\"message\":{{\"role\":\"assistant\",\"content\":\"{}\"}}}}",
            "y".repeat(MESSAGE_LINE_MAX_BYTES)
        );
        let small = json!({
            "type":"message",
            "message":{"role":"assistant","content":[{"type":"text","text":"ok"}],"timestamp":2}
        })
        .to_string();
        std::fs::write(&path, format!("{keep}\n{skipped}\n{small}\n")).expect("write");

        let msgs = load_pi_omp_messages(&path).expect("load");
        assert_eq!(msgs.len(), 2);
        assert!(msgs[0].content.ends_with("..."));
        assert!(msgs[0].content.chars().count() <= MESSAGE_CONTENT_MAX_CHARS + 3);
        assert_eq!(msgs[1].content, "ok");
    }
}
