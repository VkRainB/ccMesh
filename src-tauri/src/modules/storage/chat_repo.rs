use rusqlite::{params, Connection, OptionalExtension};

use crate::error::{AppError, AppResult};
use crate::models::chat::{
    BranchMessage, ChatMessage, ChatTopic, CreateChatTopicRequest, UpdateChatTopicRequest,
};

const TOPIC_COLS: &str = "id, title, endpoint_id, model, active_node_id, created_at, updated_at";
const MSG_COLS: &str =
    "id, topic_id, parent_id, role, content, status, compaction_summary, created_at, updated_at";

pub fn root_id(topic_id: &str) -> String {
    format!("root:{topic_id}")
}

fn row_to_topic(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChatTopic> {
    Ok(ChatTopic {
        id: r.get(0)?,
        title: r.get(1)?,
        endpoint_id: r.get(2)?,
        model: r.get(3)?,
        active_node_id: r.get(4)?,
        created_at: r.get(5)?,
        updated_at: r.get(6)?,
    })
}

fn row_to_message(r: &rusqlite::Row<'_>) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: r.get(0)?,
        topic_id: r.get(1)?,
        parent_id: r.get(2)?,
        role: r.get(3)?,
        content: r.get(4)?,
        status: r.get(5)?,
        compaction_summary: r.get(6)?,
        created_at: r.get(7)?,
        updated_at: r.get(8)?,
    })
}

pub fn list_topics(conn: &Connection) -> AppResult<Vec<ChatTopic>> {
    let sql = format!("SELECT {TOPIC_COLS} FROM chat_topics ORDER BY updated_at DESC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_topic)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_topic(conn: &Connection, id: &str) -> AppResult<Option<ChatTopic>> {
    let sql = format!("SELECT {TOPIC_COLS} FROM chat_topics WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_topic).optional()?)
}

pub fn require_topic(conn: &Connection, id: &str) -> AppResult<ChatTopic> {
    get_topic(conn, id)?.ok_or_else(|| AppError::NotFound(format!("会话 {id} 不存在")))
}

pub fn create_topic(
    conn: &Connection,
    id: &str,
    req: &CreateChatTopicRequest,
) -> AppResult<ChatTopic> {
    if req.model.trim().is_empty() {
        return Err(AppError::InvalidArgument("模型不能为空".into()));
    }
    let title = if req.title.trim().is_empty() {
        "新对话".to_string()
    } else {
        req.title.trim().to_string()
    };
    conn.execute(
        "INSERT INTO chat_topics (id, title, endpoint_id, model, active_node_id)
         VALUES (?1, ?2, ?3, ?4, NULL)",
        params![id, title, req.endpoint_id, req.model.trim()],
    )?;
    ensure_root(conn, id)?;
    require_topic(conn, id)
}

pub fn update_topic(
    conn: &Connection,
    id: &str,
    req: &UpdateChatTopicRequest,
) -> AppResult<ChatTopic> {
    let cur = require_topic(conn, id)?;
    let title = req
        .title
        .as_ref()
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or(cur.title);
    let endpoint_id = req.endpoint_id.unwrap_or(cur.endpoint_id);
    let model = req
        .model
        .as_ref()
        .map(|m| m.trim().to_string())
        .filter(|m| !m.is_empty())
        .unwrap_or(cur.model);
    conn.execute(
        "UPDATE chat_topics SET title = ?1, endpoint_id = ?2, model = ?3,
         updated_at = datetime('now') WHERE id = ?4",
        params![title, endpoint_id, model, id],
    )?;
    require_topic(conn, id)
}

pub fn touch_topic(conn: &Connection, id: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE chat_topics SET updated_at = datetime('now') WHERE id = ?1",
        [id],
    )?;
    Ok(())
}

/// 从 `node_id` 沿「最后子节点」走到叶子（切分支时落到该支的最新路径）。
fn resolve_leaf(conn: &Connection, topic_id: &str, node_id: &str) -> AppResult<String> {
    let mut cur = node_id.to_string();
    for _ in 0..10_000 {
        let kids = siblings_of(conn, topic_id, Some(&cur))?;
        let Some(next) = kids.last() else {
            return Ok(cur);
        };
        cur = next.id.clone();
    }
    Err(AppError::Db("消息树过深".into()))
}

pub fn set_active_node(conn: &Connection, topic_id: &str, node_id: &str) -> AppResult<ChatTopic> {
    ensure_topic_tree(conn, topic_id)?;
    let msg = require_message(conn, node_id)?;
    if msg.topic_id != topic_id {
        return Err(AppError::InvalidArgument("消息不属于该会话".into()));
    }
    if msg.role == "root" {
        return Err(AppError::InvalidArgument("不能将虚拟根设为活跃节点".into()));
    }
    let leaf = resolve_leaf(conn, topic_id, node_id)?;
    conn.execute(
        "UPDATE chat_topics SET active_node_id = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![leaf, topic_id],
    )?;
    require_topic(conn, topic_id)
}

pub fn delete_topic(conn: &Connection, id: &str) -> AppResult<()> {
    let n = conn.execute("DELETE FROM chat_topics WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("会话 {id} 不存在")));
    }
    Ok(())
}

fn ensure_root(conn: &Connection, topic_id: &str) -> AppResult<String> {
    let rid = root_id(topic_id);
    let exists: bool = conn
        .query_row("SELECT 1 FROM chat_messages WHERE id = ?1", [&rid], |_| {
            Ok(true)
        })
        .optional()?
        .unwrap_or(false);
    if !exists {
        conn.execute(
            "INSERT INTO chat_messages (id, topic_id, parent_id, role, content, status)
             VALUES (?1, ?2, NULL, 'root', '', 'success')",
            params![rid, topic_id],
        )?;
    }
    Ok(rid)
}

/// 将旧扁平消息回填为线性树，并保证存在虚拟根。
pub fn ensure_topic_tree(conn: &Connection, topic_id: &str) -> AppResult<()> {
    let _ = require_topic(conn, topic_id)?;
    let rid = ensure_root(conn, topic_id)?;

    let sql = format!(
        "SELECT {MSG_COLS} FROM chat_messages
         WHERE topic_id = ?1 AND role != 'root'
         ORDER BY created_at ASC, rowid ASC"
    );
    let mut stmt = conn.prepare(&sql)?;
    let msgs: Vec<ChatMessage> = stmt
        .query_map([topic_id], row_to_message)?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut prev = rid.clone();
    for m in &msgs {
        if m.parent_id.is_none() {
            conn.execute(
                "UPDATE chat_messages SET parent_id = ?1 WHERE id = ?2",
                params![prev, m.id],
            )?;
            prev = m.id.clone();
        } else {
            prev = m.id.clone();
        }
    }

    let topic = require_topic(conn, topic_id)?;
    if topic.active_node_id.is_none() {
        if let Some(last) = msgs.last() {
            conn.execute(
                "UPDATE chat_topics SET active_node_id = ?1 WHERE id = ?2",
                params![last.id, topic_id],
            )?;
        }
    }
    Ok(())
}

pub fn get_message(conn: &Connection, id: &str) -> AppResult<Option<ChatMessage>> {
    let sql = format!("SELECT {MSG_COLS} FROM chat_messages WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_message).optional()?)
}

pub fn require_message(conn: &Connection, id: &str) -> AppResult<ChatMessage> {
    get_message(conn, id)?.ok_or_else(|| AppError::NotFound(format!("消息 {id} 不存在")))
}

pub fn insert_message(
    conn: &Connection,
    id: &str,
    topic_id: &str,
    parent_id: Option<&str>,
    role: &str,
    content: &str,
    status: &str,
) -> AppResult<ChatMessage> {
    conn.execute(
        "INSERT INTO chat_messages (id, topic_id, parent_id, role, content, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![id, topic_id, parent_id, role, content, status],
    )?;
    require_message(conn, id)
}

pub fn update_message_content(
    conn: &Connection,
    id: &str,
    content: &str,
    status: &str,
) -> AppResult<()> {
    conn.execute(
        "UPDATE chat_messages SET content = ?1, status = ?2, updated_at = datetime('now')
         WHERE id = ?3",
        params![content, status, id],
    )?;
    Ok(())
}

pub fn set_compaction_summary(conn: &Connection, id: &str, summary: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE chat_messages SET compaction_summary = ?1, updated_at = datetime('now')
         WHERE id = ?2",
        params![summary, id],
    )?;
    Ok(())
}

/// 从 node 到根的路径（不含虚拟根），顺序：根侧 → 叶。
pub fn path_to_node(
    conn: &Connection,
    topic_id: &str,
    node_id: &str,
) -> AppResult<Vec<ChatMessage>> {
    let mut rows = Vec::new();
    let mut cur = Some(node_id.to_string());
    let mut guard = 0;
    while let Some(id) = cur {
        guard += 1;
        if guard > 10_000 {
            return Err(AppError::Db("消息树路径过深或成环".into()));
        }
        let msg = require_message(conn, &id)?;
        if msg.topic_id != topic_id {
            return Err(AppError::InvalidArgument("路径跨会话".into()));
        }
        if msg.role == "root" {
            break;
        }
        cur = msg.parent_id.clone();
        rows.push(msg);
    }
    rows.reverse();
    Ok(rows)
}

fn siblings_of(
    conn: &Connection,
    topic_id: &str,
    parent_id: Option<&str>,
) -> AppResult<Vec<ChatMessage>> {
    let sql = if parent_id.is_some() {
        format!(
            "SELECT {MSG_COLS} FROM chat_messages
             WHERE topic_id = ?1 AND parent_id = ?2
             ORDER BY created_at ASC, rowid ASC"
        )
    } else {
        format!(
            "SELECT {MSG_COLS} FROM chat_messages
             WHERE topic_id = ?1 AND parent_id IS NULL
             ORDER BY created_at ASC, rowid ASC"
        )
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = if let Some(pid) = parent_id {
        stmt.query_map(params![topic_id, pid], row_to_message)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        stmt.query_map(params![topic_id], row_to_message)?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    Ok(rows)
}

/// 活跃分支消息（含 sibling 元数据）。
pub fn list_branch_messages(conn: &Connection, topic_id: &str) -> AppResult<Vec<BranchMessage>> {
    ensure_topic_tree(conn, topic_id)?;
    let topic = require_topic(conn, topic_id)?;
    let Some(active) = topic.active_node_id.clone() else {
        return Ok(Vec::new());
    };
    let path = path_to_node(conn, topic_id, &active)?;
    let mut out = Vec::with_capacity(path.len());
    for m in path {
        let sibs = siblings_of(conn, topic_id, m.parent_id.as_deref())?;
        let idx = sibs.iter().position(|s| s.id == m.id).unwrap_or(0) as i64;
        let count = sibs.len() as i64;
        let sibling_ids = sibs.iter().map(|s| s.id.clone()).collect();
        out.push(BranchMessage {
            message: m,
            sibling_index: idx,
            sibling_count: count.max(1),
            sibling_ids,
        });
    }
    Ok(out)
}

/// 供上游 API 的角色/内容对：活跃路径，并应用最深 compaction_summary。
pub fn history_for_api(conn: &Connection, topic_id: &str) -> AppResult<Vec<(String, String)>> {
    ensure_topic_tree(conn, topic_id)?;
    let topic = require_topic(conn, topic_id)?;
    let Some(active) = topic.active_node_id else {
        return Ok(Vec::new());
    };
    let path = path_to_node(conn, topic_id, &active)?;
    let mut fold_at: Option<usize> = None;
    let mut summary = String::new();
    for (i, m) in path.iter().enumerate() {
        if let Some(s) = m
            .compaction_summary
            .as_ref()
            .filter(|s| !s.trim().is_empty())
        {
            fold_at = Some(i);
            summary = s.clone();
        }
    }
    let start = fold_at.map(|i| i + 1).unwrap_or(0);
    let mut out = Vec::new();
    if fold_at.is_some() {
        out.push(("user".to_string(), format!("[对话早期摘要]\n{summary}")));
        out.push((
            "assistant".to_string(),
            "好的，我会基于该摘要继续对话。".to_string(),
        ));
    }
    for m in path.into_iter().skip(start) {
        if m.role != "user" && m.role != "assistant" {
            continue;
        }
        if m.status != "success" && m.status != "streaming" && m.status != "pending" {
            continue;
        }
        if m.role == "assistant" && m.content.is_empty() && m.status != "success" {
            continue;
        }
        if m.content.is_empty() {
            continue;
        }
        out.push((m.role, m.content));
    }
    Ok(out)
}

/// 活跃路径上的完整消息（含空 assistant 占位过滤前），供压缩规划。
pub fn path_messages_for_compact(conn: &Connection, topic_id: &str) -> AppResult<Vec<ChatMessage>> {
    ensure_topic_tree(conn, topic_id)?;
    let topic = require_topic(conn, topic_id)?;
    let Some(active) = topic.active_node_id else {
        return Ok(Vec::new());
    };
    path_to_node(conn, topic_id, &active)
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
    fn topic_message_cascade_and_root() {
        let c = db();
        create_topic(
            &c,
            "t1",
            &CreateChatTopicRequest {
                title: "hello".into(),
                endpoint_id: 1,
                model: "gpt-4o".into(),
            },
        )
        .unwrap();
        let rid = root_id("t1");
        assert!(get_message(&c, &rid).unwrap().is_some());
        let u = insert_message(&c, "m1", "t1", Some(&rid), "user", "hi", "success").unwrap();
        let a = insert_message(&c, "m2", "t1", Some(&u.id), "assistant", "yo", "success").unwrap();
        set_active_node(&c, "t1", &a.id).unwrap();
        let branch = list_branch_messages(&c, "t1").unwrap();
        assert_eq!(branch.len(), 2);
        assert_eq!(branch[0].message.role, "user");
        delete_topic(&c, "t1").unwrap();
        assert!(list_topics(&c).unwrap().is_empty());
    }

    #[test]
    fn regenerate_siblings() {
        let c = db();
        create_topic(
            &c,
            "t1",
            &CreateChatTopicRequest {
                title: "".into(),
                endpoint_id: 1,
                model: "m".into(),
            },
        )
        .unwrap();
        let rid = root_id("t1");
        let u = insert_message(&c, "u1", "t1", Some(&rid), "user", "q", "success").unwrap();
        let a1 = insert_message(&c, "a1", "t1", Some(&u.id), "assistant", "r1", "success").unwrap();
        let a2 = insert_message(&c, "a2", "t1", Some(&u.id), "assistant", "r2", "success").unwrap();
        set_active_node(&c, "t1", &a1.id).unwrap();
        let b1 = list_branch_messages(&c, "t1").unwrap();
        assert_eq!(b1.last().unwrap().sibling_count, 2);
        assert_eq!(b1.last().unwrap().sibling_index, 0);
        set_active_node(&c, "t1", &a2.id).unwrap();
        let b2 = list_branch_messages(&c, "t1").unwrap();
        assert_eq!(b2.last().unwrap().sibling_index, 1);
    }

    #[test]
    fn backfill_flat_messages() {
        let c = db();
        // 模拟 v15 扁平插入（绕过 create_topic 的 root）
        c.execute(
            "INSERT INTO chat_topics (id, title, endpoint_id, model) VALUES ('t1','x',1,'m')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO chat_messages (id, topic_id, role, content, status)
             VALUES ('m1','t1','user','hi','success')",
            [],
        )
        .unwrap();
        c.execute(
            "INSERT INTO chat_messages (id, topic_id, role, content, status)
             VALUES ('m2','t1','assistant','yo','success')",
            [],
        )
        .unwrap();
        ensure_topic_tree(&c, "t1").unwrap();
        let path = path_to_node(&c, "t1", "m2").unwrap();
        assert_eq!(path.len(), 2);
        assert_eq!(path[0].parent_id.as_deref(), Some(root_id("t1").as_str()));
        assert_eq!(path[1].parent_id.as_deref(), Some("m1"));
    }
}
