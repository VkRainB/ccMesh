use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::error::{AppError, AppResult};
use crate::models::endpoint::{CreateEndpointRequest, Endpoint, UpdateEndpointRequest};

const COLS: &str = "id, name, api_url, api_key, auth_mode, enabled, use_proxy, transformer, model, models, model_mappings, remark, sort_order, test_status, created_at, updated_at";

fn row_to_endpoint(row: &Row) -> rusqlite::Result<Endpoint> {
    Ok(Endpoint {
        id: row.get("id")?,
        name: row.get("name")?,
        api_url: row.get("api_url")?,
        api_key: row.get("api_key")?,
        auth_mode: row.get("auth_mode")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        use_proxy: row.get::<_, i64>("use_proxy")? != 0,
        transformer: row.get("transformer")?,
        model: row.get("model")?,
        models: {
            let s: String = row.get("models")?;
            serde_json::from_str(&s).unwrap_or_default()
        },
        model_mappings: {
            let s: String = row.get("model_mappings")?;
            serde_json::from_str(&s).unwrap_or_default()
        },
        remark: row.get("remark")?,
        sort_order: row.get("sort_order")?,
        test_status: row.get("test_status")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

pub fn list_all(conn: &Connection) -> AppResult<Vec<Endpoint>> {
    let sql = format!("SELECT {COLS} FROM endpoints ORDER BY sort_order ASC, id ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_endpoint)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn list_enabled(conn: &Connection) -> AppResult<Vec<Endpoint>> {
    let sql =
        format!("SELECT {COLS} FROM endpoints WHERE enabled = 1 ORDER BY sort_order ASC, id ASC");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], row_to_endpoint)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn get_by_id(conn: &Connection, id: i64) -> AppResult<Option<Endpoint>> {
    let sql = format!("SELECT {COLS} FROM endpoints WHERE id = ?1");
    Ok(conn.query_row(&sql, [id], row_to_endpoint).optional()?)
}

pub fn get_by_name(conn: &Connection, name: &str) -> AppResult<Option<Endpoint>> {
    let sql = format!("SELECT {COLS} FROM endpoints WHERE name = ?1");
    Ok(conn.query_row(&sql, [name], row_to_endpoint).optional()?)
}

fn require(conn: &Connection, id: i64) -> AppResult<Endpoint> {
    get_by_id(conn, id)?.ok_or_else(|| AppError::NotFound(format!("端点 #{id} 不存在")))
}

pub fn create(conn: &Connection, req: &CreateEndpointRequest) -> AppResult<Endpoint> {
    if req.name.trim().is_empty() {
        return Err(AppError::InvalidArgument("端点名称不能为空".into()));
    }
    if req.api_url.trim().is_empty() {
        return Err(AppError::InvalidArgument("API URL 不能为空".into()));
    }
    if get_by_name(conn, &req.name)?.is_some() {
        return Err(AppError::InvalidArgument(format!(
            "端点名称已存在: {}",
            req.name
        )));
    }

    let next_order: i64 = conn.query_row(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM endpoints",
        [],
        |r| r.get(0),
    )?;

    conn.execute(
        "INSERT INTO endpoints
            (name, api_url, api_key, auth_mode, enabled, use_proxy, transformer, model, models, model_mappings, remark, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            req.name,
            req.api_url,
            req.api_key,
            req.auth_mode,
            req.enabled as i64,
            req.use_proxy as i64,
            req.transformer,
            req.model,
            serde_json::to_string(&req.models).unwrap_or_else(|_| "[]".into()),
            serde_json::to_string(&req.model_mappings).unwrap_or_else(|_| "[]".into()),
            req.remark,
            next_order,
        ],
    )?;
    require(conn, conn.last_insert_rowid())
}

pub fn update(conn: &Connection, id: i64, req: &UpdateEndpointRequest) -> AppResult<Endpoint> {
    let mut e = require(conn, id)?;

    if let Some(ref name) = req.name {
        if name.trim().is_empty() {
            return Err(AppError::InvalidArgument("端点名称不能为空".into()));
        }
        if let Some(other) = get_by_name(conn, name)? {
            if other.id != id {
                return Err(AppError::InvalidArgument(format!("端点名称已存在: {name}")));
            }
        }
        e.name = name.clone();
    }
    if let Some(ref v) = req.api_url {
        e.api_url = v.clone();
    }
    if let Some(ref v) = req.api_key {
        e.api_key = v.clone();
    }
    if let Some(ref v) = req.auth_mode {
        e.auth_mode = v.clone();
    }
    if let Some(v) = req.enabled {
        e.enabled = v;
    }
    if let Some(v) = req.use_proxy {
        e.use_proxy = v;
    }
    if let Some(ref v) = req.transformer {
        e.transformer = v.clone();
    }
    if let Some(ref v) = req.model {
        e.model = v.clone();
    }
    if let Some(ref v) = req.models {
        e.models = v.clone();
    }
    if let Some(ref v) = req.model_mappings {
        e.model_mappings = v.clone();
    }
    if let Some(ref v) = req.remark {
        e.remark = v.clone();
    }

    conn.execute(
        "UPDATE endpoints SET
            name = ?1, api_url = ?2, api_key = ?3, auth_mode = ?4, enabled = ?5,
            use_proxy = ?6, transformer = ?7, model = ?8, models = ?9, model_mappings = ?10,
            remark = ?11, updated_at = datetime('now')
         WHERE id = ?12",
        params![
            e.name,
            e.api_url,
            e.api_key,
            e.auth_mode,
            e.enabled as i64,
            e.use_proxy as i64,
            e.transformer,
            e.model,
            serde_json::to_string(&e.models).unwrap_or_else(|_| "[]".into()),
            serde_json::to_string(&e.model_mappings).unwrap_or_else(|_| "[]".into()),
            e.remark,
            id,
        ],
    )?;
    require(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> AppResult<()> {
    let n = conn.execute("DELETE FROM endpoints WHERE id = ?1", [id])?;
    if n == 0 {
        return Err(AppError::NotFound(format!("端点 #{id} 不存在")));
    }
    Ok(())
}

/// 按给定 id 顺序重写 sort_order（用于拖拽排序持久化）。
pub fn reorder(conn: &mut Connection, ordered_ids: &[i64]) -> AppResult<()> {
    let tx = conn.transaction()?;
    for (idx, id) in ordered_ids.iter().enumerate() {
        tx.execute(
            "UPDATE endpoints SET sort_order = ?1, updated_at = datetime('now') WHERE id = ?2",
            params![idx as i64, id],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 持久化测试状态：available / unavailable / unknown。
pub fn set_test_status(conn: &Connection, id: i64, status: &str) -> AppResult<()> {
    conn.execute(
        "UPDATE endpoints SET test_status = ?1, updated_at = datetime('now') WHERE id = ?2",
        params![status, id],
    )?;
    Ok(())
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

    fn req(name: &str) -> CreateEndpointRequest {
        CreateEndpointRequest {
            name: name.into(),
            api_url: "https://x".into(),
            api_key: String::new(),
            auth_mode: "api_key".into(),
            enabled: true,
            use_proxy: false,
            transformer: "claude".into(),
            model: String::new(),
            models: Vec::new(),
            model_mappings: Vec::new(),
            remark: String::new(),
        }
    }

    fn upd(enabled: Option<bool>) -> UpdateEndpointRequest {
        UpdateEndpointRequest {
            name: None,
            api_url: None,
            api_key: None,
            auth_mode: None,
            enabled,
            use_proxy: None,
            transformer: None,
            model: None,
            models: None,
            model_mappings: None,
            remark: None,
        }
    }

    #[test]
    fn crud_and_list_enabled() {
        let c = db();
        let a = create(&c, &req("a")).unwrap();
        assert!(create(&c, &req("a")).is_err()); // 重名拒绝
        let b = create(&c, &req("b")).unwrap();
        update(&c, b.id, &upd(Some(false))).unwrap();
        assert_eq!(list_all(&c).unwrap().len(), 2);
        assert_eq!(list_enabled(&c).unwrap().len(), 1);
        delete(&c, a.id).unwrap();
        assert_eq!(list_all(&c).unwrap().len(), 1);
    }

    #[test]
    fn reorder_updates_sort_order() {
        let mut c = db();
        let a = create(&c, &req("a")).unwrap();
        let b = create(&c, &req("b")).unwrap();
        reorder(&mut c, &[b.id, a.id]).unwrap();
        let list = list_all(&c).unwrap();
        assert_eq!(list[0].name, "b");
        assert_eq!(list[1].name, "a");
    }

    #[test]
    fn models_and_use_proxy_roundtrip() {
        let c = db();
        let mut r = req("agg");
        r.models = vec!["gpt-5".into(), "deepseek-r1".into()];
        r.use_proxy = true;
        let created = create(&c, &r).unwrap();
        assert_eq!(
            created.models,
            vec!["gpt-5".to_string(), "deepseek-r1".to_string()]
        );
        assert!(created.use_proxy);

        let got = get_by_id(&c, created.id).unwrap().unwrap();
        assert_eq!(
            got.models,
            vec!["gpt-5".to_string(), "deepseek-r1".to_string()]
        );
        assert!(got.use_proxy);

        update(
            &c,
            created.id,
            &UpdateEndpointRequest {
                models: Some(vec![]),
                use_proxy: Some(false),
                ..Default::default()
            },
        )
        .unwrap();
        let got2 = get_by_id(&c, created.id).unwrap().unwrap();
        assert!(got2.models.is_empty());
        assert!(!got2.use_proxy);
    }

    #[test]
    fn model_mappings_roundtrip() {
        use crate::models::endpoint::ModelMapping;
        let c = db();
        let mut r = req("mapped");
        r.models = vec!["claude-opus-4-8".into()];
        r.model_mappings = vec![ModelMapping {
            from: "gpt-5".into(),
            to: "claude-opus-4-8".into(),
        }];
        let created = create(&c, &r).unwrap();
        assert_eq!(created.model_mappings.len(), 1);
        assert_eq!(created.model_mappings[0].from, "gpt-5");
        assert_eq!(created.model_mappings[0].to, "claude-opus-4-8");

        // 旧端点默认空映射
        let bare = create(&c, &req("bare")).unwrap();
        assert!(bare.model_mappings.is_empty());

        // update 覆盖映射
        update(
            &c,
            created.id,
            &UpdateEndpointRequest {
                model_mappings: Some(vec![
                    ModelMapping { from: "a".into(), to: "claude-opus-4-8".into() },
                    ModelMapping { from: "b".into(), to: "claude-opus-4-8".into() },
                ]),
                ..Default::default()
            },
        )
        .unwrap();
        let got = get_by_id(&c, created.id).unwrap().unwrap();
        assert_eq!(got.model_mappings.len(), 2);
    }
}
