use serde_json::{json, Value};

use crate::modules::transform::types::{
    build_claude_event, map_finish_reason, StreamContext, ToolBlock,
};

/// 有状态的流式转换器：逐个消费 OpenAI Chat 流 chunk，产出 Claude SSE 事件文本。
///
/// 用法：每收到一个上游 `data:` chunk JSON 调用 [`process_chunk`]，
/// 收到 `data: [DONE]` 时调用 [`finish`] 收尾。
pub struct StreamConverter {
    ctx: StreamContext,
    stop_reason: String,
    saw_finish: bool,
}

impl StreamConverter {
    pub fn new(model: String, input_tokens: i64) -> Self {
        let mut ctx = StreamContext::default();
        ctx.model_name = model;
        ctx.input_tokens = input_tokens;
        Self {
            ctx,
            stop_reason: "end_turn".to_string(),
            saw_finish: false,
        }
    }

    /// 当前累积的真实 token 用量，供流结束后统计记录。
    pub fn usage(&self) -> (i64, i64, i64, i64) {
        (
            self.ctx.input_tokens,
            self.ctx.output_tokens,
            self.ctx.cache_creation_tokens,
            self.ctx.cache_read_tokens,
        )
    }

    fn message_start(&mut self, id: &Value, events: &mut Vec<String>) {
        if self.ctx.message_start_sent {
            return;
        }
        self.ctx.message_start_sent = true;
        events.push(build_claude_event(
            "message_start",
            &json!({
                "type": "message_start",
                "message": {
                    "id": id.clone(),
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": self.ctx.model_name,
                    "stop_reason": Value::Null,
                    "stop_sequence": Value::Null,
                    "usage": {
                        "input_tokens": self.ctx.input_tokens,
                        "output_tokens": 0,
                        "cache_creation_input_tokens": self.ctx.cache_creation_tokens,
                        "cache_read_input_tokens": self.ctx.cache_read_tokens
                    }
                }
            }),
        ));
    }

    fn ensure_thinking_block(&mut self, events: &mut Vec<String>) {
        if self.ctx.thinking_block_started {
            return;
        }
        // text 与 thinking 不能共用 index：先 stop 再 start，否则 Claude Code 报 Content block not found
        self.close_text(events);
        self.ctx.thinking_block_started = true;
        events.push(build_claude_event(
            "content_block_start",
            &json!({
                "type": "content_block_start",
                "index": self.ctx.block_index,
                "content_block": { "type": "thinking", "thinking": "" }
            }),
        ));
    }

    fn ensure_text_block(&mut self, events: &mut Vec<String>) {
        if self.ctx.text_block_started {
            return;
        }
        self.close_thinking(events);
        self.ctx.text_block_started = true;
        events.push(build_claude_event(
            "content_block_start",
            &json!({
                "type": "content_block_start",
                "index": self.ctx.block_index,
                "content_block": { "type": "text", "text": "" }
            }),
        ));
    }

    fn close_block_if<F: Fn(&StreamContext) -> bool>(
        &mut self,
        is_open: F,
        clear: fn(&mut StreamContext),
        events: &mut Vec<String>,
    ) {
        if is_open(&self.ctx) {
            events.push(build_claude_event(
                "content_block_stop",
                &json!({ "type": "content_block_stop", "index": self.ctx.block_index }),
            ));
            clear(&mut self.ctx);
            self.ctx.block_index += 1;
        }
    }

    fn close_thinking(&mut self, events: &mut Vec<String>) {
        self.close_block_if(
            |c| c.thinking_block_started,
            |c| c.thinking_block_started = false,
            events,
        );
    }
    fn close_text(&mut self, events: &mut Vec<String>) {
        self.close_block_if(
            |c| c.text_block_started,
            |c| c.text_block_started = false,
            events,
        );
    }
    /// 关闭所有仍开启的工具块（按 Anthropic 块索引升序），并清空映射。
    fn close_all_tool_blocks(&mut self, events: &mut Vec<String>) {
        if self.ctx.tool_blocks.is_empty() {
            return;
        }
        let mut indices: Vec<i64> = self
            .ctx
            .tool_blocks
            .values()
            .map(|b| b.anthropic_index)
            .collect();
        indices.sort_unstable();
        for idx in indices {
            events.push(build_claude_event(
                "content_block_stop",
                &json!({ "type": "content_block_stop", "index": idx }),
            ));
        }
        self.ctx.tool_blocks.clear();
    }

    fn close_open_blocks(&mut self, events: &mut Vec<String>) {
        self.close_text(events);
        self.close_thinking(events);
        self.close_all_tool_blocks(events);
    }

    fn handle_tool_call(&mut self, tc: &Value, events: &mut Vec<String>) {
        // OpenAI 流以 tool_calls[].index 区分多个（并行）工具调用；缺省视为 0。
        let openai_index = tc.get("index").and_then(|v| v.as_i64()).unwrap_or(0);
        let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let func = tc.get("function");

        // 首次见到该 index 且带 id → 开启新工具块（工具块排在文本/思考块之后）。
        if !id.is_empty() && !self.ctx.tool_blocks.contains_key(&openai_index) {
            self.close_text(events);
            self.close_thinking(events);
            let name = func
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let anthropic_index = self.ctx.block_index;
            self.ctx.block_index += 1;
            self.ctx
                .tool_blocks
                .insert(openai_index, ToolBlock { anthropic_index });
            self.ctx.any_tool_started = true;
            events.push(build_claude_event(
                "content_block_start",
                &json!({
                    "type": "content_block_start",
                    "index": anthropic_index,
                    "content_block": { "type": "tool_use", "id": id, "name": name, "input": {} }
                }),
            ));
        }

        // 参数片段 → 按 index 路由到对应工具块的 input_json_delta。
        if let Some(args) = func
            .and_then(|f| f.get("arguments"))
            .and_then(|v| v.as_str())
        {
            if !args.is_empty() {
                if let Some(block) = self.ctx.tool_blocks.get(&openai_index) {
                    let anthropic_index = block.anthropic_index;
                    events.push(build_claude_event(
                        "content_block_delta",
                        &json!({
                            "type": "content_block_delta",
                            "index": anthropic_index,
                            "delta": { "type": "input_json_delta", "partial_json": args }
                        }),
                    ));
                }
            }
        }
    }

    /// 处理一个 OpenAI chunk JSON，返回应发出的 Claude SSE 事件文本。
    pub fn process_chunk(&mut self, chunk: &Value) -> Vec<String> {
        let mut events = Vec::new();
        let id = chunk.get("id").cloned().unwrap_or(json!(""));
        self.message_start(&id, &mut events);

        if let Some(usage) = chunk.get("usage") {
            if !usage.is_null() {
                // 先取 cache_read，再算净输入：OpenAI 的 prompt_tokens/input_tokens
                // 已含 cached_tokens，需扣除以对齐 Claude 语义（input_tokens 不含缓存），
                // 避免回传给 Claude 客户端的 input_tokens 仍含缓存导致合计双重计算。
                if let Some(cr) = cache_read_tokens(usage) {
                    self.ctx.cache_read_tokens = cr;
                }
                if let Some(it) = usage
                    .get("prompt_tokens")
                    .or_else(|| usage.get("input_tokens"))
                    .and_then(|v| v.as_i64())
                {
                    self.ctx.input_tokens = (it - self.ctx.cache_read_tokens).max(0);
                }
                if let Some(ot) = usage
                    .get("completion_tokens")
                    .or_else(|| usage.get("output_tokens"))
                    .and_then(|v| v.as_i64())
                {
                    self.ctx.output_tokens = ot;
                }
                if let Some(cc) = usage
                    .get("cache_creation_input_tokens")
                    .and_then(|v| v.as_i64())
                {
                    self.ctx.cache_creation_tokens = cc;
                }
            }
        }

        let choice = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first());

        if let Some(ch) = choice {
            let delta = ch.get("delta");

            if let Some(reason) = delta.and_then(delta_reasoning_text) {
                self.ensure_thinking_block(&mut events);
                events.push(build_claude_event(
                    "content_block_delta",
                    &json!({
                        "type": "content_block_delta",
                        "index": self.ctx.block_index,
                        "delta": { "type": "thinking_delta", "thinking": reason }
                    }),
                ));
            }

            if let Some(text) = delta
                .and_then(|d| d.get("content"))
                .and_then(|v| v.as_str())
            {
                if !text.is_empty() {
                    self.ensure_text_block(&mut events);
                    events.push(build_claude_event(
                        "content_block_delta",
                        &json!({
                            "type": "content_block_delta",
                            "index": self.ctx.block_index,
                            "delta": { "type": "text_delta", "text": text }
                        }),
                    ));
                }
            }

            if let Some(tcs) = delta
                .and_then(|d| d.get("tool_calls"))
                .and_then(|v| v.as_array())
            {
                for tc in tcs {
                    self.handle_tool_call(tc, &mut events);
                }
            }

            if let Some(fr) = ch.get("finish_reason").and_then(|v| v.as_str()) {
                self.stop_reason =
                    map_finish_reason(Some(fr), self.ctx.any_tool_started).to_string();
                self.close_open_blocks(&mut events);
                self.saw_finish = true;
            }
        }

        events
    }

    /// 收到 `data: [DONE]` 时调用：收尾未关闭块、发 message_delta 与 message_stop。
    pub fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();
        if !self.ctx.message_start_sent {
            self.message_start(&json!(""), &mut events);
        }
        self.close_open_blocks(&mut events);
        if !self.ctx.message_stop_sent {
            events.push(build_claude_event(
                "message_delta",
                &json!({
                    "type": "message_delta",
                    "delta": { "stop_reason": self.stop_reason, "stop_sequence": Value::Null },
                    // 流末才拿到上游完整 usage（message_start 时还没到），在此回传 input/cache 给客户端
                    "usage": {
                        "input_tokens": self.ctx.input_tokens,
                        "output_tokens": self.ctx.output_tokens,
                        "cache_creation_input_tokens": self.ctx.cache_creation_tokens,
                        "cache_read_input_tokens": self.ctx.cache_read_tokens
                    }
                }),
            ));
            events.push(build_claude_event(
                "message_stop",
                &json!({ "type": "message_stop" }),
            ));
            self.ctx.message_stop_sent = true;
        }
        let _ = self.saw_finish;
        events
    }
}

/// Chat 上游思考字段：`reasoning_content`（DeepSeek）或 `reasoning`（OpenRouter/Kimi/部分 GPT 网关）。
fn delta_reasoning_text(delta: &Value) -> Option<&str> {
    for key in ["reasoning_content", "reasoning"] {
        if let Some(text) = delta
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return Some(text);
        }
    }
    let reasoning = delta.get("reasoning")?;
    for key in ["content", "text"] {
        if let Some(text) = reasoning
            .get(key)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
        {
            return Some(text);
        }
    }
    None
}

fn cache_read_tokens(usage: &Value) -> Option<i64> {
    usage
        .get("cache_read_input_tokens")
        .or_else(|| usage.pointer("/input_tokens_details/cached_tokens"))
        .or_else(|| usage.pointer("/prompt_tokens_details/cached_tokens"))
        .or_else(|| usage.get("cached_tokens"))
        .and_then(|v| v.as_i64())
        .filter(|v| *v > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn join(events: Vec<String>) -> String {
        events.join("")
    }

    #[test]
    fn text_stream_emits_message_start_then_text_then_stop() {
        let mut c = StreamConverter::new("gpt-4o".into(), 5);
        let e1 = join(c.process_chunk(&json!({
            "id": "x", "choices": [{ "delta": { "content": "Hi" }, "finish_reason": Value::Null }]
        })));
        assert!(e1.contains("event: message_start"));
        assert!(e1.contains("event: content_block_start"));
        assert!(e1.contains("\"type\":\"text\""));
        assert!(e1.contains("event: content_block_delta"));
        assert!(e1.contains("\"text_delta\""));

        let e2 = join(c.process_chunk(&json!({
            "choices": [{ "delta": {}, "finish_reason": "stop" }]
        })));
        assert!(e2.contains("event: content_block_stop"));

        let done = join(c.finish());
        assert!(done.contains("event: message_delta"));
        assert!(done.contains("\"stop_reason\":\"end_turn\""));
        assert!(done.contains("event: message_stop"));
    }

    #[test]
    fn tool_stream_emits_tool_use_block_and_input_json_delta() {
        let mut c = StreamConverter::new("gpt-4o".into(), 0);
        c.process_chunk(&json!({ "id": "x", "choices": [{ "delta": { "content": "" } }] }));
        let e = join(c.process_chunk(&json!({
            "choices": [{ "delta": { "tool_calls": [
                { "id": "t1", "function": { "name": "f", "arguments": "{\"a\":" } }
            ]}}]
        })));
        assert!(e.contains("\"type\":\"tool_use\""));
        assert!(e.contains("\"input_json_delta\""));
        assert!(e.contains("\"partial_json\":\"{\\\"a\\\":\""));

        let fin = join(c.process_chunk(&json!({
            "choices": [{ "delta": {}, "finish_reason": "tool_calls" }]
        })));
        assert!(fin.contains("event: content_block_stop"));
        let done = join(c.finish());
        assert!(done.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn two_tools_by_index_do_not_mix() {
        let mut c = StreamConverter::new("m".into(), 0);
        let e0 = join(c.process_chunk(&json!({
            "id": "x", "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_a", "function": { "name": "fa", "arguments": "{\"x\":1}" } }
            ]}}]
        })));
        let e1 = join(c.process_chunk(&json!({
            "choices": [{ "delta": { "tool_calls": [
                { "index": 1, "id": "call_b", "function": { "name": "fb", "arguments": "{\"y\":2}" } }
            ]}}]
        })));
        // 两个工具各自成块，id/name 不串味
        assert!(e0.contains("\"id\":\"call_a\"") && e0.contains("\"name\":\"fa\""));
        assert!(!e0.contains("call_b"));
        assert!(e1.contains("\"id\":\"call_b\"") && e1.contains("\"name\":\"fb\""));
        assert!(!e1.contains("call_a"));
        // tool0 → Anthropic block 0，tool1 → block 1
        assert!(e0.contains("\"content_block_start\"") && e0.contains("\"index\":0"));
        assert!(e1.contains("\"content_block_start\"") && e1.contains("\"index\":1"));

        // 交错的后续参数片段按 index 路由回 tool0（block 0）
        let e2 = join(c.process_chunk(&json!({
            "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "function": { "arguments": ",\"z\":3" } }
            ]}}]
        })));
        assert!(e2.contains("\"input_json_delta\"") && e2.contains("\"index\":0"));
        assert!(e2.contains("\"partial_json\":\",\\\"z\\\":3\""));

        let fin = join(c.process_chunk(&json!({
            "choices": [{ "delta": {}, "finish_reason": "tool_calls" }]
        })));
        assert!(fin.contains("event: content_block_stop"));
        let done = join(c.finish());
        assert!(done.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn usage_chunk_updates_output_tokens() {
        let mut c = StreamConverter::new("m".into(), 3);
        c.process_chunk(&json!({ "id": "x", "choices": [{ "delta": { "content": "y" } }] }));
        c.process_chunk(&json!({
            "choices": [],
            "usage": {
                "prompt_tokens": 3,
                "completion_tokens": 7,
                "prompt_tokens_details": { "cached_tokens": 2 }
            }
        }));
        let done = join(c.finish());
        assert!(done.contains("\"output_tokens\":7"));
        // prompt_tokens(3) 已含 cached_tokens(2)，净输入 3 - 2 = 1
        assert_eq!(c.usage(), (1, 7, 0, 2));
    }

    #[test]
    fn message_delta_carries_input_and_cache_read() {
        let mut c = StreamConverter::new("m".into(), 0);
        c.process_chunk(&json!({ "id": "x", "choices": [{ "delta": { "content": "hi" } }] }));
        // OpenAI 末尾 usage-only chunk（带缓存命中）
        c.process_chunk(&json!({
            "choices": [],
            "usage": {
                "prompt_tokens": 100,
                "completion_tokens": 50,
                "prompt_tokens_details": { "cached_tokens": 30 }
            }
        }));
        let done = join(c.finish());
        assert!(done.contains("event: message_delta"));
        // prompt_tokens(100) 已含 cached_tokens(30)，净输入 100 - 30 = 70
        assert!(done.contains("\"input_tokens\":70"));
        assert!(done.contains("\"output_tokens\":50"));
        assert!(done.contains("\"cache_read_input_tokens\":30"));
    }

    #[test]
    fn reasoning_before_text_uses_distinct_block_indexes() {
        let mut c = StreamConverter::new("gpt-5.5".into(), 0);
        let e0 = join(c.process_chunk(&json!({
            "id": "x",
            "choices": [{ "delta": { "reasoning_content": "hmm" }, "finish_reason": Value::Null }]
        })));
        assert!(e0.contains("\"type\":\"thinking\""));
        assert!(e0.contains("\"thinking_delta\""));
        assert!(e0.contains("\"index\":0"));

        let e1 = join(c.process_chunk(&json!({
            "choices": [{ "delta": { "content": "hi" }, "finish_reason": Value::Null }]
        })));
        assert!(e1.contains("event: content_block_stop"));
        assert!(e1.contains("\"type\":\"text\""));
        assert!(e1.contains("\"index\":1"));
    }

    #[test]
    fn text_before_reasoning_closes_text_before_thinking() {
        let mut c = StreamConverter::new("gpt-5.5".into(), 0);
        let e0 = join(c.process_chunk(&json!({
            "id": "x",
            "choices": [{ "delta": { "content": "---" } }]
        })));
        assert!(e0.contains("\"type\":\"text\""));
        assert!(e0.contains("\"index\":0"));

        let e1 = join(c.process_chunk(&json!({
            "choices": [{ "delta": { "reasoning_content": "think" } }]
        })));
        let stop_pos = e1
            .find("event: content_block_stop")
            .expect("must stop text first");
        let think_pos = e1
            .find("\"type\":\"thinking\"")
            .expect("must start thinking");
        assert!(stop_pos < think_pos);
        assert!(e1.contains("\"thinking_delta\""));
        assert!(e1.contains("\"index\":1"));
    }

    #[test]
    fn reasoning_field_alias_and_nested_content_emit_thinking() {
        let mut c = StreamConverter::new("m".into(), 0);
        let e = join(c.process_chunk(&json!({
            "id": "x",
            "choices": [{ "delta": { "reasoning": "plan" } }]
        })));
        assert!(e.contains("thinking_delta"));
        assert!(e.contains("plan"));

        let mut c2 = StreamConverter::new("m".into(), 0);
        let e2 = join(c2.process_chunk(&json!({
            "id": "y",
            "choices": [{ "delta": { "reasoning": { "content": "nested" } } }]
        })));
        assert!(e2.contains("thinking_delta"));
        assert!(e2.contains("nested"));
    }
}
