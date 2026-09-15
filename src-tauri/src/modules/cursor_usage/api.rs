//! Cursor 官方用量接口（Bearer + Cookie）。

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE, ORIGIN};
use reqwest::Client;
use serde_json::{json, Value};

use super::auth;
use super::metrics::{parse_usage_event, UsageEvent};
use crate::models::cursor_usage::InterfaceStatus;

pub const API_BASE: &str = "https://api2.cursor.sh";
pub const WEB_BASE: &str = "https://cursor.com";
pub const CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
pub const PAGE_SIZE_PRIMARY: u32 = 1000;
pub const PAGE_SIZE_FALLBACK: u32 = 100;
pub const MAX_PAGES: u32 = 32;
pub const FETCH_CONCURRENCY: usize = 4;

pub struct HttpJson {
    pub status: Option<u16>,
    pub body: Value,
}

fn bearer_headers(token: &str) -> HeaderMap {
    let mut h = HeaderMap::new();
    if let Ok(v) = HeaderValue::from_str(&format!("Bearer {token}")) {
        h.insert(AUTHORIZATION, v);
    }
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Ok(v) = HeaderValue::from_str("1") {
        h.insert("Connect-Protocol-Version", v);
    }
    h
}

fn cookie_headers(token: &str) -> Option<HeaderMap> {
    let ck = auth::session_cookie(token)?;
    let mut h = HeaderMap::new();
    h.insert(COOKIE, HeaderValue::from_str(&ck).ok()?);
    h.insert(ORIGIN, HeaderValue::from_static(WEB_BASE));
    h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    h.insert(
        reqwest::header::ACCEPT,
        HeaderValue::from_static("application/json"),
    );
    Some(h)
}

async fn send_json(
    client: &Client,
    method: reqwest::Method,
    url: &str,
    headers: HeaderMap,
    body: Option<Value>,
) -> HttpJson {
    let mut req = client.request(method, url).headers(headers);
    if let Some(b) = body {
        req = req.json(&b);
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let body = match resp.json::<Value>().await {
                Ok(v) => v,
                Err(e) => json!({ "_error": e.to_string() }),
            };
            HttpJson {
                status: Some(status),
                body,
            }
        }
        Err(e) => HttpJson {
            status: None,
            body: json!({ "_error": format!("{e}") }),
        },
    }
}

pub async fn refresh_access_token(client: &Client, refresh_token: &str) -> Option<String> {
    let r = send_json(
        client,
        reqwest::Method::POST,
        &format!("{API_BASE}/oauth/token"),
        {
            let mut h = HeaderMap::new();
            h.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
            h
        },
        Some(json!({
            "grant_type": "refresh_token",
            "client_id": CLIENT_ID,
            "refresh_token": refresh_token,
        })),
    )
    .await;
    if r.status != Some(200) {
        return None;
    }
    if r.body.get("shouldLogout") == Some(&Value::Bool(true)) {
        return None;
    }
    r.body
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

pub async fn get_current_period_usage(client: &Client, token: &str) -> HttpJson {
    send_json(
        client,
        reqwest::Method::POST,
        &format!("{API_BASE}/aiserver.v1.DashboardService/GetCurrentPeriodUsage"),
        bearer_headers(token),
        Some(json!({})),
    )
    .await
}

pub async fn get_plan_info(client: &Client, token: &str) -> HttpJson {
    send_json(
        client,
        reqwest::Method::POST,
        &format!("{API_BASE}/aiserver.v1.DashboardService/GetPlanInfo"),
        bearer_headers(token),
        Some(json!({})),
    )
    .await
}

pub async fn usage_summary(client: &Client, token: &str) -> HttpJson {
    let Some(h) = cookie_headers(token) else {
        return HttpJson {
            status: None,
            body: json!({ "_error": "无法构造会话 Cookie（JWT 缺少 sub）" }),
        };
    };
    send_json(
        client,
        reqwest::Method::GET,
        &format!("{WEB_BASE}/api/usage-summary"),
        h,
        None,
    )
    .await
}

pub async fn dashboard_period(client: &Client, token: &str) -> HttpJson {
    let Some(h) = cookie_headers(token) else {
        return HttpJson {
            status: None,
            body: json!({ "_error": "无法构造会话 Cookie（JWT 缺少 sub）" }),
        };
    };
    send_json(
        client,
        reqwest::Method::POST,
        &format!("{WEB_BASE}/api/dashboard/get-current-period-usage"),
        h,
        Some(json!({})),
    )
    .await
}

fn parse_events_page(body: &Value) -> (Vec<UsageEvent>, i64) {
    let batch = body
        .get("usageEventsDisplay")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let total = body
        .get("totalUsageEventsCount")
        .map(super::metrics::json_i64)
        .unwrap_or(batch.len() as i64);
    let events = batch.iter().filter_map(parse_usage_event).collect();
    (events, total)
}

async fn fetch_events_page(
    client: &Client,
    headers: HeaderMap,
    start_ms: i64,
    end_ms: i64,
    page: u32,
    page_size: u32,
) -> HttpJson {
    send_json(
        client,
        reqwest::Method::POST,
        &format!("{WEB_BASE}/api/dashboard/get-filtered-usage-events"),
        headers,
        Some(json!({
            "startDate": start_ms.to_string(),
            "endDate": end_ms.to_string(),
            "page": page,
            "pageSize": page_size,
        })),
    )
    .await
}

/// 拉 [start,end] 内事件：先探测 pageSize=1000，失败回退 100；首页后并发剩余页。
pub async fn fetch_usage_events(
    client: &Client,
    token: &str,
    start_ms: i64,
    end_ms: i64,
) -> (Vec<UsageEvent>, InterfaceStatus, u32) {
    let Some(headers) = cookie_headers(token) else {
        return (
            Vec::new(),
            InterfaceStatus {
                ok: false,
                error: Some("无法构造会话 Cookie".into()),
                ..Default::default()
            },
            PAGE_SIZE_FALLBACK,
        );
    };

    let mut page_size = PAGE_SIZE_PRIMARY;
    let first = fetch_events_page(client, headers.clone(), start_ms, end_ms, 1, page_size).await;
    let first = if first.status != Some(200) || first.body.get("usageEventsDisplay").is_none() {
        page_size = PAGE_SIZE_FALLBACK;
        fetch_events_page(client, headers.clone(), start_ms, end_ms, 1, page_size).await
    } else {
        first
    };

    if first.status != Some(200) {
        let err = first
            .body
            .get("_error")
            .and_then(|v| v.as_str())
            .unwrap_or("事件接口失败")
            .to_string();
        return (
            Vec::new(),
            InterfaceStatus {
                ok: false,
                status: first.status,
                error: Some(err),
                ..Default::default()
            },
            page_size,
        );
    }

    let (mut events, total) = parse_events_page(&first.body);
    let n_pages = if page_size == 0 {
        1
    } else {
        let need = ((total as u32).saturating_add(page_size - 1)) / page_size;
        need.clamp(1, MAX_PAGES)
    };

    if n_pages > 1 {
        for chunk_start in (2..=n_pages).step_by(FETCH_CONCURRENCY) {
            let chunk_end = (chunk_start + FETCH_CONCURRENCY as u32 - 1).min(n_pages);
            let futs = (chunk_start..=chunk_end).map(|page| {
                fetch_events_page(client, headers.clone(), start_ms, end_ms, page, page_size)
            });
            let pages = futures::future::join_all(futs).await;
            for p in pages {
                if p.status == Some(200) {
                    let (batch, _) = parse_events_page(&p.body);
                    events.extend(batch);
                }
            }
        }
    }

    let count = events.len() as i64;
    (
        events,
        InterfaceStatus {
            ok: count > 0 || first.status == Some(200),
            status: first.status,
            count: Some(count),
            ..Default::default()
        },
        page_size,
    )
}

pub fn http_error_msg(body: &Value) -> Option<String> {
    body.get("_error")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .or_else(|| {
            if body.get("usageEventsDisplay").is_none() && body.get("planUsage").is_none() {
                body.as_str().map(|s| s.to_string())
            } else {
                None
            }
        })
}
