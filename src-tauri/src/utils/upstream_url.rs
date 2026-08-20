//! 上游 API URL 拼接：根地址 + 协议路径，按 Cherry 规则跳过自动 `/v1`。
//!
//! - 默认：`base + /v1/chat/completions`（或 `/v1/messages` 等）
//! - 末尾 `#`：剥掉 `#`，不再附加版本段（仍拼 `/chat/completions`）
//! - 路径已含 `/vN` / `/vNbeta` / `/vNalpha`：同样跳过 `/v1` 前缀
//!
//! `#` 在当 URL fragment 解析之前当哨兵处理，避免 `https://host#/v1/...`。

use once_cell::sync::Lazy;
use regex::Regex;

static VERSION_IN_PATH: Lazy<Regex> =
    Lazy::new(|| Regex::new(r"(?i)/v\d+(?:alpha|beta)?(?:/|$)").expect("version regex"));

/// 拼接上游请求 URL。`api_path` 形如 `/v1/chat/completions`。
pub fn join_upstream_url(api_url: &str, api_path: &str) -> String {
    let mut s = api_url.trim();
    let skip_version = s.ends_with('#');
    if skip_version {
        s = s.strip_suffix('#').unwrap_or(s);
    }
    s = s.trim_end_matches('/');
    let path = if (skip_version || has_api_version(s)) && api_path.starts_with("/v1/") {
        &api_path[3..]
    } else {
        api_path
    };
    format!("{s}{path}")
}

fn has_api_version(url: &str) -> bool {
    VERSION_IN_PATH.is_match(pathname(url))
}

/// 只看 pathname，避免 query 里的 `/v1` 误伤。
fn pathname(url: &str) -> &str {
    let after_scheme = url.split_once("://").map(|(_, rest)| rest).unwrap_or(url);
    let host_and_path = after_scheme
        .split(['?', '#'])
        .next()
        .unwrap_or(after_scheme);
    match host_and_path.find('/') {
        Some(i) => &host_and_path[i..],
        None => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_host_keeps_v1_prefix() {
        assert_eq!(
            join_upstream_url("https://api.openai.com", "/v1/chat/completions"),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            join_upstream_url("https://api.anthropic.com", "/v1/messages"),
            "https://api.anthropic.com/v1/messages"
        );
        assert_eq!(
            join_upstream_url("https://example.com", "/v1/models"),
            "https://example.com/v1/models"
        );
    }

    #[test]
    fn trailing_v1_does_not_duplicate() {
        assert_eq!(
            join_upstream_url("https://example.com/v1", "/v1/messages"),
            "https://example.com/v1/messages"
        );
        assert_eq!(
            join_upstream_url("https://example.com/v1/", "/v1/chat/completions"),
            "https://example.com/v1/chat/completions"
        );
        assert_eq!(
            join_upstream_url("https://x.com/V1", "/v1/models"),
            "https://x.com/V1/models"
        );
    }

    #[test]
    fn zhipu_v4_skips_v1() {
        assert_eq!(
            join_upstream_url(
                "https://open.bigmodel.cn/api/coding/paas/v4",
                "/v1/chat/completions"
            ),
            "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions"
        );
        assert_eq!(
            join_upstream_url("https://open.bigmodel.cn/api/coding/paas/v4", "/v1/models"),
            "https://open.bigmodel.cn/api/coding/paas/v4/models"
        );
    }

    #[test]
    fn trailing_hash_skips_v1() {
        assert_eq!(
            join_upstream_url("https://host/openai#", "/v1/chat/completions"),
            "https://host/openai/chat/completions"
        );
        assert_eq!(
            join_upstream_url("https://host#", "/v1/messages"),
            "https://host/messages"
        );
        assert_eq!(
            join_upstream_url("https://host/#", "/v1/chat/completions"),
            "https://host/chat/completions"
        );
        assert_eq!(
            join_upstream_url("  https://host/openai#  ", "/v1/chat/completions"),
            "https://host/openai/chat/completions"
        );
    }

    #[test]
    fn v2beta_counts_as_version() {
        assert_eq!(
            join_upstream_url("https://api.example.com/v2beta", "/v1/chat/completions"),
            "https://api.example.com/v2beta/chat/completions"
        );
    }

    #[test]
    fn deepseek_anthropic_keeps_v1() {
        assert_eq!(
            join_upstream_url("https://api.deepseek.com/anthropic", "/v1/messages"),
            "https://api.deepseek.com/anthropic/v1/messages"
        );
    }

    #[test]
    fn query_v1_does_not_skip() {
        assert_eq!(
            join_upstream_url("https://example.com?x=/v1", "/v1/messages"),
            "https://example.com?x=/v1/v1/messages"
        );
    }
}
