//! reasoning_effort 降级整流器。
//!
//! Responses → Chat 转换后，部分上游仅接受 `low` / `medium` / `high`，
//! 客户端可能发送 `xhigh`。当上游返回 reasoning_effort 校验错误时，
//! 自动将 `reasoning.effort` 降一级后透明重试。

use serde_json::{json, Value};

/// 从高到低的推理强度阶梯（仅包含已知等级）。`max` 补入后，客户端自带或映射覆盖的
/// `max` 被上游拒时也能降级（此前 `max` 不在阶梯内会直接失败）。
const EFFORT_LADDER: &[&str] = &["max", "xhigh", "high", "medium", "low"];

/// 检测上游错误是否因 reasoning_effort 不被接受（如 xhigh 仅部分上游支持）。
pub fn is_unsupported_reasoning_effort_error(error_message: &str) -> bool {
    let lower = error_message.to_lowercase();
    if !lower.contains("reasoning_effort") {
        return false;
    }
    lower.contains("literal_error")
        || lower.contains("input should be")
        || lower.contains("invalid")
        || lower.contains("not supported")
        || lower.contains("unrecognized")
        || lower.contains("unknown")
}

/// 将当前 effort 降一级（按 `EFFORT_LADDER` 从高到低）。已是 `low` 或未知等级返回 `None`。
/// 供 Responses→Chat 降级与映射覆盖值降级共用，避免两处各写一份阶梯扫描。
pub fn next_lower_effort(current: &str) -> Option<&'static str> {
    let cur = current.trim().to_ascii_lowercase();
    let idx = EFFORT_LADDER.iter().position(|e| *e == cur.as_str())?;
    Some(*EFFORT_LADDER.get(idx + 1)?)
}

/// 将 Responses 请求体中的 `reasoning.effort` 降一级（max→xhigh→high→medium→low）。
/// 成功降级返回 `true`；已是 `low` 或未知等级则返回 `false`。
pub fn downgrade_reasoning_effort_in_responses(body: &mut Value) -> bool {
    let current = body
        .pointer("/reasoning/effort")
        .and_then(|v| v.as_str())
        .map(|s| s.to_ascii_lowercase());

    let current = match current {
        Some(c) => c,
        None => return false,
    };

    let next = match next_lower_effort(&current) {
        Some(n) => n,
        None => return false,
    };

    if let Some(reasoning) = body.get_mut("reasoning").and_then(|r| r.as_object_mut()) {
        reasoning.insert("effort".into(), json!(next));
        return true;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_literal_error_on_reasoning_effort() {
        let err = r#"{"error":{"message":"[{'type': 'literal_error', 'loc': ('body', 'reasoning_effort'), 'msg': \"Input should be 'low', 'medium' or 'high'\", 'input': 'xhigh'}]"}}"#;
        assert!(is_unsupported_reasoning_effort_error(err));
    }

    #[test]
    fn ignores_unrelated_errors() {
        assert!(!is_unsupported_reasoning_effort_error("model not found"));
    }

    #[test]
    fn downgrades_xhigh_to_high() {
        let mut body = json!({ "reasoning": { "effort": "xhigh" }, "input": "hi" });
        assert!(downgrade_reasoning_effort_in_responses(&mut body));
        assert_eq!(body["reasoning"]["effort"], json!("high"));
    }

    #[test]
    fn downgrades_high_to_medium() {
        let mut body = json!({ "reasoning": { "effort": "high" } });
        assert!(downgrade_reasoning_effort_in_responses(&mut body));
        assert_eq!(body["reasoning"]["effort"], json!("medium"));
    }

    #[test]
    fn cannot_downgrade_low() {
        let mut body = json!({ "reasoning": { "effort": "low" } });
        assert!(!downgrade_reasoning_effort_in_responses(&mut body));
    }

    #[test]
    fn case_insensitive_effort() {
        let mut body = json!({ "reasoning": { "effort": "XHIGH" } });
        assert!(downgrade_reasoning_effort_in_responses(&mut body));
        assert_eq!(body["reasoning"]["effort"], json!("high"));
    }

    #[test]
    fn next_lower_effort_max_to_xhigh() {
        assert_eq!(next_lower_effort("max"), Some("xhigh"));
        assert_eq!(next_lower_effort("Max"), Some("xhigh"));
        assert_eq!(next_lower_effort("  xhigh "), Some("high"));
        assert_eq!(next_lower_effort("low"), None);
        assert_eq!(next_lower_effort("unknown"), None);
        assert_eq!(next_lower_effort(""), None);
    }

    #[test]
    fn downgrades_max_to_xhigh() {
        let mut body = json!({ "reasoning": { "effort": "max" } });
        assert!(downgrade_reasoning_effort_in_responses(&mut body));
        assert_eq!(body["reasoning"]["effort"], json!("xhigh"));
    }
}
