//! 模型列表探测：鉴权聚合 + URL 候选构造，提高端点表单「刷新模型」的成功率。
//!
//! 探测顺序（任一步拿到非空结果立即返回）：
//! 1. 原始 URL 上按所选 transformer 的鉴权方式请求；
//! 2. 同 URL 换另一种鉴权方式重试；
//! 3. 两种鉴权均失败后，剥离已知兼容子路径构造候选 URL，重复 1-2。
//!
//! 模型列表 URL 走 `join_upstream_url`：base 已含 `/vN` 或末尾 `#` 时只追加 `/models`。

use serde_json::Value;

use crate::modules::transform::transformer::UpstreamFormat;
use crate::utils::ua;
use crate::utils::upstream_url::join_upstream_url;

/// 已知兼容子路径：部分供应商在真实 API 根后挂代理子路径，剥离后可能命中 `/v1/models`。
const KNOWN_COMPAT_SUFFIXES: [&str; 9] = [
    "/api/claudecode",
    "/api/anthropic",
    "/apps/anthropic",
    "/api/coding",
    "/claudecode",
    "/anthropic",
    "/step_plan",
    "/coding",
    "/claude",
];

/// 模型探测的鉴权方式（Claude 头 / OpenAI Bearer）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProbeAuth {
    /// `x-api-key + anthropic-version`
    Claude,
    /// `Authorization: Bearer`
    Bearer,
}

impl ProbeAuth {
    /// transformer 对应的首选鉴权方式。
    pub fn primary_for(transformer: &str) -> Self {
        match UpstreamFormat::from_transformer_name(transformer) {
            UpstreamFormat::Claude => ProbeAuth::Claude,
            UpstreamFormat::OpenAiChat | UpstreamFormat::OpenAiResponses => ProbeAuth::Bearer,
        }
    }

    fn other(self) -> Self {
        match self {
            ProbeAuth::Claude => ProbeAuth::Bearer,
            ProbeAuth::Bearer => ProbeAuth::Claude,
        }
    }

    /// 给请求套上对应的鉴权/UA 头（模型探测与连通性测试共用，单一来源）。
    pub fn apply(self, b: reqwest::RequestBuilder, api_key: &str) -> reqwest::RequestBuilder {
        match self {
            ProbeAuth::Bearer => b
                .header("user-agent", ua::codex_probe_ua())
                .header("originator", ua::CODEX_ORIGINATOR)
                .header("authorization", format!("Bearer {api_key}")),
            ProbeAuth::Claude => b
                .header("user-agent", ua::CLAUDE_PROBE_UA)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01"),
        }
    }
}

/// 由 API base 构造模型列表 URL：已含 `/vN` 或末尾 `#` 时只追加 `/models`。
pub fn models_url_from_base(api_url: &str) -> String {
    join_upstream_url(api_url, "/v1/models")
}

/// 构造候选模型 URL（已含 `/models` 或 `/v1/models` 后缀），去重保序：
/// 原始 base → 剥离已知兼容子路径（大小写不敏感，至多剥离一层）。
fn build_candidate_urls(api_url: &str) -> Vec<String> {
    let mut out = vec![models_url_from_base(api_url)];
    let for_strip = api_url.trim().trim_end_matches('#').trim_end_matches('/');
    if let Some(stripped) = strip_known_suffix(for_strip) {
        let stripped = stripped.trim_end_matches('/');
        if !stripped.is_empty() {
            let url = models_url_from_base(stripped);
            if !out.contains(&url) {
                out.push(url);
            }
        }
    }
    out
}

fn strip_known_suffix(base: &str) -> Option<&str> {
    let lower = base.to_ascii_lowercase();
    KNOWN_COMPAT_SUFFIXES
        .iter()
        .find(|s| lower.ends_with(*s))
        .map(|s| &base[..base.len() - s.len()])
}

/// 单次请求 + 解析 `data[].id`（Claude/OpenAI 上游响应结构相同）。失败返回空。
pub async fn request_model_ids(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    auth: ProbeAuth,
) -> Vec<String> {
    let req = auth.apply(client.get(url), api_key);
    if let Ok(resp) = req.send().await {
        if resp.status().is_success() {
            if let Ok(v) = resp.json::<Value>().await {
                if let Some(data) = v.get("data").and_then(|d| d.as_array()) {
                    return data
                        .iter()
                        .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(String::from))
                        .collect();
                }
            }
        }
    }
    Vec::new()
}

/// 聚合探测：候选 URL × 两种鉴权（所选 transformer 首选），任一成功立即返回，全失败返回空。
/// 最多 2 候选 × 2 鉴权 = 4 次请求。
pub async fn probe_models(
    client: &reqwest::Client,
    api_url: &str,
    api_key: &str,
    transformer: &str,
) -> Vec<String> {
    let primary = ProbeAuth::primary_for(transformer);
    for url in build_candidate_urls(api_url) {
        for auth in [primary, primary.other()] {
            let ids = request_model_ids(client, &url, api_key, auth).await;
            if !ids.is_empty() {
                return ids;
            }
        }
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_base_yields_single_candidate() {
        assert_eq!(
            build_candidate_urls("https://api.anthropic.com"),
            vec!["https://api.anthropic.com/v1/models"]
        );
    }

    #[test]
    fn trailing_slash_is_trimmed() {
        assert_eq!(
            build_candidate_urls("https://api.anthropic.com/"),
            vec!["https://api.anthropic.com/v1/models"]
        );
    }

    #[test]
    fn deepseek_compat_suffix_is_stripped() {
        assert_eq!(
            build_candidate_urls("https://api.deepseek.com/anthropic"),
            vec![
                "https://api.deepseek.com/anthropic/v1/models",
                "https://api.deepseek.com/v1/models",
            ]
        );
    }

    #[test]
    fn suffix_match_is_case_insensitive() {
        assert_eq!(
            build_candidate_urls("https://x.com/API/Anthropic"),
            vec![
                "https://x.com/API/Anthropic/v1/models",
                "https://x.com/v1/models",
            ]
        );
    }

    #[test]
    fn v1_suffix_appends_models_not_v1_models() {
        assert_eq!(
            build_candidate_urls("https://x.com/v1"),
            vec!["https://x.com/v1/models"]
        );
        assert_eq!(
            build_candidate_urls("http://127.0.0.1:3000/v1/"),
            vec!["http://127.0.0.1:3000/v1/models"]
        );
        assert_eq!(
            models_url_from_base("https://x.com/V1"),
            "https://x.com/V1/models"
        );
    }

    #[test]
    fn v4_and_hash_skip_v1_models() {
        assert_eq!(
            build_candidate_urls("https://open.bigmodel.cn/api/coding/paas/v4"),
            vec!["https://open.bigmodel.cn/api/coding/paas/v4/models"]
        );
        assert_eq!(
            build_candidate_urls("https://host/openai#"),
            vec!["https://host/openai/models"]
        );
        assert_eq!(
            build_candidate_urls("https://api.deepseek.com/anthropic#"),
            vec![
                "https://api.deepseek.com/anthropic/models",
                "https://api.deepseek.com/v1/models",
            ]
        );
    }

    #[test]
    fn longer_suffix_wins_over_shorter() {
        // /api/claudecode 在 /claudecode 之前匹配，避免剥离不彻底
        assert_eq!(
            build_candidate_urls("https://x.com/api/claudecode"),
            vec![
                "https://x.com/api/claudecode/v1/models",
                "https://x.com/v1/models",
            ]
        );
    }

    #[test]
    fn primary_auth_follows_transformer() {
        assert_eq!(ProbeAuth::primary_for("claude"), ProbeAuth::Claude);
        assert_eq!(ProbeAuth::primary_for("openai"), ProbeAuth::Bearer);
        assert_eq!(ProbeAuth::primary_for("codex"), ProbeAuth::Bearer);
        // 未知值按 Claude 直通 → Claude 头先行
        assert_eq!(ProbeAuth::primary_for("gemini"), ProbeAuth::Claude);
    }
}
