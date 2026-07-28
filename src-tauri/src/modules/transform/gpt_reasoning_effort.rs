use serde_json::Value;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GptReasoningScale {
    FourTier,
    SixTier,
}

/// 从 Claude Messages 请求解析并映射到 GPT Chat Completions 的 `reasoning_effort`。
pub fn resolve_gpt_chat_reasoning_effort(model: &str, claude: &Value) -> Option<&'static str> {
    let scale = gpt_reasoning_scale(model)?;
    let effort = read_inbound_effort(claude)?;
    map_inbound_effort(effort, scale)
}

fn gpt_reasoning_scale(model: &str) -> Option<GptReasoningScale> {
    let normalized = model.trim().to_ascii_lowercase();
    if is_gpt_56_terra_or_sol(&normalized) {
        return Some(GptReasoningScale::SixTier);
    }
    if is_gpt_55_or_luna(&normalized)
        || is_openai_o_series(&normalized)
        || is_gpt_5_plus(&normalized)
    {
        return Some(GptReasoningScale::FourTier);
    }
    None
}

fn is_gpt_56_terra_or_sol(model: &str) -> bool {
    model.starts_with("gpt-5.6-terra") || model.starts_with("gpt-5.6-sol")
}

fn is_gpt_55_or_luna(model: &str) -> bool {
    model.starts_with("gpt-5.5") || model.starts_with("gpt-5.6-luna")
}

fn is_gpt_5_plus(model: &str) -> bool {
    model
        .strip_prefix("gpt-")
        .and_then(|rest| rest.chars().next())
        .is_some_and(|c| c.is_ascii_digit() && c >= '5')
}

fn is_openai_o_series(model: &str) -> bool {
    model.len() > 1
        && model.starts_with('o')
        && model.as_bytes().get(1).is_some_and(|b| b.is_ascii_digit())
}

fn read_inbound_effort(claude: &Value) -> Option<&str> {
    for path in [
        "/output_config/effort",
        "/thinking/effort",
        "/reasoning/effort",
        "/reasoning_effort",
    ] {
        if let Some(effort) = claude.pointer(path).and_then(|v| v.as_str()) {
            return Some(effort);
        }
    }
    None
}

fn map_inbound_effort(value: &str, scale: GptReasoningScale) -> Option<&'static str> {
    match normalize_effort_label(value).as_str() {
        "low" => Some("low"),
        "medium" => Some("medium"),
        "high" => Some("high"),
        "extra" | "extrahigh" | "xhigh" => Some("xhigh"),
        "max" => Some(match scale {
            GptReasoningScale::FourTier => "xhigh",
            GptReasoningScale::SixTier => "max",
        }),
        "ultra" | "ultracode" => Some(match scale {
            GptReasoningScale::FourTier => "xhigh",
            GptReasoningScale::SixTier => "ultra",
        }),
        _ => None,
    }
}

fn normalize_effort_label(value: &str) -> String {
    value
        .trim()
        .chars()
        .filter(|ch| !matches!(ch, ' ' | '_' | '-'))
        .flat_map(char::to_lowercase)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn maps_four_tier_gpt_models() {
        let cases = [
            ("Low", "low"),
            ("Medium", "medium"),
            ("High", "high"),
            ("Extra high", "xhigh"),
            ("Max", "xhigh"),
            ("Ultracode", "xhigh"),
        ];

        for model in ["gpt-5.5", "gpt-5.6-luna", "gpt-5", "o3"] {
            for (input, expected) in cases {
                let req = json!({ "output_config": { "effort": input } });
                assert_eq!(
                    resolve_gpt_chat_reasoning_effort(model, &req),
                    Some(expected)
                );
            }
        }
    }

    #[test]
    fn maps_six_tier_gpt_models() {
        let cases = [
            ("Low", "low"),
            ("Medium", "medium"),
            ("High", "high"),
            ("Extra high", "xhigh"),
            ("Max", "max"),
            ("Ultra", "ultra"),
            ("Ultracode", "ultra"),
        ];

        for model in ["gpt-5.6-terra", "gpt-5.6-sol"] {
            for (input, expected) in cases {
                let req = json!({ "output_config": { "effort": input } });
                assert_eq!(
                    resolve_gpt_chat_reasoning_effort(model, &req),
                    Some(expected)
                );
            }
        }
    }

    #[test]
    fn reads_alternate_inbound_effort_fields() {
        let thinking = json!({ "thinking": { "effort": "extra_high" } });
        let reasoning = json!({ "reasoning": { "effort": "extra-high" } });
        let top_level = json!({ "reasoning_effort": "xhigh" });

        assert_eq!(
            resolve_gpt_chat_reasoning_effort("gpt-5.6-sol", &thinking),
            Some("xhigh")
        );
        assert_eq!(
            resolve_gpt_chat_reasoning_effort("gpt-5.6-sol", &reasoning),
            Some("xhigh")
        );
        assert_eq!(
            resolve_gpt_chat_reasoning_effort("gpt-5.6-sol", &top_level),
            Some("xhigh")
        );
    }

    #[test]
    fn ignores_unknown_effort_and_non_gpt_models() {
        let unknown = json!({ "output_config": { "effort": "turbo" } });
        let high = json!({ "output_config": { "effort": "high" } });

        assert_eq!(
            resolve_gpt_chat_reasoning_effort("gpt-5.6-sol", &unknown),
            None
        );
        assert_eq!(
            resolve_gpt_chat_reasoning_effort("claude-sonnet-5", &high),
            None
        );
        assert_eq!(resolve_gpt_chat_reasoning_effort("gpt-4o", &high), None);
    }
}
