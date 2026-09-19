//! 端点配置的出站请求头覆写，供代理转发、连通性测试与对话共用。

use std::collections::HashMap;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};

use crate::models::endpoint::Endpoint;
use crate::utils::opencode_session::{is_opencode_target, with_opencode_session};

const SESSION_HEADER: &str = "x-opencode-session";

/// 用端点覆写替换同名已有头（reqwest 的 `.header()` 是 append，不能当覆写）。
pub fn apply_header_overrides(
    builder: reqwest::RequestBuilder,
    overrides: &HashMap<String, String>,
) -> reqwest::RequestBuilder {
    if overrides.is_empty() {
        return builder;
    }
    let mut map = HeaderMap::new();
    for (k, v) in overrides {
        let Ok(name) = HeaderName::from_bytes(k.as_bytes()) else {
            continue;
        };
        let Ok(value) = HeaderValue::from_str(v) else {
            continue;
        };
        map.insert(name, value);
    }
    builder.headers(map)
}

/// 套上端点覆写，再按需注入官方域名会话头。
/// 会话将注入时去掉账号级同名覆写，与代理转发一致。
pub fn with_endpoint_outbound_headers(
    builder: reqwest::RequestBuilder,
    ep: &Endpoint,
    url: &str,
    client_session: Option<&str>,
) -> reqwest::RequestBuilder {
    let mut overrides = ep.effective_header_overrides();
    // 与 `opencode_session_header` 注入条件对齐，避免为判断而先生成一份 UUID。
    if ep.auth_mode == "api_key" && is_opencode_target(url) {
        overrides.remove(SESSION_HEADER);
    }
    let builder = apply_header_overrides(builder, &overrides);
    with_opencode_session(builder, url, &ep.auth_mode, client_session)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::endpoint::{Endpoint, HeaderOverride};

    fn test_ep(enabled: bool, items: &[(&str, &str)], api_url: &str, auth_mode: &str) -> Endpoint {
        Endpoint {
            id: 1,
            name: "t".into(),
            api_url: api_url.into(),
            api_key: String::new(),
            auth_mode: auth_mode.into(),
            enabled: true,
            use_proxy: false,
            transformer: "openai".into(),
            model: String::new(),
            models: Vec::new(),
            active_models: Vec::new(),
            model_mappings: Vec::new(),
            model_mappings_enabled: true,
            header_overrides: items
                .iter()
                .map(|(n, v)| HeaderOverride {
                    name: (*n).into(),
                    value: (*v).into(),
                })
                .collect(),
            header_overrides_enabled: enabled,
            remark: String::new(),
            sort_order: 0,
            fast: false,
            fast_sort_order: 0,
            test_status: "unknown".into(),
            created_at: String::new(),
            updated_at: String::new(),
            archived: false,
        }
    }

    #[test]
    fn applies_configured_headers_and_overrides_probe_ua() {
        let ep = test_ep(
            true,
            &[("User-Agent", "ccmesh-test"), ("X-Custom", "from-ep")],
            "https://example.com",
            "api_key",
        );
        let req = with_endpoint_outbound_headers(
            reqwest::Client::new()
                .post("https://example.com/v1/chat/completions")
                .header("user-agent", "probe-ua"),
            &ep,
            "https://example.com/v1/chat/completions",
            None,
        )
        .build()
        .unwrap();
        assert_eq!(req.headers().get_all("user-agent").iter().count(), 1);
        assert_eq!(req.headers().get("user-agent").unwrap(), "ccmesh-test");
        assert_eq!(req.headers().get("x-custom").unwrap(), "from-ep");
        assert!(req.headers().get(SESSION_HEADER).is_none());
    }

    #[test]
    fn disabled_or_empty_overrides_are_skipped() {
        let off = test_ep(
            false,
            &[("X-Custom", "nope")],
            "https://example.com",
            "api_key",
        );
        let req = with_endpoint_outbound_headers(
            reqwest::Client::new().post("https://example.com/v1"),
            &off,
            "https://example.com/v1",
            None,
        )
        .build()
        .unwrap();
        assert!(req.headers().get("x-custom").is_none());
    }

    #[test]
    fn opencode_session_override_yields_to_injected_session() {
        let url = "https://opencode.ai/v1/chat/completions";
        let ep = test_ep(
            true,
            &[("x-opencode-session", "from-config"), ("X-Foo", "bar")],
            url,
            "api_key",
        );
        let req = with_endpoint_outbound_headers(
            reqwest::Client::new().post(url),
            &ep,
            url,
            Some("client-sid"),
        )
        .build()
        .unwrap();
        assert_eq!(req.headers().get(SESSION_HEADER).unwrap(), "client-sid");
        assert_eq!(req.headers().get("x-foo").unwrap(), "bar");
    }

    #[test]
    fn non_opencode_keeps_session_override() {
        let url = "https://example.com/v1/chat/completions";
        let ep = test_ep(
            true,
            &[("x-opencode-session", "from-config")],
            url,
            "api_key",
        );
        let req = with_endpoint_outbound_headers(reqwest::Client::new().post(url), &ep, url, None)
            .build()
            .unwrap();
        assert_eq!(req.headers().get(SESSION_HEADER).unwrap(), "from-config");
    }
}
