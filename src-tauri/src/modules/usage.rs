use serde_json::Value;

use crate::modules::transform::transformer::UpstreamFormat;

/// 一次请求的真实 token 用量（含缓存创建/读取）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct TokenUsage {
    pub input: i64,
    pub output: i64,
    pub cache_creation: i64,
    pub cache_read: i64,
    /// 输出 token 来自字符估算（上游没给 usage）。日聚合不计入，监控里用 ≈ 标出。
    pub output_estimated: bool,
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
        UpstreamFormat::Claude => {
            let usage_val = usage.unwrap_or(&Value::Null);
            TokenUsage {
                input: first_field(usage, &["input_tokens", "prompt_tokens"]),
                output: output_with_reasoning(
                    usage_val,
                    first_field(usage, &["output_tokens", "completion_tokens"]),
                ),
                cache_creation: field(usage, "cache_creation_input_tokens"),
                cache_read: cache_read_tokens(usage),
                output_estimated: false,
            }
        }
        UpstreamFormat::OpenAiChat => {
            let cache_read = cache_read_tokens(usage);
            let usage_val = usage.unwrap_or(&Value::Null);
            TokenUsage {
                input: net_input(
                    first_field(usage, &["prompt_tokens", "input_tokens"]),
                    cache_read,
                ),
                output: output_with_reasoning(
                    usage_val,
                    first_field(usage, &["completion_tokens", "output_tokens"]),
                ),
                cache_creation: field(usage, "cache_creation_input_tokens"),
                cache_read,
                output_estimated: false,
            }
        }
        // Responses：usage.input_tokens / output_tokens / input_tokens_details.cached_tokens。
        UpstreamFormat::OpenAiResponses => {
            let cache_read = cache_read_tokens(usage);
            let usage_val = usage.unwrap_or(&Value::Null);
            TokenUsage {
                input: net_input(
                    first_field(usage, &["input_tokens", "prompt_tokens"]),
                    cache_read,
                ),
                output: output_with_reasoning(
                    usage_val,
                    first_field(usage, &["output_tokens", "completion_tokens"]),
                ),
                cache_creation: field(usage, "cache_creation_input_tokens"),
                cache_read,
                output_estimated: false,
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

/// xAI 把 reasoning 记在 output 之外，OpenAI 已经折进 completion/output。
/// 只有 `total_tokens` 对不上 `input + output` 时才把差额补进输出。
/// 口径来自 sub2api `xai.IncludeIndependentReasoningTokens`。
/// ponytail: 不把 cache 从 gap 里再扣一次。Claude 通常没有 total/reasoning，不受影响；
/// 若某家同时把 cache 和独立 reasoning 塞进 total，会多算一截，升级路径是先减 cache 再比 gap。
pub fn output_with_reasoning(usage: &Value, output: i64) -> i64 {
    let reasoning = [
        nested_field(
            Some(usage),
            &["completion_tokens_details", "reasoning_tokens"],
        ),
        nested_field(Some(usage), &["output_tokens_details", "reasoning_tokens"]),
    ]
    .into_iter()
    .find(|v| *v > 0)
    .unwrap_or(0);
    let raw_input = first_field(Some(usage), &["prompt_tokens", "input_tokens"]);
    let total = field(Some(usage), "total_tokens");
    include_independent_reasoning(raw_input, output, total, reasoning)
}

fn include_independent_reasoning(raw_input: i64, output: i64, total: i64, reasoning: i64) -> i64 {
    if raw_input < 0 || output < 0 || reasoning <= 0 || total <= 0 {
        return output;
    }
    if total == raw_input + output {
        return output;
    }
    let gap = total - raw_input - output;
    if gap <= 0 {
        return output;
    }
    output + gap.min(reasoning)
}

/// 上游 usage 的 output 仍为 0 时，用已看到的输出字符估算，并打上 `output_estimated`。
pub fn apply_output_estimate(mut tu: TokenUsage, observed: &OutputObserver) -> TokenUsage {
    if tu.output > 0 {
        return tu;
    }
    let est = observed.estimated_tokens();
    if est > 0 {
        tu.output = est;
        tu.output_estimated = true;
    }
    tu
}

/// 非流式 JSON：usage 缺失时从最终正文估算输出 token。
pub fn apply_body_output_estimate(
    tu: TokenUsage,
    body: &Value,
    format: UpstreamFormat,
) -> TokenUsage {
    if tu.output > 0 {
        return tu;
    }
    let mut obs = OutputObserver::default();
    obs.absorb_final(body, format);
    apply_output_estimate(tu, &obs)
}

/// 流式里看见的输出文本。增量 delta 与最终快照分开，避免 completed 把全文再加一遍。
#[derive(Debug, Default)]
pub struct OutputObserver {
    first_visible: bool,
    incremental: String,
    snapshot: String,
}

impl OutputObserver {
    /// 喂一条 SSE JSON。首次出现非空内容/推理/工具参数时返回 true。
    pub fn observe(&mut self, event: &Value, format: UpstreamFormat) -> bool {
        let before = self.first_visible;
        match format {
            UpstreamFormat::Claude => {
                absorb_claude(event, &mut self.incremental, &mut self.snapshot)
            }
            UpstreamFormat::OpenAiChat => {
                absorb_chat(event, &mut self.incremental, &mut self.snapshot, true)
            }
            UpstreamFormat::OpenAiResponses => {
                absorb_responses(event, &mut self.incremental, &mut self.snapshot, true)
            }
        }
        self.first_visible = !self.incremental.is_empty() || !self.snapshot.is_empty();
        !before && self.first_visible
    }

    pub fn has_visible(&self) -> bool {
        self.first_visible
    }

    fn absorb_final(&mut self, body: &Value, format: UpstreamFormat) {
        match format {
            UpstreamFormat::Claude => {
                absorb_claude_content(body.get("content"), &mut self.snapshot);
            }
            UpstreamFormat::OpenAiChat => {
                absorb_chat(body, &mut self.incremental, &mut self.snapshot, false);
            }
            UpstreamFormat::OpenAiResponses => {
                absorb_responses(body, &mut self.incremental, &mut self.snapshot, false);
            }
        }
        self.first_visible = !self.incremental.is_empty() || !self.snapshot.is_empty();
    }

    pub fn estimated_tokens(&self) -> i64 {
        // 有增量就只用增量；只有快照（非流式，或流里只有 completed）才用快照。
        let src = if !self.incremental.is_empty() {
            self.incremental.as_str()
        } else {
            self.snapshot.as_str()
        };
        if src.is_empty() {
            0
        } else {
            crate::modules::tokens::estimate_text(src)
        }
    }
}

fn push_str(buf: &mut String, s: &str) {
    if !s.is_empty() {
        buf.push_str(s);
    }
}

fn push_val_str(buf: &mut String, v: Option<&Value>) {
    if let Some(s) = v.and_then(|v| v.as_str()) {
        push_str(buf, s);
    }
}

fn absorb_claude(event: &Value, incremental: &mut String, snapshot: &mut String) {
    match event.get("type").and_then(|t| t.as_str()) {
        Some("content_block_delta") => {
            let delta = event.get("delta");
            match delta.and_then(|d| d.get("type")).and_then(|t| t.as_str()) {
                Some("text_delta") => push_val_str(incremental, delta.and_then(|d| d.get("text"))),
                Some("thinking_delta") => {
                    push_val_str(incremental, delta.and_then(|d| d.get("thinking")))
                }
                Some("input_json_delta") => {
                    push_val_str(incremental, delta.and_then(|d| d.get("partial_json")))
                }
                _ => {}
            }
        }
        Some("content_block_start") => {
            absorb_claude_block(event.get("content_block"), incremental);
        }
        // message_start / ping / message_delta 没有可见 token。
        _ => {
            if incremental.is_empty() {
                if let Some(content) = event.pointer("/message/content") {
                    let mut snap = String::new();
                    absorb_claude_content(Some(content), &mut snap);
                    if !snap.is_empty() {
                        *snapshot = snap;
                    }
                }
            }
        }
    }
}

fn absorb_claude_content(content: Option<&Value>, buf: &mut String) {
    let Some(Value::Array(blocks)) = content else {
        if let Some(Value::String(s)) = content {
            push_str(buf, s);
        }
        return;
    };
    for block in blocks {
        absorb_claude_block(Some(block), buf);
    }
}

fn absorb_claude_block(block: Option<&Value>, buf: &mut String) {
    let Some(block) = block else { return };
    match block.get("type").and_then(|t| t.as_str()) {
        Some("text") => push_val_str(buf, block.get("text")),
        Some("thinking") => push_val_str(buf, block.get("thinking")),
        Some("tool_use") => {
            // content_block_start 常带空 input `{}`，那还不是参数 token。
            if let Some(input) = block.get("input") {
                if input.is_object() && input.as_object().is_some_and(|o| o.is_empty()) {
                    return;
                }
                if !input.is_null() {
                    push_str(buf, &input.to_string());
                }
            }
        }
        _ => {}
    }
}

fn absorb_chat(event: &Value, incremental: &mut String, snapshot: &mut String, stream: bool) {
    let Some(choices) = event.get("choices").and_then(|c| c.as_array()) else {
        return;
    };
    for ch in choices {
        if stream {
            if let Some(delta) = ch.get("delta") {
                push_chat_parts(delta, incremental);
            }
        } else if let Some(message) = ch.get("message") {
            let mut snap = String::new();
            push_chat_parts(message, &mut snap);
            if !snap.is_empty() {
                snapshot.push_str(&snap);
            }
        }
    }
}

fn push_chat_parts(node: &Value, buf: &mut String) {
    match node.get("content") {
        Some(Value::String(s)) => push_str(buf, s),
        Some(Value::Array(parts)) => {
            for part in parts {
                push_val_str(buf, part.get("text"));
                push_val_str(buf, part.get("refusal"));
            }
        }
        _ => {}
    }
    push_val_str(buf, node.get("refusal"));
    push_val_str(buf, node.get("reasoning_content"));
    match node.get("reasoning") {
        Some(Value::String(s)) => push_str(buf, s),
        Some(obj) => {
            push_val_str(buf, obj.get("content"));
            push_val_str(buf, obj.get("text"));
        }
        None => {}
    }
    if let Some(calls) = node.get("tool_calls").and_then(|v| v.as_array()) {
        for call in calls {
            push_val_str(
                buf,
                call.pointer("/function/arguments")
                    .or_else(|| call.get("arguments")),
            );
        }
    }
}

fn absorb_responses(event: &Value, incremental: &mut String, snapshot: &mut String, stream: bool) {
    let etype = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
    if stream && etype.ends_with(".delta") {
        match event.get("delta") {
            Some(Value::String(s)) => push_str(incremental, s),
            Some(obj) => {
                push_val_str(incremental, obj.get("text"));
                push_val_str(incremental, obj.get("content"));
            }
            None => {}
        }
        return;
    }
    if stream && !incremental.is_empty() {
        return;
    }
    let mut snap = String::new();
    if etype.ends_with(".done") {
        push_val_str(&mut snap, event.get("text"));
        push_val_str(&mut snap, event.get("arguments"));
        push_val_str(&mut snap, event.get("input"));
    }
    if let Some(item) = event.get("item") {
        push_responses_item(item, &mut snap);
    }
    let output = event
        .get("output")
        .or_else(|| event.pointer("/response/output"));
    if let Some(Value::Array(items)) = output {
        for item in items {
            push_responses_item(item, &mut snap);
        }
    }
    if !snap.is_empty() {
        *snapshot = snap;
    }
}

fn push_responses_item(item: &Value, buf: &mut String) {
    push_val_str(buf, item.get("arguments"));
    push_val_str(buf, item.get("input"));
    if let Some(Value::Array(parts)) = item.get("content") {
        for part in parts {
            push_val_str(buf, part.get("text"));
            push_val_str(buf, part.get("refusal"));
        }
    }
    if let Some(Value::Array(parts)) = item.get("summary") {
        for part in parts {
            push_val_str(buf, part.get("text"));
        }
    }
}

/// Chat Completions 末尾单独的 usage 帧：`choices: []` 且带 usage。
/// 客户端没要 `include_usage` 时从下行流里拿掉，统计仍用原始帧。
pub fn is_openai_chat_usage_only_chunk(v: &Value) -> bool {
    let Some(usage) = v.get("usage") else {
        return false;
    };
    if usage.is_null() || !usage.is_object() {
        return false;
    }
    matches!(v.get("choices"), Some(Value::Array(a)) if a.is_empty())
}

/// 按行过滤 SSE。`enabled` 为 false 时原样透传。
pub struct SseUsageStripper {
    enabled: bool,
    buf: String,
}

impl SseUsageStripper {
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            buf: String::new(),
        }
    }

    pub fn push(&mut self, chunk: &[u8]) -> Vec<u8> {
        if !self.enabled {
            return chunk.to_vec();
        }
        self.buf.push_str(&String::from_utf8_lossy(chunk));
        let mut out = String::new();
        while let Some(nl) = self.buf.find('\n') {
            let line: String = self.buf.drain(..=nl).collect();
            if !usage_only_sse_line(&line) {
                out.push_str(&line);
            }
        }
        out.into_bytes()
    }

    pub fn finish(&mut self) -> Vec<u8> {
        if !self.enabled || self.buf.is_empty() {
            return Vec::new();
        }
        let rest = std::mem::take(&mut self.buf);
        if usage_only_sse_line(&rest) {
            Vec::new()
        } else {
            rest.into_bytes()
        }
    }
}

fn usage_only_sse_line(line: &str) -> bool {
    let trimmed = line.trim();
    let Some(data) = trimmed.strip_prefix("data:") else {
        return false;
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return false;
    }
    serde_json::from_str::<Value>(data)
        .map(|v| is_openai_chat_usage_only_chunk(&v))
        .unwrap_or(false)
}

/// 流式 SSE token 用量累积器：逐分片喂入，按行解析 `data:` JSON，结束读出 `TokenUsage`。
pub struct UsageAccumulator {
    format: UpstreamFormat,
    buf: String,
    input: i64,
    output: i64,
    cache_creation: i64,
    cache_read: i64,
    observer: OutputObserver,
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
            observer: OutputObserver::default(),
        }
    }

    /// 已经看到非空内容/推理/工具参数。首字计时用这个，不用第一个 SSE 分片。
    pub fn has_visible_output(&self) -> bool {
        self.observer.has_visible()
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
        self.observer.observe(j, self.format);
        match self.format {
            UpstreamFormat::Claude => match j.get("type").and_then(|v| v.as_str()) {
                // message_start 的 output_tokens 是占位（常见为 0 或 1），最终值在 message_delta。
                // 与 sub2api parseSSEUsagePassthrough 一致：这里不采 output，避免截断时把占位当成真实输出。
                Some("message_start") => {
                    if let Some(u) = j.get("message").and_then(|m| m.get("usage")) {
                        if let Some(i) = u.get("input_tokens").and_then(|v| v.as_i64()) {
                            self.input = i;
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
                            self.output = output_with_reasoning(u, o);
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
                            self.output = output_with_reasoning(u, o);
                        } else {
                            self.output = output_with_reasoning(u, self.output);
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
                            self.output = output_with_reasoning(u, o);
                        } else {
                            self.output = output_with_reasoning(u, self.output);
                        }
                    }
                }
            }
        }
    }

    pub fn finish(self) -> TokenUsage {
        apply_output_estimate(
            TokenUsage {
                input: self.input,
                output: self.output,
                cache_creation: self.cache_creation,
                cache_read: self.cache_read,
                output_estimated: false,
            },
            &self.observer,
        )
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
            output_estimated: false,
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

    // 流被截断、没有 response.completed 时没有真实 usage。已流出的文本按字符估算，避免记 0。
    #[test]
    fn responses_sse_incomplete_stream_estimates_output_from_deltas() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::OpenAiResponses);
        acc.feed(b"data: {\"type\":\"response.created\"}\n\n");
        assert!(!acc.has_visible_output());
        acc.feed(b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n\n");
        assert!(acc.has_visible_output());
        let tu = acc.finish();
        assert!(tu.output_estimated);
        assert!(tu.output >= 1);
        assert_eq!(tu.input, 0);
    }

    // 对照：response.completed 事件到达时 usage 正常解析。
    #[test]
    fn responses_sse_completed_event_provides_usage() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::OpenAiResponses);
        acc.feed(b"data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":100,\"output_tokens\":50}}}\n\n");
        let got = acc.finish();
        assert_eq!(got, tu(100, 50, 0, 0));
        assert!(!got.output_estimated);
    }

    #[test]
    fn independent_reasoning_is_added_only_when_total_excludes_it() {
        // xAI：completion 9 + reasoning 94，total 135 = 32 + 9 + 94
        let grok = json!({ "usage": {
            "prompt_tokens": 32,
            "completion_tokens": 9,
            "total_tokens": 135,
            "completion_tokens_details": { "reasoning_tokens": 94 }
        }});
        assert_eq!(from_response(&grok, UpstreamFormat::OpenAiChat).output, 103);

        // OpenAI：completion 已含 reasoning，total = input + output
        let openai = json!({ "usage": {
            "input_tokens": 32,
            "output_tokens": 103,
            "total_tokens": 135,
            "output_tokens_details": { "reasoning_tokens": 94 }
        }});
        assert_eq!(
            from_response(&openai, UpstreamFormat::OpenAiResponses).output,
            103
        );

        let partial = json!({ "usage": {
            "input_tokens": 10000,
            "output_tokens": 500,
            "total_tokens": 10800,
            "output_tokens_details": { "reasoning_tokens": 300 }
        }});
        assert_eq!(
            from_response(&partial, UpstreamFormat::OpenAiResponses).output,
            800
        );
    }

    #[test]
    fn visible_output_ignores_preamble_and_empty_role_delta() {
        let mut obs = OutputObserver::default();
        assert!(!obs.observe(
            &json!({"type":"message_start","message":{"usage":{"output_tokens":1}}}),
            UpstreamFormat::Claude
        ));
        assert!(!obs.observe(&json!({"type":"ping"}), UpstreamFormat::Claude));
        assert!(!obs.observe(
            &json!({"choices":[{"delta":{"role":"assistant"}}]}),
            UpstreamFormat::OpenAiChat
        ));
        assert!(obs.observe(
            &json!({"choices":[{"delta":{"content":"hi"}}]}),
            UpstreamFormat::OpenAiChat
        ));
        assert!(!obs.observe(
            &json!({"choices":[{"delta":{"content":"!"}}]}),
            UpstreamFormat::OpenAiChat
        ));
    }

    #[test]
    fn claude_thinking_delta_counts_as_visible_and_estimates_when_usage_missing() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::Claude);
        acc.feed(b"event: ping\ndata: {\"type\":\"ping\"}\n\n");
        assert!(!acc.has_visible_output());
        acc.feed(b"data: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":10,\"output_tokens\":1}}}\n\n");
        acc.feed(b"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"abcd\"}}\n\n");
        assert!(acc.has_visible_output());
        let tu = acc.finish();
        assert_eq!(tu.input, 10);
        assert!(tu.output_estimated);
        assert!(tu.output >= 1);
    }

    #[test]
    fn real_usage_wins_over_character_estimate() {
        let mut acc = UsageAccumulator::new(UpstreamFormat::OpenAiChat);
        acc.feed(b"data: {\"choices\":[{\"delta\":{\"content\":\"hello world\"}}]}\n\n");
        acc.feed(
            b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":8}}\n\n",
        );
        let tu = acc.finish();
        assert_eq!(tu.output, 8);
        assert!(!tu.output_estimated);
    }

    #[test]
    fn non_stream_body_estimates_when_usage_missing() {
        let body = json!({
            "choices": [{ "message": { "content": "hello world" } }]
        });
        let tu = apply_body_output_estimate(
            from_response(&body, UpstreamFormat::OpenAiChat),
            &body,
            UpstreamFormat::OpenAiChat,
        );
        assert!(tu.output_estimated);
        assert!(tu.output >= 1);
    }

    #[test]
    fn usage_only_chunk_detected_and_stripped() {
        let chunk = json!({"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":2}});
        assert!(is_openai_chat_usage_only_chunk(&chunk));
        assert!(!is_openai_chat_usage_only_chunk(
            &json!({"choices":[{"delta":{"content":"a"}}],"usage":{"completion_tokens":1}})
        ));
        let mut strip = SseUsageStripper::new(true);
        let mut out = String::from_utf8(
            strip.push(b"data: {\"choices\":[{\"delta\":{\"content\":\"a\"}}]}\n\n"),
        )
        .unwrap();
        out.push_str(&String::from_utf8(strip.push(
            b"data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n",
        )).unwrap());
        out.push_str(&String::from_utf8(strip.finish()).unwrap());
        assert!(out.contains("content"));
        assert!(out.contains("[DONE]"));
        assert!(!out.contains("completion_tokens"));
    }
}
