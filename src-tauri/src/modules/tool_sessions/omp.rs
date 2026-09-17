//! omp（oh-my-pi）本机会话 provider。
//!
//! 与 pi 同源（omp 由 pi-mono fork），会话 JSONL 格式互通：version=3，
//! 布局 `~/.omp/agent/sessions/<slug>/<ISO时间戳>_<sessionId>.jsonl`。差异仅在标题来源：
//! omp 首行有固定 `type:"title"` 槽（pad 到 256B，serde_json 天然忽略 padding），
//! 并在文件中追加 `type:"title_change"` 条目记录标题演进。标题回退链：
//! `title_change(source==user)` → `title` 槽 → `session` 头 `title` → 首条 user 消息 → 目录 basename。

use std::path::{Path, PathBuf};

use crate::modules::tool_sessions::{SessionMessage, SessionMeta};
use crate::utils::paths::omp_sessions_dir;

use super::utils::{
    collect_jsonl_files, delete_pi_omp_session, infer_pi_omp_session_id_from_filename,
    load_pi_omp_messages, parse_pi_omp_scan_fields, path_basename, read_head_tail_lines,
    truncate_summary, TITLE_MAX_CHARS,
};

const PROVIDER_ID: &str = "omp";

pub fn session_roots() -> Vec<PathBuf> {
    omp_sessions_dir().into_iter().collect()
}

pub fn scan_sessions() -> Vec<SessionMeta> {
    let roots = session_roots();
    let mut files = Vec::new();
    for root in &roots {
        collect_jsonl_files(root, &mut files);
    }
    let mut sessions = Vec::new();
    for path in files {
        if let Some(meta) = parse_session(&path) {
            sessions.push(meta);
        }
    }
    sessions
}

pub fn load_messages(path: &Path) -> Result<Vec<SessionMessage>, String> {
    load_pi_omp_messages(path)
}

pub fn delete_session(_root: &Path, path: &Path, session_id: &str) -> Result<bool, String> {
    delete_pi_omp_session("omp", path, session_id)
}

fn parse_session(path: &Path) -> Option<SessionMeta> {
    let (head, tail) = read_head_tail_lines(path, 80, 80).ok()?;
    let fields = parse_pi_omp_scan_fields(&head, &tail);

    let session_id = fields
        .session_id
        .or_else(|| infer_pi_omp_session_id_from_filename(path))?;
    let project_dir = fields.project_dir;
    let created_at = fields.created_at;

    // omp 标题回退链：用户重命名 title_change → title 槽 → session 头 title → 首条 user → basename
    let title = fields
        .user_title_change
        .as_deref()
        .map(|t| truncate_summary(t, TITLE_MAX_CHARS))
        .or_else(|| {
            fields
                .title_slot
                .as_deref()
                .map(|t| truncate_summary(t, TITLE_MAX_CHARS))
        })
        .or_else(|| {
            fields
                .session_title
                .as_deref()
                .map(|t| truncate_summary(t, TITLE_MAX_CHARS))
        })
        .or_else(|| {
            fields
                .first_user_message
                .as_deref()
                .map(|t| truncate_summary(t, TITLE_MAX_CHARS))
        })
        .or_else(|| {
            project_dir
                .as_deref()
                .and_then(path_basename)
                .map(|v| v.to_string())
        });

    let summary = fields.summary.map(|text| truncate_summary(&text, 160));
    let last_active_at = fields.last_active_at;

    Some(SessionMeta {
        provider_id: PROVIDER_ID.to_string(),
        session_id: session_id.clone(),
        title,
        summary,
        project_dir,
        created_at,
        last_active_at,
        source_path: Some(path.to_string_lossy().to_string()),
        resume_command: Some(format!("omp --session {}", path.display())),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn title_slot_line(title: &str) -> String {
        // omp title 槽：pad 字段填空格到固定宽度，serde_json 解析时忽略 padding 只取 title。
        serde_json::json!({
            "type": "title",
            "v": 1,
            "title": title,
            "source": "auto",
            "updatedAt": "2026-08-27T00:48:12.532Z",
            "pad": " ".repeat(50)
        })
        .to_string()
    }

    fn session_line(id: &str, cwd: &str, title: Option<&str>) -> String {
        let mut value = serde_json::json!({
            "type": "session",
            "version": 3,
            "id": id,
            "timestamp": "2026-08-27T00:44:52.410Z",
            "cwd": cwd
        });
        if let Some(t) = title {
            value["title"] = serde_json::json!(t);
            value["titleSource"] = serde_json::json!("auto");
        }
        value.to_string()
    }

    fn user_message(text: &str) -> String {
        serde_json::json!({
            "type": "message",
            "id": "0739ef42",
            "parentId": null,
            "timestamp": "2026-08-27T00:46:04.599Z",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": text}],
                "timestamp": 1787791562698i64
            }
        })
        .to_string()
    }

    fn title_change_line(title: &str, source: &str) -> String {
        serde_json::json!({
            "type": "title_change",
            "id": "f666180b",
            "parentId": null,
            "timestamp": "2026-08-27T00:48:12.532Z",
            "title": title,
            "source": source,
            "trigger": "replan"
        })
        .to_string()
    }

    fn write_session(path: &Path, content: impl AsRef<str>) {
        std::fs::write(path, content.as_ref()).expect("write session");
    }

    #[test]
    fn parse_session_prefers_title_slot_over_session_header_and_user() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        write_session(
            &path,
            format!(
                "{}\n{}\n{}\n",
                title_slot_line("槽标题"),
                session_line(
                    "01a040ad-453a-7000-8c6e-62819e673c58",
                    "C:\\proj",
                    Some("头标题")
                ),
                user_message("首条用户消息")
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.provider_id, "omp");
        assert_eq!(meta.title.as_deref(), Some("槽标题"));
        assert!(meta
            .resume_command
            .as_deref()
            .unwrap()
            .contains("omp --session"));
    }

    #[test]
    fn parse_session_user_title_change_overrides_title_slot() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        write_session(
            &path,
            format!(
                "{}\n{}\n{}\n{}\n",
                title_slot_line("槽标题"),
                session_line("01a040ad-453a-7000-8c6e-62819e673c58", "C:\\proj", None),
                user_message("首条用户消息"),
                title_change_line("用户重命名", "user")
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("用户重命名"));
    }

    #[test]
    fn parse_session_ignores_auto_title_change_when_no_user_title_change() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        // auto title_change 不应覆盖 title 槽（槽由 auto 同步保持一致）
        write_session(
            &path,
            format!(
                "{}\n{}\n{}\n",
                title_slot_line("槽标题"),
                session_line("01a040ad-453a-7000-8c6e-62819e673c58", "C:\\proj", None),
                title_change_line("自动演进标题", "auto")
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("槽标题"));
    }

    #[test]
    fn parse_session_falls_back_to_session_header_title() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        // 无 title 槽、无 title_change → 用 session 头 title
        write_session(
            &path,
            format!(
                "{}\n{}\n",
                session_line(
                    "01a040ad-453a-7000-8c6e-62819e673c58",
                    "C:\\proj",
                    Some("头标题")
                ),
                user_message("首条用户消息")
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("头标题"));
    }

    #[test]
    fn parse_session_falls_back_to_first_user_message() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        // 无任何标题槽/字段 → 首条 user 消息
        write_session(
            &path,
            format!(
                "{}\n{}\n",
                session_line("01a040ad-453a-7000-8c6e-62819e673c58", "C:\\proj", None),
                user_message("首条用户消息作为标题")
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("首条用户消息作为标题"));
    }

    #[test]
    fn parse_session_falls_back_to_dir_basename() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        write_session(
            &path,
            format!(
                "{}\n",
                session_line(
                    "01a040ad-453a-7000-8c6e-62819e673c58",
                    "C:\\work\\my-project",
                    None
                )
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("my-project"));
    }

    #[test]
    fn parse_session_tolerates_padded_title_slot() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        // pad 字段超长也不应破坏 JSON 解析
        let slot = serde_json::json!({
            "type": "title",
            "v": 1,
            "title": "带 padding 的标题",
            "source": "auto",
            "updatedAt": "2026-08-27T00:48:12.532Z",
            "pad": " ".repeat(200)
        })
        .to_string();
        write_session(
            &path,
            format!(
                "{}\n{}\n",
                slot,
                session_line("01a040ad-453a-7000-8c6e-62819e673c58", "C:\\proj", None)
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("带 padding 的标题"));
    }

    #[test]
    fn delete_session_removes_jsonl_and_sidecar_directory() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        let sidecar = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58");
        std::fs::create_dir_all(&sidecar).expect("sidecar dir");
        std::fs::write(sidecar.join("bash.log"), "log").expect("bash log");
        write_session(
            &path,
            format!(
                "{}\n{}\n",
                title_slot_line("标题"),
                session_line("01a040ad-453a-7000-8c6e-62819e673c58", "C:\\proj", None)
            ),
        );

        delete_session(temp.path(), &path, "01a040ad-453a-7000-8c6e-62819e673c58")
            .expect("delete session");

        assert!(!path.exists());
        assert!(!sidecar.exists());
    }

    #[test]
    fn delete_session_rejects_id_mismatch() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-08-27T00-44-52-410Z_01a040ad-453a-7000-8c6e-62819e673c58.jsonl");
        write_session(
            &path,
            format!(
                "{}\n{}\n",
                title_slot_line("标题"),
                session_line("01a040ad-453a-7000-8c6e-62819e673c58", "C:\\proj", None)
            ),
        );

        let err = delete_session(temp.path(), &path, "wrong-id").expect_err("mismatch");
        assert!(err.contains("session ID mismatch"));
        assert!(path.exists());
    }
}
