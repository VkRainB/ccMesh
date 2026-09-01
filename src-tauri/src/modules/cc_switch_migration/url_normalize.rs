//! cc-switch 上游地址规整为 ccMesh 入库根地址。
//!
//! 约定 `endpoints.api_url` 存上游根地址，出站再拼协议路径（见 `utils/upstream_url`）。
//! 导入时仍剥 `/v1` 与已知完整 API 路径，与手动新建的「填根地址」习惯一致。
//! 末尾 `#` 是跳过自动 `/v1` 的哨兵，必须原样保留。

use crate::error::{AppError, AppResult};

/// 剥离一层已知 API 路径后缀（大小写不敏感），返回剥到根后的地址。
fn strip_known_api_suffix(base: &str) -> &str {
    const SUFFIXES: &[&str] = &[
        "/v1/messages",
        "/v1/chat/completions",
        "/v1/responses",
        "/v1/models",
        "/v1/images/generations",
        "/v1/images/edits",
    ];
    let lower = base.to_ascii_lowercase();
    for s in SUFFIXES {
        if lower.ends_with(s) {
            return &base[..base.len() - s.len()];
        }
    }
    base
}

/// 将 cc-switch 原始上游地址规整为 ccMesh 根地址。
///
/// 步骤：
/// 1. trim 空白；
/// 2. 若以 `#` 结尾 → 去 `#` 前的尾斜杠后把 `#` 拼回（不剥 `/v1` / 已知路径）；
/// 3. 去末尾 `/`（循环到稳定）；
/// 4. 若以完整 API 路径结尾 → 剥到根（仅一层），再 trim `/`；
/// 5. 若以 `/v1` 结尾（大小写不敏感）→ 去后缀再 trim `/`；
/// 6. 结果为空或非 `http(s)://` → `Err`。
pub fn normalize_api_url_for_ccmesh(raw: &str) -> AppResult<String> {
    let mut s = raw.trim();

    if let Some(body) = s.strip_suffix('#') {
        let body = body.trim_end_matches('/');
        if body.is_empty() {
            return Err(AppError::InvalidArgument(format!("无效的上游地址: {raw}")));
        }
        let lower = body.to_ascii_lowercase();
        if !(lower.starts_with("http://") || lower.starts_with("https://")) {
            return Err(AppError::InvalidArgument(format!("无效的上游地址: {raw}")));
        }
        return Ok(format!("{body}#"));
    }

    // 去尾斜杠（循环到稳定）
    while s.ends_with('/') {
        s = s.trim_end_matches('/');
    }

    // 去已知 API 路径后缀（一层），如 /v1/messages → 根
    let stripped = strip_known_api_suffix(s);
    if stripped.len() < s.len() {
        s = stripped.trim_end_matches('/');
    }

    // 去 /v1 结尾
    let lower = s.to_ascii_lowercase();
    if lower.ends_with("/v1") {
        s = s[..s.len() - 3].trim_end_matches('/');
    }

    if s.is_empty() {
        return Err(AppError::InvalidArgument(format!("无效的上游地址: {raw}")));
    }
    let lower = s.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(AppError::InvalidArgument(format!("无效的上游地址: {raw}")));
    }
    Ok(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_trailing_v1() {
        assert_eq!(
            normalize_api_url_for_ccmesh("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("https://api.openai.com/v1/").unwrap(),
            "https://api.openai.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("http://127.0.0.1:15721/v1").unwrap(),
            "http://127.0.0.1:15721"
        );
    }

    #[test]
    fn strips_known_api_path_suffix() {
        assert_eq!(
            normalize_api_url_for_ccmesh("https://x.com/v1/messages").unwrap(),
            "https://x.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("https://x.com/v1/chat/completions").unwrap(),
            "https://x.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("https://x.com/v1/responses").unwrap(),
            "https://x.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("https://x.com/v1/models").unwrap(),
            "https://x.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("https://x.com/v1/images/generations").unwrap(),
            "https://x.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("https://x.com/v1/images/edits").unwrap(),
            "https://x.com"
        );
    }

    #[test]
    fn keeps_non_v1_path_intact() {
        // deepseek 的 /anthropic 不是已知 API 路径，保留
        assert_eq!(
            normalize_api_url_for_ccmesh("https://api.deepseek.com/anthropic").unwrap(),
            "https://api.deepseek.com/anthropic"
        );
        // 智谱 v4 结尾不是 /v1，保留
        assert_eq!(
            normalize_api_url_for_ccmesh("https://open.bigmodel.cn/api/coding/paas/v4").unwrap(),
            "https://open.bigmodel.cn/api/coding/paas/v4"
        );
    }

    #[test]
    fn keeps_trailing_hash() {
        assert_eq!(
            normalize_api_url_for_ccmesh("https://host/openai#").unwrap(),
            "https://host/openai#"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("https://host/openai/#").unwrap(),
            "https://host/openai#"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("  https://host/v1#  ").unwrap(),
            "https://host/v1#"
        );
        assert!(normalize_api_url_for_ccmesh("#").is_err());
        assert!(normalize_api_url_for_ccmesh("https://#").is_err());
    }

    #[test]
    fn trims_trailing_slash_loop() {
        assert_eq!(
            normalize_api_url_for_ccmesh("https://a.com///").unwrap(),
            "https://a.com"
        );
    }

    #[test]
    fn case_insensitive_v1() {
        assert_eq!(
            normalize_api_url_for_ccmesh("https://a.com/V1").unwrap(),
            "https://a.com"
        );
        assert_eq!(
            normalize_api_url_for_ccmesh("HTTPS://a.com/v1").unwrap(),
            "HTTPS://a.com"
        );
    }

    #[test]
    fn rejects_invalid() {
        assert!(normalize_api_url_for_ccmesh("").is_err());
        assert!(normalize_api_url_for_ccmesh("   ").is_err());
        assert!(normalize_api_url_for_ccmesh("api.openai.com").is_err()); // 无 scheme
        assert!(normalize_api_url_for_ccmesh("ftp://x.com").is_err());
        assert!(normalize_api_url_for_ccmesh("/v1").is_err());
        assert!(normalize_api_url_for_ccmesh("https://").is_err()); // 仅 scheme
    }
}
