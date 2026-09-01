//! 入站协议识别：path 启发式 → 候选过滤 / 转换开关 / 日志 label。
//!
//! ponytail: path.contains 与现有 Chat/Responses 一致；精确匹配留给路由收敛。
//! Images 只认 generations/edits，variations 仍当 Claude。

use crate::models::endpoint::Endpoint;
use crate::modules::proxy::circuit_breaker::InboundKind;
use crate::modules::transform::transformer::UpstreamFormat;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboundProtocol {
    Claude,
    OpenAi,
    Responses,
    Images,
}

impl InboundProtocol {
    pub fn detect(path: &str) -> Self {
        if path.contains("/chat/completions") {
            Self::OpenAi
        } else if path.contains("/responses") {
            Self::Responses
        } else if path.contains("/images/generations") || path.contains("/images/edits") {
            Self::Images
        } else {
            Self::Claude
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Claude => "claude",
            Self::OpenAi => "openai",
            Self::Responses => "responses",
            Self::Images => "images",
        }
    }

    /// 熔断 preset：Images 复用 OpenAi 阈值。
    pub fn kind(self) -> InboundKind {
        match self {
            Self::Claude => InboundKind::Claude,
            Self::OpenAi | Self::Images => InboundKind::OpenAi,
            Self::Responses => InboundKind::Responses,
        }
    }

    pub fn is_claude(self) -> bool {
        matches!(self, Self::Claude)
    }

    pub fn is_responses(self) -> bool {
        matches!(self, Self::Responses)
    }

    /// Images 入站：用于严格按模型过滤（不回退全量）。
    pub fn is_images(self) -> bool {
        matches!(self, Self::Images)
    }

    /// Claude 不过滤；其余只留协议能吃的上游。
    pub fn accepts(self, format: UpstreamFormat) -> bool {
        match self {
            Self::Claude => true,
            Self::OpenAi => matches!(format, UpstreamFormat::OpenAiChat),
            Self::Responses | Self::Images => matches!(
                format,
                UpstreamFormat::OpenAiChat | UpstreamFormat::OpenAiResponses
            ),
        }
    }

    pub fn empty_candidates_message(self) -> Option<&'static str> {
        match self {
            Self::OpenAi => Some("OpenAI 入站(/v1/chat/completions)无可用的 OpenAI 端点"),
            Self::Responses => Some("Responses 入站(/v1/responses)无可用的 codex/openai 端点"),
            Self::Images => Some("Images 入站(/v1/images/*)无可用的 openai/codex 端点"),
            Self::Claude => None,
        }
    }

    /// 按协议过滤候选。需要过滤且结果为空时返回错误文案。
    pub fn filter_candidates(self, enabled: Vec<Endpoint>) -> Result<Vec<Endpoint>, &'static str> {
        if matches!(self, Self::Claude) {
            return Ok(enabled);
        }
        let filtered: Vec<Endpoint> = enabled
            .into_iter()
            .filter(|e| self.accepts(UpstreamFormat::from_transformer_name(&e.transformer)))
            .collect();
        if filtered.is_empty() {
            return Err(self.empty_candidates_message().unwrap_or("无可用端点"));
        }
        Ok(filtered)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_known_paths() {
        assert_eq!(
            InboundProtocol::detect("/v1/chat/completions"),
            InboundProtocol::OpenAi
        );
        assert_eq!(
            InboundProtocol::detect("/v1/responses"),
            InboundProtocol::Responses
        );
        assert_eq!(
            InboundProtocol::detect("/v1/images/generations"),
            InboundProtocol::Images
        );
        assert_eq!(
            InboundProtocol::detect("/v1/images/edits"),
            InboundProtocol::Images
        );
        assert_eq!(
            InboundProtocol::detect("/v1/messages"),
            InboundProtocol::Claude
        );
        assert_eq!(
            InboundProtocol::detect("/v1/images/variations"),
            InboundProtocol::Claude
        );
    }

    #[test]
    fn images_label_and_kind() {
        let p = InboundProtocol::Images;
        assert_eq!(p.label(), "images");
        assert_eq!(p.kind(), InboundKind::OpenAi);
        assert!(!p.is_claude());
        assert!(!p.is_responses());
    }

    #[test]
    fn images_accepts_openai_and_codex_not_claude() {
        let p = InboundProtocol::Images;
        assert!(p.accepts(UpstreamFormat::OpenAiChat));
        assert!(p.accepts(UpstreamFormat::OpenAiResponses));
        assert!(!p.accepts(UpstreamFormat::Claude));
    }

    #[test]
    fn chat_inbound_still_openai_only() {
        let p = InboundProtocol::OpenAi;
        assert!(p.accepts(UpstreamFormat::OpenAiChat));
        assert!(!p.accepts(UpstreamFormat::OpenAiResponses));
        assert!(!p.accepts(UpstreamFormat::Claude));
    }

    #[test]
    fn claude_inbound_accepts_all() {
        let p = InboundProtocol::Claude;
        assert!(p.accepts(UpstreamFormat::Claude));
        assert!(p.accepts(UpstreamFormat::OpenAiChat));
        assert!(p.accepts(UpstreamFormat::OpenAiResponses));
    }

    fn ep(transformer: &str) -> Endpoint {
        Endpoint {
            id: 1,
            name: transformer.to_string(),
            api_url: "https://x".into(),
            api_key: String::new(),
            auth_mode: "api_key".into(),
            enabled: true,
            use_proxy: false,
            transformer: transformer.into(),
            model: String::new(),
            models: Vec::new(),
            active_models: Vec::new(),
            model_mappings: Vec::new(),
            model_mappings_enabled: true,
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
    fn images_filter_keeps_openai_and_codex_rejects_claude_only() {
        let kept = InboundProtocol::Images
            .filter_candidates(vec![ep("claude"), ep("openai"), ep("codex")])
            .unwrap();
        assert_eq!(
            kept.iter()
                .map(|e| e.transformer.as_str())
                .collect::<Vec<_>>(),
            ["openai", "codex"]
        );
        assert!(InboundProtocol::Images
            .filter_candidates(vec![ep("claude")])
            .is_err());
    }
}
