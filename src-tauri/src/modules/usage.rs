use serde_json::Value;

use crate::modules::transform::transformer::UpstreamFormat;

/// 一次请求的真实 token 用量（含缓存创建/读取）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub input: i64,
    pub output: i64,
    pub cache_creation: i64,
    pub cache_read: i64,
}

/// 从非流式上游响应体解析真实 token 用量，按端点上游格式区分字段名。
/// Claude: `usage.input_tokens / output_tokens / cache_creation_input_tokens / cache_read_input_tokens`；
/// OpenAI: `usage.prompt_tokens / completion_tokens / prompt_tokens_details.cached_tokens`。
///
/// **`input` 字段统一为"非缓存净输入"语义**：OpenAI 的 `prompt_tokens`/`input_tokens`
/// 已包含 `cached_tokens`，需扣除 `cache_read` 以与 Claude（`input_tokens` 不含缓存）
/// 对齐。这样下游合计 `input + output + cache_creation + cache_read` 不会双重计算缓存。
pub fn from_response(body: &Value, format: UpstreamFormat) -> TokenUsage {
    let usage = body.get("usage");
    match format {
        UpstreamFormat::Claude => TokenUsage {
            input: first_field(usage, &["input_tokens", "prompt_tokens"]),
            output: first_field(usage, &["output_tokens", "completion_tokens"]),
            cache_creation: field(usage, "cache_creation_input_tokens"),
            cache_read: cache_read_tokens(usage),
        },
        UpstreamFormat::OpenAiChat => {
            let cache_read = cache_read_tokens(usage);
            TokenUsage {
                input: net_input(
                    first_field(usage, &["prompt_tokens", "input_tokens"]),
                    cache_read,
                ),
                output: first_field(usage, &["completion_tokens", "output_tokens"]),
                cache_creation: field(usage, "cache_creation_input_tokens"),
                cache_read,
            }
        }
        // Responses：usage.input_tokens / output_tokens / input_tokens_details.cached_tokens。
        UpstreamFormat::OpenAiResponses => {
            let cache_read = cache_read_tokens(usage);
            TokenUsage {
                input: net_input(
                    first_field(usage, &["input_tokens", "prompt_tokens"]),
                    cache_read,
                ),
                output: first_field(usage, &["output_tokens", "completion_tokens"]),
                cache_creation: field(usage, "cache_creation_input_tokens"),
                cache_read,
            }
        }
    }
}

/// OpenAI 风格的净输入：`prompt_tokens`/`input_tokens` 已含 `cached_tokens`，
/// 扣除后得到非缓存净输入。扣除后向下截断到 0（上游偶发 cache_read > input 时）。
fn net_input(raw_input: i64, cache_read: i64) -> i64 {
    (raw_input - cache_read).max(0)
}

fn field(usage: Option<&Value>, key: &str) -> i64 {
    usage
        .and_then(|u| u.get(key))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}

fn nested_field(usage: Option<&Value>, path: &[&str]) -> i64 {
    let mut value = usage;
    for key in path {
        value = value.and_then(|v| v.get(*key));
    }
    value.and_then(|v| v.as_i64()).unwrap_or(0)
}

fn first_field(usage: Option<&Value>, keys: &[&str]) -> i64 {
    keys.iter()
        .map(|key| field(usage, key))
        .find(|v| *v > 0)
        .unwrap_or(0)
}

fn cache_read_tokens(usage: Option<&Value>) -> i64 {
    [
        field(usage, "cache_read_input_tokens"),
        nested_field(usage, &["input_tokens_details", "cached_tokens"]),
        nested_field(usage, &["prompt_tokens_details", "cached_tokens"]),
        field(usage, "cached_tokens"),
    ]
    .into_iter()
    .find(|v| *v > 0)
    .unwrap_or(0)
}

/// 流式 SSE token 用量累积器：逐分片喂入，按行解析 `data:` JSON，结束读出 `TokenUsage`。
pub struct UsageAccumulator {
    format: UpstreamFormat,
    buf: String,
    input: i64,
    output: i64,
    cache_creation: i64,
    cache_read: i64,
}

impl UsageAccumulator {
    pub fn new(format: UpstreamFormat) -> Self {
        Self {
            format,
            buf: String::new(),
            input: 0,
            output: 0,
            cache_creation: 0,
            cache_read: 0,
        }
    }

    /// 喂入一段响应字节（SSE 分片，可在任意位置切分）。
    pub fn feed(&mut self, chunk: &[u8]) {
        self.buf.push_str(&String::from_utf8_lossy(chunk));
        while let Some(nl) = self.buf.find('\n') {
            let line = self.buf[..nl].trim().to_string();
            self.buf.drain(..=nl);
            let Some(data) = line.strip_prefix("data:") else {
                continue;
            };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            if let Ok(j) = serde_json::from_str::<Value>(data) {
                self.feed_json(&j);
            }
        }
    }

    fn feed_json(&mut self, j: &Value) {
        match self.format {
            UpstreamFormat::Claude => match j.get("type").and_then(|v| v.as_str()) {
                Some("message_start") => {
                    if let Some(u) = j.get("message").and_then(|m| m.get("usage")) {
                        if let Some(i) = u.get("input_tokens").and_then(|v| v.as_i64()) {
                            self.input = i;
                        }
                        if let Some(o) = u.get("output_tokens").and_then(|v| v.as_i64()) {
                            self.output = o;
                        }
                        if let Some(c) = u
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_i64())
                        {
                            self.cache_creation = c;
                        }
                        if let Some(c) = u.get("cache_read_input_tokens").and_then(|v| v.as_i64()) {
                            self.cache_read = c;
                        }
                    }
                }
                Some("message_delta") => {
                    if let Some(u) = j.get("usage") {
                        if let Some(o) = u.get("output_tokens").and_then(|v| v.as_i64()) {
                            self.output = o;
                        }
                        // 部分 provider 在 delta 修正 input；取正值覆盖
                        if let Some(i) = u.get("input_tokens").and_then(|v| v.as_i64()) {
                            if i > 0 {
                                self.input = i;
                            }
                        }
                        if let Some(c) = u
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_i64())
                        {
                            if c > 0 {
                                self.cache_creation = c;
                            }
                        }
                        if let Some(c) = u.get("cache_read_input_tokens").and_then(|v| v.as_i64()) {
                            if c > 0 {
                                self.cache_read = c;
                            }
                        }
                    }
                }
                _ => {}
            },
            UpstreamFormat::OpenAiChat => {
                if let Some(u) = j.get("usage") {
                    if !u.is_null() {
                        let cache_read = cache_read_tokens(Some(u));
                        if cache_read > 0 {
                            self.cache_read = cache_read;
                        }
                        if let Some(i) = u
                            .get("prompt_tokens")
                            .or_else(|| u.get("input_tokens"))
                            .and_then(|v| v.as_i64())
                        {
                            // prompt_tokens 已含 cached_tokens，扣除后为净输入
                            self.input = net_input(i, self.cache_read);
                        }
                        if let Some(o) = u
                            .get("completion_tokens")
                            .or_else(|| u.get("output_tokens"))
                            .and_then(|v| v.as_i64())
                        {
                            self.output = o;
                        }
                        if let Some(c) = u
                            .get("cache_creation_input_tokens")
                            .and_then(|v| v.as_i64())
                        {
                            self.cache_creation = c;
                        }
                    }
                }
            }
            // Responses SSE：usage 在 response.completed/incomplete 事件的 `response.usage`（或顶层 `usage`）。
            UpstreamFormat::OpenAiResponses => {
                let u = j
                    .get("response")
                    .and_then(|r| r.get("usage"))
                    .or_else(|| j.get("usage"));
                if let Some(u) = u {
                    if !u.is_null() {
                        let cache_read = cache_read_tokens(Some(u));
                        if cache_read > 0 {
                            self.cache_read = cache_read;
                        }
                        if let Some(i) = u.get("input_tokens").and_then(|v| v.as_i64()) {
                            // input_tokens 已含 cached_tokens，扣除后为净输入
                            self.input = net_input(i, self.cache_read);
                        }
                        if let Some(o) = u.get("output_tokens").and_then(|v| v.as_i64()) {
                            self.output = o;
                        }
                    }
                }
            }
        }
    }

    pub fn finish(self) -> TokenUsage {
        TokenUsage {
            input: self.input,
            output: self.output,
            cache_creation: self.cache_creation,
            cache_read: self.cache_read,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tu(input: i64, output: i64, cache_creation: i64, cache_read: i64) -> TokenUsage {
        TokenUsage {
            input,
            output,
            cache_creation,
            cache_read,
        }
    }

    #[test]
    fn claude_non_stream() {
        let body = json!({ "usage": { "input_tokens": 100, "output_tokens": 50 } });
        assert_eq!(
            from_response(&body, UpstreamFormat::Claude),
            tu(100, 50, 0, 0)
        );
    }

    #[test]
    fn claude_non_stream_with_cache() {
        let body = json!({ "usage": {
            "input_tokens": 100, "output_tokens": 50,
            "cache_creation_input_tokens": 30, "cache_read_input_tokens": 70
        } });
        assert_eq!(
            from_response(&body, UpstreamFormat::Claude),
            tu(100, 50, 30, 70)
        );
    }

    #[test]
    fn openai_non_stream() {
        let body = json!({ "usage": {
            "prompt_tokens": 30,
            "completion_tokens": 12,
            "prompt_tokens_details": { "cached_tokens": 9 }
        } });
        // prompt_tokens 已含 cached_tokens，input 归一化为净输入 30 - 9 = 21
        assert_eq!(
            from_response(&body, UpstreamFormat::OpenAiChat),
            tu(21, 12, 0, 9)
        );
    }

    #[test]
    fn openai_non_stream_uses_responses_and_cached_tokens_fallbacks() {
        let body = json!({ "usage": {
            "input_tokens": 12,
            "output_tokens": 5,
            "input_tokens_details": { "cached_tokens": 7 }
        } });
        // input_tokens 已含 cached_tokens，净输入 12 - 7 = 5
        assert_eq!(
            from_response(&body, UpstreamFormat::OpenAiChat),
            tu(5, 5, 0, 7)
        );

        let body = json!({ "usage": {
            "prompt_tokens": 12,
            "completion_tokens": 5,
            "cached_tokens": 8
        } });
        // 净输入 12 - 8 = 4
        assert_eq!(
            from_response(&body, UpstreamFormat::OpenAiChat),
            tu(4, 5, 0, 8)
        );
    }

    #[test]
    fn missing_usage_is_zero() {
        assert_eq!(
            from_response(&json!({}), UpstreamFormat::Claude),
            tu(0, 0, 0, 0)
        );
    }

    #[test]
    fn claude_sse_accumulates() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::Claude);
        acc.feed(b"data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":120,\"output_tokens\":0}}}\n\n");
        acc.feed(b"data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":64}}\n\n");
        acc.feed(b"data: [DONE]\n\n");
        assert_eq!(acc.finish(), tu(120, 64, 0, 0));
    }

    #[test]
    fn claude_sse_accumulates_cache() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::Claude);
        acc.feed(b"data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":0,\"cache_creation_input_tokens\":40,\"cache_read_input_tokens\":80}}}\n\n");
        acc.feed(b"data: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":64}}\n\n");
        acc.feed(b"data: [DONE]\n\n");
        assert_eq!(acc.finish(), tu(10, 64, 40, 80));
    }

    #[test]
    fn openai_sse_accumulates_last_usage() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::OpenAiChat);
        acc.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n");
        acc.feed(
            b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":40,\"completion_tokens\":20,\"prompt_tokens_details\":{\"cached_tokens\":11}}}
",
        );
        acc.feed(b"data: [DONE]\n\n");
        // prompt_tokens(40) 已含 cached_tokens(11)，净输入 40 - 11 = 29
        assert_eq!(acc.finish(), tu(29, 20, 0, 11));
    }

    #[test]
    fn sse_handles_split_chunks() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::OpenAiChat);
        acc.feed(b"data: {\"usage\":{\"prompt_tokens\":5,");
        acc.feed(b"\"completion_tokens\":7}}\n\n");
        assert_eq!(acc.finish(), tu(5, 7, 0, 0));
    }

    #[test]
    fn responses_input_excludes_cache_read() {
        // 复现图片里的真实场景：OpenAI Responses 的 input_tokens 已含 cache_read。
        // input_tokens=13319, output_tokens=29, cache_read_input_tokens=8192
        // 归一化后净输入 = 13319 - 8192 = 5127，合计 = 5127 + 29 + 8192 = 13348
        let body = json!({ "usage": {
            "input_tokens": 13319,
            "output_tokens": 29,
            "total_tokens": 13348,
            "cache_read_input_tokens": 8192,
            "reasoning_output_tokens": 0
        } });
        let u = from_response(&body, UpstreamFormat::OpenAiResponses);
        assert_eq!(u, tu(5127, 29, 0, 8192));
        assert_eq!(u.input + u.output + u.cache_creation + u.cache_read, 13348);
    }

    #[test]
    fn net_input_clamps_to_zero_when_cache_exceeds_input() {
        // 上游偶发 cache_read > input 时，净输入截断到 0，不出现负数
        let body = json!({ "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 5,
            "prompt_tokens_details": { "cached_tokens": 20 }
        } });
        assert_eq!(
            from_response(&body, UpstreamFormat::OpenAiChat),
            tu(0, 5, 0, 20)
        );
    }

    // issue #13：流式超时导致 response.completed 未到达 → usage 保持 0（output 无最终事件）。
    // 这正是 ccMesh 在 300s 截断后记录 0 token 的下游机制；forward.rs 侧已把断流标 is_error=true。
    #[test]
    fn responses_sse_incomplete_stream_yields_zero_when_completed_event_missing() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::OpenAiResponses);
        // 只收到中间事件（无 response.usage / 顶层 usage），流被截断
        acc.feed(b"data: {\"type\":\"response.created\"}\n\n");
        acc.feed(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n\n");
        assert_eq!(acc.finish(), tu(0, 0, 0, 0));
    }

    // 对照：response.completed 事件到达时 usage 正常解析。
    #[test]
    fn responses_sse_completed_event_provides_usage() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::OpenAiResponses);
        acc.feed(b"data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":100,\"output_tokens\":50}}}\n\n");
        assert_eq!(acc.finish(), tu(100, 50, 0, 0));
    }
}
