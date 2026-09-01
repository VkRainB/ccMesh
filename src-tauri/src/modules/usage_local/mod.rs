pub mod claude;
pub mod codex;
pub mod zcode;

use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::Connection;

use crate::models::usage::{UsageRecord, UsageSyncResult};
use crate::modules::storage::usage_repo;
use crate::utils::paths;

/// 文件 mtime（纳秒）。读取失败返回 0。
pub(crate) fn mtime_nanos(path: &Path) -> i64 {
    fs::metadata(path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as i64)
        .unwrap_or(0)
}

/// 递归收集 *.jsonl（限制深度，避免异常目录结构导致深递归）。
pub(crate) fn collect_jsonl(dir: &Path, max_depth: usize, out: &mut Vec<PathBuf>) {
    if max_depth == 0 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_jsonl(&path, max_depth - 1, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(path);
        }
    }
}

/// RFC3339 时间戳 → Unix 毫秒；解析失败返回 None。
pub(crate) fn ts_millis(ts: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(ts)
        .ok()
        .map(|dt| dt.timestamp_millis())
}

/// RFC3339 时间戳 → 本地日期 "YYYY-MM-DD"；解析失败取前 10 字符。
pub(crate) fn local_date(ts: &str) -> String {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|dt| {
            dt.with_timezone(&chrono::Local)
                .format("%Y-%m-%d")
                .to_string()
        })
        .unwrap_or_else(|_| ts.chars().take(10).collect())
}

/// 同步本机 Claude Code 与 Codex 用量到 DB（增量：按文件 mtime 跳过未变化文件）。
pub fn sync_all(conn: &Connection) -> UsageSyncResult {
    let mut result = UsageSyncResult::default();
    let Some(home) = paths::home_dir() else {
        return result;
    };

    // Claude Code：~/.claude/projects/**/*.jsonl（含子代理目录）
    let mut claude_files = Vec::new();
    collect_jsonl(&home.join(".claude").join("projects"), 6, &mut claude_files);

    // Codex：~/.codex/sessions/YYYY/MM/DD/*.jsonl + ~/.codex/archived_sessions/*.jsonl
    let codex_root = home.join(".codex");
    let mut codex_files = Vec::new();
    collect_jsonl(&codex_root.join("sessions"), 5, &mut codex_files);
    collect_jsonl(&codex_root.join("archived_sessions"), 2, &mut codex_files);

    for f in &claude_files {
        sync_file(conn, f, &mut result, |p| claude::parse_file(p));
    }
    for f in &codex_files {
        sync_file(conn, f, &mut result, |p| codex::parse_file(p));
    }

    // ZCode：~/.zcode/cli/db/db.sqlite（SQLite 单文件，不走 sync_file/mtime 增量）。
    // 全量读 model_usage，按 record_key="zcode:<id>" 去重插入。
    for rec in zcode::read_records(&zcode::default_db_path(&home)) {
        match usage_repo::insert_record(conn, &rec) {
            Ok(true) => result.imported += 1,
            Ok(false) => {}
            Err(_) => result.errors += 1,
        }
    }
    result
}

/// 单文件同步：mtime 未变化则跳过；否则解析并按 record_key 去重插入。
fn sync_file(
    conn: &Connection,
    path: &Path,
    result: &mut UsageSyncResult,
    parse: impl Fn(&Path) -> Vec<UsageRecord>,
) {
    let path_str = path.to_string_lossy().to_string();
    let mtime = mtime_nanos(path);
    if let Ok(prev) = usage_repo::synced_mtime(conn, &path_str) {
        if prev != 0 && prev >= mtime {
            return; // 文件未变化
        }
    }
    result.files_scanned += 1;
    for rec in parse(path) {
        match usage_repo::insert_record(conn, &rec) {
            Ok(true) => result.imported += 1,
            Ok(false) => {}
            Err(_) => result.errors += 1,
        }
    }
    let _ = usage_repo::set_synced_mtime(conn, &path_str, mtime);
}
