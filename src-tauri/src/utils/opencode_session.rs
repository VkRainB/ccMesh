//! OpenCode Go 自 09/05 起要求出站带 `x-opencode-session`。
//! 仅对官方平台域名 `opencode.ai` 注入，避免把厂商相关头泄露到无关上游。

const SESSION_HEADER: &str = "x-opencode-session";

/// 最终 HTTPS 目标是否恰为 `https://opencode.ai`（不含子域、相似域、显式非默认端口、http）。
pub fn is_opencode_target(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    parsed.scheme() == "https"
        && parsed.host_str() == Some("opencode.ai")
        && parsed.port().is_none()
}

/// 命中官方域名且为 api_key 时返回要发送的会话头值：客户端已带则透传，否则生成 UUID。
///
/// ponytail: 网关无会话态时每次请求新 UUID，无法跨轮次粘滞；升级路径是客户端传入稳定 conversation id。
pub fn opencode_session_header(url: &str, auth_mode: &str, client: Option<&str>) -> Option<String> {
    if auth_mode != "api_key" || !is_opencode_target(url) {
        return None;
    }
    let from_client = client.map(str::trim).filter(|s| !s.is_empty());
    Some(
        from_client
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
    )
}

pub fn with_opencode_session(
    builder: reqwest::RequestBuilder,
    url: &str,
    auth_mode: &str,
    client: Option<&str>,
) -> reqwest::RequestBuilder {
    match opencode_session_header(url, auth_mode, client) {
        Some(id) => builder.header(SESSION_HEADER, id),
        None => builder,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_opencode_target_exact_https_host() {
        assert!(is_opencode_target(
            "https://opencode.ai/zen/v1/chat/completions"
        ));
        assert!(is_opencode_target("https://opencode.ai"));
        assert!(!is_opencode_target("https://api.opencode.ai"));
        assert!(!is_opencode_target("https://opencode.ai.evil.com"));
        assert!(!is_opencode_target("http://opencode.ai"));
        assert!(!is_opencode_target("https://opencode.ai:8443/v1"));
        assert!(!is_opencode_target("not a url"));
    }

    #[test]
    fn session_header_uses_client_or_generates_uuid() {
        let url = "https://opencode.ai/v1/chat/completions";
        assert_eq!(
            opencode_session_header(url, "api_key", Some(" conv-1 ")).as_deref(),
            Some("conv-1")
        );
        let generated = opencode_session_header(url, "api_key", None).unwrap();
        assert!(uuid::Uuid::parse_str(&generated).is_ok());
        assert!(opencode_session_header(url, "auth_token", None).is_none());
        assert!(
            opencode_session_header("https://api.openai.com/v1", "api_key", Some("x")).is_none()
        );
    }
}
