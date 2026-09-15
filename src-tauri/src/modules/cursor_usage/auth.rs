//! 从本机 Cursor `state.vscdb` 只读取出登录 JWT。

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;

use crate::error::{AppError, AppResult};

const AUTH_KEYS: &[&str] = &[
    "cursorAuth/accessToken",
    "cursorAuth/refreshToken",
    "cursorAuth/cachedEmail",
];

#[derive(Debug, Clone)]
pub struct AuthTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub email: Option<String>,
}

/// 各平台可能的 `state.vscdb` 路径（去重保序）。
pub fn candidate_db_paths() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let mut push = |p: PathBuf| {
        if !out.iter().any(|x| x == &p) {
            out.push(p);
        }
    };

    if let Some(config) = dirs::config_dir() {
        push(
            config
                .join("Cursor")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb"),
        );
        push(
            config
                .join("Cursor - Insiders")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb"),
        );
        push(
            config
                .join("cursor")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb"),
        );
    }

    if let Some(local) = dirs::data_local_dir() {
        push(
            local
                .join("Cursor")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb"),
        );
        push(
            local
                .join("Programs")
                .join("Cursor")
                .join("User")
                .join("globalStorage")
                .join("state.vscdb"),
        );
    }

    // WSL 挂载的 Windows 用户目录
    for base in ["/mnt/c/Users", "/mnt/d/Users"] {
        let root = PathBuf::from(base);
        if root.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&root) {
                for ent in entries.flatten() {
                    push(
                        ent.path()
                            .join("AppData")
                            .join("Roaming")
                            .join("Cursor")
                            .join("User")
                            .join("globalStorage")
                            .join("state.vscdb"),
                    );
                }
            }
        }
    }

    out
}

pub fn find_db() -> AppResult<PathBuf> {
    candidate_db_paths()
        .into_iter()
        .find(|p| p.is_file())
        .ok_or_else(|| {
            AppError::NotFound(
                "找不到 Cursor 数据库 state.vscdb，请先安装并登录 Cursor 桌面端。".into(),
            )
        })
}

fn open_readonly(path: &Path) -> rusqlite::Result<Connection> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(path, flags)?;
    let _ = conn.busy_timeout(Duration::from_secs(2));
    Ok(conn)
}

fn open_immutable_uri(path: &Path) -> rusqlite::Result<Connection> {
    let raw = path.to_string_lossy().replace('\\', "/");
    let encoded = raw.replace(' ', "%20").replace('#', "%23");
    let uri = format!("file:{encoded}?mode=ro&immutable=1");
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_URI
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let conn = Connection::open_with_flags(uri, flags)?;
    let _ = conn.busy_timeout(Duration::from_secs(2));
    Ok(conn)
}

fn query_auth_keys(conn: &Connection) -> rusqlite::Result<Vec<(String, String)>> {
    let mut stmt = conn.prepare("SELECT key, value FROM ItemTable WHERE key IN (?1, ?2, ?3)")?;
    let rows = stmt.query_map(
        rusqlite::params![AUTH_KEYS[0], AUTH_KEYS[1], AUTH_KEYS[2]],
        |r| {
            let key: String = r.get(0)?;
            let value: String = match r.get_ref(1)? {
                rusqlite::types::ValueRef::Text(t) => String::from_utf8_lossy(t).into_owned(),
                rusqlite::types::ValueRef::Blob(b) => String::from_utf8_lossy(b).into_owned(),
                rusqlite::types::ValueRef::Integer(i) => i.to_string(),
                rusqlite::types::ValueRef::Real(f) => f.to_string(),
                rusqlite::types::ValueRef::Null => String::new(),
            };
            Ok((key, value))
        },
    )?;
    rows.collect()
}

fn parse_stored_value(v: &str) -> String {
    let t = v.trim();
    if t.starts_with('"') {
        if let Ok(s) = serde_json::from_str::<String>(t) {
            return s;
        }
    }
    t.to_string()
}

pub fn read_auth(db_path: &Path) -> AppResult<AuthTokens> {
    let rows = match open_readonly(db_path).and_then(|c| query_auth_keys(&c)) {
        Ok(rows) => rows,
        Err(e) => {
            tracing::debug!("只读打开 Cursor DB 失败，尝试 immutable: {e}");
            let conn = open_immutable_uri(db_path).map_err(|e2| {
                AppError::Db(format!(
                    "无法读取 Cursor 数据库: {e}; immutable 亦失败: {e2}"
                ))
            })?;
            query_auth_keys(&conn)?
        }
    };

    let mut access = None;
    let mut refresh = None;
    let mut email = None;
    for (k, v) in rows {
        let cleaned = parse_stored_value(&v);
        match k.as_str() {
            "cursorAuth/accessToken" => access = Some(cleaned),
            "cursorAuth/refreshToken" => refresh = Some(cleaned),
            "cursorAuth/cachedEmail" => email = Some(cleaned),
            _ => {}
        }
    }

    let access_token = access.filter(|s| looks_like_jwt(s)).ok_or_else(|| {
        AppError::NotFound("数据库中没有有效的 accessToken，请先在 Cursor 桌面端登录。".into())
    })?;

    Ok(AuthTokens {
        access_token,
        refresh_token: refresh.filter(|s| !s.is_empty()),
        email: email.filter(|s| !s.is_empty()),
    })
}

pub fn looks_like_jwt(tok: &str) -> bool {
    tok.matches('.').count() == 2 && tok.len() > 40
}

pub fn jwt_payload(token: &str) -> Value {
    let Some(payload) = token.split('.').nth(1) else {
        return Value::Null;
    };
    let Ok(bytes) = URL_SAFE_NO_PAD.decode(payload) else {
        return Value::Null;
    };
    serde_json::from_slice(&bytes).unwrap_or(Value::Null)
}

pub fn is_expired(token: &str, skew_sec: i64) -> bool {
    let payload = jwt_payload(token);
    let exp = payload
        .get("exp")
        .and_then(|v| v.as_i64().or_else(|| v.as_f64().map(|f| f as i64)))
        .unwrap_or(0);
    if exp <= 0 {
        return false;
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    now >= exp - skew_sec
}

/// `WorkosCursorSessionToken=<userId>%3A%3A<accessToken>`
pub fn session_cookie(access_token: &str) -> Option<String> {
    let payload = jwt_payload(access_token);
    let sub = payload.get("sub")?.as_str().filter(|s| !s.is_empty())?;
    let user_id = sub.rsplit('|').next().unwrap_or(sub);
    if user_id.is_empty() {
        return None;
    }
    Some(format!(
        "WorkosCursorSessionToken={user_id}%3A%3A{access_token}"
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::URL_SAFE_NO_PAD;
    use serde_json::json;

    fn jwt_with(payload: &Value) -> String {
        let body = URL_SAFE_NO_PAD.encode(payload.to_string().as_bytes());
        format!("eyJhbGciOiJub25lIn0.{body}.sig")
    }

    #[test]
    fn candidate_paths_include_cursor_vscdb() {
        let paths = candidate_db_paths();
        assert!(
            paths
                .iter()
                .any(|p| p.ends_with("state.vscdb") && p.to_string_lossy().contains("Cursor")),
            "expected Cursor/state.vscdb in {paths:?}"
        );
    }

    #[test]
    fn parse_stored_strips_json_quotes() {
        assert_eq!(parse_stored_value("\"abc\""), "abc");
        assert_eq!(parse_stored_value(" abc "), "abc");
    }

    #[test]
    fn jwt_payload_and_expiry() {
        let future = jwt_with(&json!({"sub":"auth0|user_abc","exp": 4_000_000_000i64}));
        assert!(!is_expired(&future, 60));
        let past = jwt_with(&json!({"sub":"auth0|user_abc","exp": 1}));
        assert!(is_expired(&past, 60));
        let no_exp = jwt_with(&json!({"sub":"x"}));
        assert!(!is_expired(&no_exp, 60));
    }

    #[test]
    fn session_cookie_uses_sub_suffix() {
        let tok = jwt_with(&json!({"sub":"auth0|user_xyz"}));
        let ck = session_cookie(&tok).unwrap();
        assert!(ck.starts_with("WorkosCursorSessionToken=user_xyz%3A%3A"));
        assert!(ck.ends_with(&tok));
    }

    #[test]
    fn looks_like_jwt_rejects_short() {
        assert!(!looks_like_jwt("not-a-jwt"));
        let tok = jwt_with(&json!({"sub":"auth0|user_long_enough_for_jwt_check"}));
        assert!(looks_like_jwt(&tok));
    }
}
