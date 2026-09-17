//! pi（earendil-works/pi）本机会话 provider。
//!
//! 会话布局：`~/.pi/agent/sessions/<slug>/<ISO时间戳>_<sessionId>.jsonl`，
//! JSONL version=3。标题取首条 user 消息（截 80），与 ai-toolbox `pi.rs` 对齐。
//! 解析/删除链路与 omp 共享 [`super::utils`] 中的 pi/omp 助手。

use std::path::{Path, PathBuf};

use crate::modules::tool_sessions::{SessionMessage, SessionMeta};
use crate::utils::paths::pi_sessions_dir;

use super::utils::{
    collect_jsonl_files, delete_pi_omp_session, infer_pi_omp_session_id_from_filename,
    load_pi_omp_messages, parse_pi_omp_scan_fields, path_basename, read_head_tail_lines,
    truncate_summary, TITLE_MAX_CHARS,
};

const PROVIDER_ID: &str = "pi";

pub fn session_roots() -> Vec<PathBuf> {
    pi_sessions_dir().into_iter().collect()
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
    delete_pi_omp_session("pi", path, session_id)
}

fn parse_session(path: &Path) -> Option<SessionMeta> {
    let (head, tail) = read_head_tail_lines(path, 80, 80).ok()?;
    let fields = parse_pi_omp_scan_fields(&head, &tail);

    let session_id = fields
        .session_id
        .or_else(|| infer_pi_omp_session_id_from_filename(path))?;
    let project_dir = fields.project_dir;
    let created_at = fields.created_at;

    // pi 无 title 槽：首条 user 消息 → 项目目录 basename
    let title = fields
        .first_user_message
        .as_deref()
        .map(|t| truncate_summary(t, TITLE_MAX_CHARS))
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
        resume_command: Some(format!("pi --session {}", path.display())),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// 构造一个最小 version=3 pi 会话样本：session 头 + user text + assistant text/toolCall
    /// + thinking + toolResult。
    const PI_SAMPLE: &str = concat!(
        r#"{"type":"session","version":3,"id":"019f1847-e572-7261-85c1-f3fac09447c5","timestamp":"2026-06-30T11:26:32.818Z","cwd":"C:\\Users\\Administrator\\projects\\demo"}"#,
        "\n",
        r#"{"type":"message","id":"9b780865","parentId":null,"timestamp":"2026-06-30T11:26:54.019Z","message":{"role":"user","content":[{"type":"text","text":"帮我重构这个函数"}],"timestamp":1782818814014}}"#,
        "\n",
        r#"{"type":"message","id":"a6a3fc67","parentId":"9b780865","timestamp":"2026-06-30T11:26:56.812Z","message":{"role":"assistant","content":[{"type":"thinking","thinking":"先分析再动手"},{"type":"text","text":"好的，我来处理"},{"type":"toolCall","id":"call_1","name":"bash","arguments":{}}],"timestamp":1782818814325}}"#,
        "\n",
        r#"{"type":"message","id":"b7c1d988","parentId":"a6a3fc67","timestamp":"2026-06-30T11:27:00.000Z","message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","content":[{"type":"text","text":"done"}],"timestamp":1782818820000}}"#
    );

    fn write_session(path: &Path, content: impl AsRef<str>) {
        std::fs::write(path, content.as_ref()).expect("write session");
    }

    #[test]
    fn parse_session_uses_first_user_message_as_title() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-06-30T11-26-32-818Z_019f1847-e572-7261-85c1-f3fac09447c5.jsonl");
        write_session(&path, PI_SAMPLE);

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.provider_id, "pi");
        assert_eq!(meta.session_id, "019f1847-e572-7261-85c1-f3fac09447c5");
        assert_eq!(meta.title.as_deref(), Some("帮我重构这个函数"));
        assert_eq!(
            meta.project_dir.as_deref(),
            Some("C:\\Users\\Administrator\\projects\\demo")
        );
        assert!(meta.created_at.is_some());
        assert!(meta.last_active_at.is_some());
        // 末条 toolResult 时间晚于 session 创建时间
        assert!(meta.last_active_at.unwrap() >= meta.created_at.unwrap());
        assert!(meta
            .resume_command
            .as_deref()
            .unwrap()
            .contains("pi --session"));
    }

    #[test]
    fn parse_session_falls_back_to_dir_basename_without_user_message() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-06-30T11-26-32-818Z_019f1847-aaaa-bbbb-cccc-dddddddddddd.jsonl");
        write_session(
            &path,
            concat!(
                r#"{"type":"session","version":3,"id":"019f1847-aaaa-bbbb-cccc-dddddddddddd","timestamp":"2026-06-30T11:26:32.818Z","cwd":"C:\\work\\my-project"}"#,
                "\n",
                r#"{"type":"message","id":"a6a3fc67","parentId":null,"timestamp":"2026-06-30T11:26:56.812Z","message":{"role":"assistant","content":[{"type":"text","text":"Hello"}],"timestamp":1782818814325}}"#
            ),
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.title.as_deref(), Some("my-project"));
    }

    #[test]
    fn parse_session_infers_id_from_filename_when_header_missing() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-06-30T11-26-32-818Z_01a08a18-aaaa-bbbb-cccc-dddddddddddd.jsonl");
        // 没有 session 头，仅一条 user 消息
        write_session(
            &path,
            r#"{"type":"message","id":"9b780865","parentId":null,"timestamp":"2026-06-30T11:26:54.019Z","message":{"role":"user","content":[{"type":"text","text":"hi"}],"timestamp":1782818814014}}"#,
        );

        let meta = parse_session(&path).unwrap();
        assert_eq!(meta.session_id, "01a08a18-aaaa-bbbb-cccc-dddddddddddd");
    }

    #[test]
    fn load_messages_maps_roles_and_skips_thinking() {
        let temp = tempdir().expect("tempdir");
        let path = temp.path().join("session.jsonl");
        write_session(&path, PI_SAMPLE);

        let msgs = load_messages(&path).expect("load");
        // user / assistant(text+toolCall) / toolResult —— thinking 不混入正文
        assert_eq!(msgs.len(), 3);
        assert_eq!(msgs[0].role, "user");
        assert_eq!(msgs[0].content, "帮我重构这个函数");
        assert_eq!(msgs[1].role, "assistant");
        assert!(msgs[1].content.contains("好的，我来处理"));
        assert!(msgs[1].content.contains("[Tool: bash]"));
        assert!(!msgs[1].content.contains("先分析再动手")); // thinking 被跳过
        assert_eq!(msgs[2].role, "tool");
        assert_eq!(msgs[2].content, "done");
        assert_eq!(msgs[2].ts, Some(1782818820000));
    }

    #[test]
    fn delete_session_removes_jsonl_and_sidecar_directory() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-06-30T11-26-32-818Z_019f1847-e572-7261-85c1-f3fac09447c5.jsonl");
        let sidecar = temp
            .path()
            .join("2026-06-30T11-26-32-818Z_019f1847-e572-7261-85c1-f3fac09447c5");
        std::fs::create_dir_all(&sidecar).expect("sidecar dir");
        std::fs::write(sidecar.join("bash.log"), "log").expect("bash log");
        write_session(&path, PI_SAMPLE);

        delete_session(temp.path(), &path, "019f1847-e572-7261-85c1-f3fac09447c5")
            .expect("delete session");

        assert!(!path.exists());
        assert!(!sidecar.exists());
    }

    #[test]
    fn delete_session_rejects_id_mismatch() {
        let temp = tempdir().expect("tempdir");
        let path = temp
            .path()
            .join("2026-06-30T11-26-32-818Z_019f1847-e572-7261-85c1-f3fac09447c5.jsonl");
        write_session(&path, PI_SAMPLE);

        let err = delete_session(temp.path(), &path, "wrong-id").expect_err("mismatch");
        assert!(err.contains("session ID mismatch"));
        assert!(path.exists()); // 未删除
    }
}
