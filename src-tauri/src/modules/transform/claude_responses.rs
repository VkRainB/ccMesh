//! Claude Messages ↔ OpenAI Responses（codex 端点）转换。
//!
//! Claude 入站（/v1/messages）+ codex 端点：请求 Claude→Responses，响应 Responses（SSE/JSON）→Claude。
//! 映射规则对齐 claude-code-router 的 codex 路径（system→instructions、tool_use→function_call、
//! 强制 store=false + stream=true），tool_use 增强为边流边发（CCR 是 completed 时整包回放）。
//!
//! reasoning 闭环：上游 encrypted reasoning → `redacted_thinking`（data 打包 `{id, encrypted_content}`
//! JSON 串，客户端视为不透明字符串原样回传）→ 下一轮请求还原为 reasoning input item，
//! 保持 gpt-5-codex 多轮工具调用的推理连续性。

use serde_json::{json, Map, Value};
use std::collections::{HashMap, HashSet};

use crate::modules::transform::gpt_reasoning_effort::resolve_gpt_chat_reasoning_effort;
use crate::modules::transform::json_canonical::canonical_json_string;
use crate::modules::transform::types::{build_claude_event, extract_tool_result_content};

/// instructions 为空时的兜底短句（与 claude-code-router 一致，codex 上游要求非空）。
const DEFAULT_INSTRUCTIONS: &str = "You are a helpful assistant.";

// ============================================================ 请求：Claude → Responses

/// Claude Messages 请求 → OpenAI Responses 请求。`endpoint_model` 非空则覆盖请求 model。
///
/// 出站强制 `stream:true` + `store:false`（chatgpt backend 及多数中转均如此要求）；
/// 客户端非流式时由 forward 聚合 `response.completed` 再转回 Claude JSON。
pub fn claude_request_to_responses(claude: &Value, endpoint_model: Option<&str>) -> Value {
    let mut out = Map::new();

    // model：端点配置优先，否则请求 model
    let model = endpoint_model
        .filter(|m| !m.trim().is_empty())
        .map(|m| m.to_string())
        .or_else(|| {
            claude
                .get("model")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
        });
    if let Some(m) = model.as_deref() {
        out.insert("model".into(), json!(m));
        if let Some(effort) = resolve_gpt_chat_reasoning_effort(m, claude) {
            out.insert("reasoning".into(), json!({ "effort": effort }));
        }
    }

    if let Some(mt) = claude.get("max_tokens").and_then(|v| v.as_i64()) {
        if mt > 0 {
            out.insert("max_output_tokens".into(), json!(mt));
        }
    }
    if let Some(t) = claude.get("temperature").and_then(|v| v.as_f64()) {
        if t > 0.0 {
            out.insert("temperature".into(), json!(t));
        }
    }
    if let Some(p) = claude.get("top_p").and_then(|v| v.as_f64()) {
        out.insert("top_p".into(), json!(p));
    }

    out.insert("stream".into(), json!(true));
    out.insert("store".into(), json!(false));

    // system → instructions（空则兜底短句）
    let instructions = claude_system_text(claude.get("system"));
    out.insert(
        "instructions".into(),
        json!(if instructions.is_empty() {
            DEFAULT_INSTRUCTIONS.to_string()
        } else {
            instructions
        }),
    );

    // messages → input items
    let mut input: Vec<Value> = Vec::new();
    if let Some(arr) = claude.get("messages").and_then(|v| v.as_array()) {
        for msg in arr {
            convert_claude_message_to_input(msg, &mut input);
        }
    }
    out.insert("input".into(), json!(input));

    // tools（Responses 扁平 function 格式）+ tool_choice
    if let Some(tools) = claude.get("tools").and_then(|v| v.as_array()) {
        let mut otools = Vec::new();
        for t in tools {
            let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            otools.push(json!({
                "type": "function",
                "name": name,
                "description": t.get("description").cloned().unwrap_or(json!("")),
                "parameters": t.get("input_schema").cloned().unwrap_or(json!({ "type": "object" })),
            }));
        }
        if !otools.is_empty() {
            out.insert("tools".into(), json!(otools));
            out.insert(
                "tool_choice".into(),
                claude_tool_choice_to_responses(claude.get("tool_choice")),
            );
        }
    }

    Value::Object(out)
}

/// Claude `system`（string 或 text 块数组）→ 纯文本，块间以 `\n` 连接。
fn claude_system_text(system: Option<&Value>) -> String {
    match system {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(arr)) => arr
            .iter()
            .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
            .filter(|t| !t.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Claude `tool_choice` → Responses `tool_choice`。
/// auto/none 透传；any → required；`{type:tool, name}` → `{type:function, name}`。
fn claude_tool_choice_to_responses(tc: Option<&Value>) -> Value {
    match tc {
        Some(Value::String(s)) => match s.as_str() {
            "any" => json!("required"),
            "none" => json!("none"),
            _ => json!("auto"),
        },
        Some(Value::Object(o)) => match o.get("type").and_then(|v| v.as_str()) {
            Some("tool") => {
                let name = o.get("name").and_then(|v| v.as_str()).unwrap_or("");
                json!({ "type": "function", "name": name })
            }
            Some("any") => json!("required"),
            Some("none") => json!("none"),
            _ => json!("auto"),
        },
        _ => json!("auto"),
    }
}

/// Claude 单条 message → Responses input items（保持块顺序）。
/// text/image 聚合为 message item；tool_use → function_call；tool_result → function_call_output；
/// redacted_thinking（本代理打包格式）→ reasoning item；纯 thinking 块跳过（无 id 无法回传）。
fn convert_claude_message_to_input(msg: &Value, out: &mut Vec<Value>) {
    let role = msg.get("role").and_then(|v| v.as_str()).unwrap_or("user");
    // user 消息内容用 input_*；assistant 历史用 output_text
    let text_type = if role == "assistant" {
        "output_text"
    } else {
        "input_text"
    };

    let mut parts: Vec<Value> = Vec::new();
    let flush_parts = |parts: &mut Vec<Value>, out: &mut Vec<Value>| {
        if !parts.is_empty() {
            out.push(json!({
                "type": "message",
                "role": role,
                "content": std::mem::take(parts)
            }));
        }
    };

    match msg.get("content") {
        Some(Value::String(s)) => {
            if !s.is_empty() {
                out.push(json!({
                    "type": "message",
                    "role": role,
                    "content": [{ "type": text_type, "text": s }]
                }));
            }
        }
        Some(Value::Array(blocks)) => {
            for b in blocks {
                match b.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "text" => {
                        if let Some(t) = b.get("text").and_then(|v| v.as_str()) {
                            if !t.is_empty() {
                                parts.push(json!({ "type": text_type, "text": t }));
                            }
                        }
                    }
                    "image" => {
                        if let Some(url) = claude_image_to_data_url(b) {
                            parts.push(json!({ "type": "input_image", "image_url": url }));
                        }
                    }
                    "tool_use" => {
                        flush_parts(&mut parts, out);
                        let id = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let name = b.get("name").and_then(|v| v.as_str()).unwrap_or("");
                        if id.is_empty() || name.is_empty() {
                            continue;
                        }
                        let input = b.get("input").cloned().unwrap_or(json!({}));
                        out.push(json!({
                            "type": "function_call",
                            "call_id": id,
                            "name": name,
                            "arguments": canonical_json_string(&input)
                        }));
                    }
                    "tool_result" => {
                        flush_parts(&mut parts, out);
                        let tid = b.get("tool_use_id").and_then(|v| v.as_str()).unwrap_or("");
                        let output =
                            extract_tool_result_content(b.get("content").unwrap_or(&Value::Null));
                        out.push(json!({
                            "type": "function_call_output",
                            "call_id": tid,
                            "output": output
                        }));
                    }
                    "redacted_thinking" => {
                        flush_parts(&mut parts, out);
                        if let Some(item) = unpack_redacted_thinking(b) {
                            out.push(item);
                        }
                    }
                    // 纯 thinking 块：Claude 思考文本对 codex 上游无意义且无法映射为合法 reasoning item
                    _ => {}
                }
            }
            flush_parts(&mut parts, out);
        }
        _ => {}
    }
}

/// Claude image 块 → Responses `input_image` 的 image_url（base64 → data URL；url 原样）。
fn claude_image_to_data_url(block: &Value) -> Option<String> {
    let source = block.get("source")?;
    match source.get("type").and_then(|v| v.as_str()) {
        Some("base64") => {
            let media = source.get("media_type").and_then(|v| v.as_str())?;
            let data = source.get("data").and_then(|v| v.as_str())?;
            Some(format!("data:{media};base64,{data}"))
        }
        Some("url") => source.get("url").and_then(|v| v.as_str()).map(String::from),
        _ => None,
    }
}

/// `redacted_thinking.data`（本代理打包的 `{id, encrypted_content}` JSON 串）→ reasoning input item。
/// 非本代理格式（如真实 Anthropic 的不透明 base64）解析失败则跳过。
fn unpack_redacted_thinking(block: &Value) -> Option<Value> {
    let data = block.get("data").and_then(|v| v.as_str())?;
    let packed: Value = serde_json::from_str(data).ok()?;
    let enc = packed.get("encrypted_content").and_then(|v| v.as_str())?;
    let id = packed.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() {
        return None;
    }
    Some(json!({
        "type": "reasoning",
        "id": id,
        "summary": [],
        "encrypted_content": enc
    }))
}

/// 打包 encrypted reasoning 为 `redacted_thinking.data`（与 [`unpack_redacted_thinking`] 互逆）。
fn pack_redacted_thinking(id: &str, encrypted_content: &str) -> String {
    json!({ "id": id, "encrypted_content": encrypted_content }).to_string()
}

// ============================================================ 响应：Responses → Claude（非流式）

/// 从缓冲的 Responses SSE 文本提取最终 response 快照
/// （`response.completed` / `response.incomplete` / `response.failed` 的 `response` 字段，取最后一个）。
pub fn final_response_from_sse(text: &str) -> Option<Value> {
    let mut last: Option<Value> = None;
    for line in text.lines() {
        let Some(data) = line.trim().strip_prefix("data:") else {
            continue;
        };
        let Ok(j) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        if matches!(
            j.get("type").and_then(|v| v.as_str()),
            Some("response.completed" | "response.incomplete" | "response.failed")
        ) {
            if let Some(r) = j.get("response") {
                last = Some(r.clone());
            }
        }
    }
    last
}

/// 完整 Responses 响应体 → Claude Messages 响应体。`fallback_model` 在上游未回显 model 时使用。
pub fn responses_response_to_claude(resp: &Value, fallback_model: &str) -> Value {
    let id = resp
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("msg_proxy");
    let model = resp
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(fallback_model);

    let mut content: Vec<Value> = Vec::new();
    let mut has_tool = false;
    if let Some(items) = resp.get("output").and_then(|v| v.as_array()) {
        for item in items {
            match item.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                "message" => {
                    if let Some(parts) = item.get("content").and_then(|v| v.as_array()) {
                        for p in parts {
                            if p.get("type").and_then(|v| v.as_str()) == Some("output_text") {
                                if let Some(t) = p.get("text").and_then(|v| v.as_str()) {
                                    if !t.is_empty() {
                                        content.push(json!({ "type": "text", "text": t }));
                                    }
                                }
                            }
                        }
                    }
                }
                "function_call" => {
                    has_tool = true;
                    let call_id = item
                        .get("call_id")
                        .or_else(|| item.get("id"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                    let args = item
                        .get("arguments")
                        .and_then(|v| v.as_str())
                        .unwrap_or("{}");
                    let input: Value = serde_json::from_str(args).unwrap_or(json!({}));
                    content.push(json!({
                        "type": "tool_use", "id": call_id, "name": name, "input": input
                    }));
                }
                "reasoning" => {
                    let summary = reasoning_summary_text(item);
                    if !summary.is_empty() {
                        content.push(json!({
                            "type": "thinking", "thinking": summary, "signature": ""
                        }));
                    }
                    if let Some(enc) = item.get("encrypted_content").and_then(|v| v.as_str()) {
                        let rid = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        if !rid.is_empty() {
                            content.push(json!({
                                "type": "redacted_thinking",
                                "data": pack_redacted_thinking(rid, enc)
                            }));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let incomplete = resp.get("status").and_then(|v| v.as_str()) == Some("incomplete");
    let stop_reason = if incomplete {
        "max_tokens"
    } else if has_tool {
        "tool_use"
    } else {
        "end_turn"
    };

    let (input, output, cache_read) = responses_usage(resp.get("usage"));
    json!({
        "id": id,
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": Value::Null,
        "usage": {
            "input_tokens": input,
            "output_tokens": output,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": cache_read
        }
    })
}

/// reasoning item 的 summary 文本（`summary[].text` 以 `\n` 连接）。
fn reasoning_summary_text(item: &Value) -> String {
    item.get("summary")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|s| s.get("text").and_then(|t| t.as_str()))
                .filter(|t| !t.is_empty())
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

/// Responses usage → (净输入, 输出, cache_read)。input_tokens 已含 cached_tokens，扣除对齐 Claude 语义。
fn responses_usage(usage: Option<&Value>) -> (i64, i64, i64) {
    let cache_read = usage
        .and_then(|u| {
            u.pointer("/input_tokens_details/cached_tokens")
                .or_else(|| u.get("cache_read_input_tokens"))
                .or_else(|| u.get("cached_tokens"))
        })
        .and_then(|v| v.as_i64())
        .filter(|v| *v > 0)
        .unwrap_or(0);
    let input = usage
        .and_then(|u| u.get("input_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    let output = usage
        .and_then(|u| u.get("output_tokens"))
        .and_then(|v| v.as_i64())
        .unwrap_or(0);
    ((input - cache_read).max(0), output, cache_read)
}

// ============================================================ 流式：Responses SSE → Claude SSE

struct OpenTool {
    anthropic_index: i64,
    args_streamed: bool,
}

/// 有状态的流式转换器：逐个消费 Responses SSE 事件 JSON，产出 Claude SSE 事件文本。
///
/// 用法：每收到一个上游 `data:` 事件 JSON 调用 [`process_event`]，流结束调用 [`finish`]
/// 收尾（幂等；正常时 `response.completed` 已触发收尾）。
/// tool_use 边流边发（output_item.added 开块、arguments.delta 增量、output_item.done 关块）；
/// `response.completed` 时补发只出现在快照里的 function_call（兼容仅发 completed 的中转）。
pub struct ResponsesToClaudeConverter {
    model: String,
    response_id: String,
    message_start_sent: bool,
    message_stop_sent: bool,
    block_index: i64,
    text_open: bool,
    thinking_open: bool,
    /// Responses item id → 开启中的 tool_use 块。
    tools: HashMap<String, OpenTool>,
    emitted_call_ids: HashSet<String>,
    emitted_reasoning_ids: HashSet<String>,
    any_tool_started: bool,
    stop_reason: String,
    input_tokens: i64,
    output_tokens: i64,
    cache_read_tokens: i64,
    /// 上游 `response.failed` / `error` 时记下，供流结束后按错误记统计。
    error_message: Option<String>,
}

impl ResponsesToClaudeConverter {
    pub fn new(model: String) -> Self {
        Self {
            model,
            response_id: String::new(),
            message_start_sent: false,
            message_stop_sent: false,
            block_index: 0,
            text_open: false,
            thinking_open: false,
            tools: HashMap::new(),
            emitted_call_ids: HashSet::new(),
            emitted_reasoning_ids: HashSet::new(),
            any_tool_started: false,
            stop_reason: "end_turn".to_string(),
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            error_message: None,
        }
    }

    /// 当前累积 token 用量 `(input, output, cache_creation, cache_read)`，供流结束后统计。
    pub fn usage(&self) -> (i64, i64, i64, i64) {
        (
            self.input_tokens,
            self.output_tokens,
            0,
            self.cache_read_tokens,
        )
    }

    /// 流内是否收到上游失败事件。
    pub fn error_message(&self) -> Option<&str> {
        self.error_message.as_deref()
    }

    fn message_start(&mut self, events: &mut Vec<String>) {
        if self.message_start_sent {
            return;
        }
        self.message_start_sent = true;
        events.push(build_claude_event(
            "message_start",
            &json!({
                "type": "message_start",
                "message": {
                    "id": self.response_id,
                    "type": "message",
                    "role": "assistant",
                    "content": [],
                    "model": self.model,
                    "stop_reason": Value::Null,
                    "stop_sequence": Value::Null,
                    "usage": {
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_creation_input_tokens": 0,
                        "cache_read_input_tokens": 0
                    }
                }
            }),
        ));
    }

    fn ensure_text_block(&mut self, events: &mut Vec<String>) {
        if self.text_open {
            return;
        }
        self.close_thinking(events);
        self.text_open = true;
        events.push(build_claude_event(
            "content_block_start",
            &json!({
                "type": "content_block_start",
                "index": self.block_index,
                "content_block": { "type": "text", "text": "" }
            }),
        ));
    }

    fn ensure_thinking_block(&mut self, events: &mut Vec<String>) {
        if self.thinking_open {
            return;
        }
        self.close_text(events);
        self.thinking_open = true;
        events.push(build_claude_event(
            "content_block_start",
            &json!({
                "type": "content_block_start",
                "index": self.block_index,
                "content_block": { "type": "thinking", "thinking": "" }
            }),
        ));
    }

    fn close_text(&mut self, events: &mut Vec<String>) {
        if self.text_open {
            self.text_open = false;
            events.push(build_claude_event(
                "content_block_stop",
                &json!({ "type": "content_block_stop", "index": self.block_index }),
            ));
            self.block_index += 1;
        }
    }

    fn close_thinking(&mut self, events: &mut Vec<String>) {
        if self.thinking_open {
            self.thinking_open = false;
            events.push(build_claude_event(
                "content_block_stop",
                &json!({ "type": "content_block_stop", "index": self.block_index }),
            ));
            self.block_index += 1;
        }
    }

    /// 开启 tool_use 块（item 需含 name 与 call_id/id）。
    fn open_tool(&mut self, item: &Value, events: &mut Vec<String>) {
        let item_key = tool_item_key(item);
        if item_key.is_empty() || self.tools.contains_key(&item_key) {
            return;
        }
        let call_id = item
            .get("call_id")
            .or_else(|| item.get("id"))
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if call_id.is_empty() || name.is_empty() {
            return;
        }
        self.close_text(events);
        self.close_thinking(events);
        let idx = self.block_index;
        self.block_index += 1;
        self.any_tool_started = true;
        self.emitted_call_ids.insert(call_id.clone());
        events.push(build_claude_event(
            "content_block_start",
            &json!({
                "type": "content_block_start",
                "index": idx,
                "content_block": { "type": "tool_use", "id": call_id, "name": name, "input": {} }
            }),
        ));
        self.tools.insert(
            item_key,
            OpenTool {
                anthropic_index: idx,
                args_streamed: false,
            },
        );
    }

    /// 关闭 tool_use 块；从未流式发过参数时先补发完整 arguments。
    fn close_tool(&mut self, item_key: &str, final_args: Option<&str>, events: &mut Vec<String>) {
        let Some(tool) = self.tools.remove(item_key) else {
            return;
        };
        if !tool.args_streamed {
            if let Some(args) = final_args.filter(|a| !a.is_empty()) {
                events.push(build_claude_event(
                    "content_block_delta",
                    &json!({
                        "type": "content_block_delta",
                        "index": tool.anthropic_index,
                        "delta": { "type": "input_json_delta", "partial_json": args }
                    }),
                ));
            }
        }
        events.push(build_claude_event(
            "content_block_stop",
            &json!({ "type": "content_block_stop", "index": tool.anthropic_index }),
        ));
    }

    /// encrypted reasoning item → `redacted_thinking` 块（start 携带完整 data + 立即 stop）。
    fn emit_redacted_thinking(&mut self, item: &Value, events: &mut Vec<String>) {
        let Some(enc) = item.get("encrypted_content").and_then(|v| v.as_str()) else {
            return;
        };
        let rid = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if rid.is_empty() || !self.emitted_reasoning_ids.insert(rid.to_string()) {
            return;
        }
        self.close_text(events);
        self.close_thinking(events);
        let idx = self.block_index;
        self.block_index += 1;
        events.push(build_claude_event(
            "content_block_start",
            &json!({
                "type": "content_block_start",
                "index": idx,
                "content_block": {
                    "type": "redacted_thinking",
                    "data": pack_redacted_thinking(rid, enc)
                }
            }),
        ));
        events.push(build_claude_event(
            "content_block_stop",
            &json!({ "type": "content_block_stop", "index": idx }),
        ));
    }

    fn apply_usage(&mut self, usage: &Value) {
        let (input, output, cache_read) = responses_usage(Some(usage));
        if cache_read > 0 {
            self.cache_read_tokens = cache_read;
        }
        if input > 0 || output > 0 {
            self.input_tokens = input;
            self.output_tokens = output;
        }
    }

    /// `response.completed` / `response.incomplete`：吸收 usage、补发快照独有的
    /// function_call / encrypted reasoning、判定 stop_reason 并收尾。
    fn finish_from_final(&mut self, resp: &Value, incomplete: bool, events: &mut Vec<String>) {
        if let Some(u) = resp.get("usage") {
            self.apply_usage(u);
        }
        if let Some(items) = resp.get("output").and_then(|v| v.as_array()) {
            for item in items {
                match item.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "function_call" => {
                        let key = tool_item_key(item);
                        let args = item.get("arguments").and_then(|v| v.as_str());
                        if self.tools.contains_key(&key) {
                            // added/delta 已流式发出但 done 缺失 → 只需关块
                            self.close_tool(&key, args, events);
                        } else {
                            let call_id = item
                                .get("call_id")
                                .or_else(|| item.get("id"))
                                .and_then(|v| v.as_str())
                                .unwrap_or("");
                            if !call_id.is_empty() && !self.emitted_call_ids.contains(call_id) {
                                // 仅发 completed 快照的中转：整包回放（与 CCR 行为一致）
                                self.open_tool(item, events);
                                self.close_tool(&key, args, events);
                            }
                        }
                    }
                    "reasoning" => self.emit_redacted_thinking(item, events),
                    _ => {}
                }
            }
        }
        self.stop_reason = if incomplete {
            "max_tokens".to_string()
        } else if self.any_tool_started {
            "tool_use".to_string()
        } else {
            "end_turn".to_string()
        };
        events.extend(self.finish());
    }

    /// 处理一个 Responses SSE 事件 JSON，返回应发出的 Claude SSE 事件文本。
    pub fn process_event(&mut self, data: &Value) -> Vec<String> {
        let mut events = Vec::new();
        let etype = data.get("type").and_then(|v| v.as_str()).unwrap_or("");
        match etype {
            "response.created" => {
                if let Some(resp) = data.get("response") {
                    if let Some(id) = resp.get("id").and_then(|v| v.as_str()) {
                        self.response_id = id.to_string();
                    }
                    if let Some(m) = resp.get("model").and_then(|v| v.as_str()) {
                        if !m.is_empty() {
                            self.model = m.to_string();
                        }
                    }
                }
                self.message_start(&mut events);
            }
            "response.output_item.added" => {
                self.message_start(&mut events);
                if let Some(item) = data.get("item") {
                    if item.get("type").and_then(|v| v.as_str()) == Some("function_call") {
                        self.open_tool(item, &mut events);
                    }
                }
            }
            "response.output_text.delta" => {
                if let Some(t) = data.get("delta").and_then(|v| v.as_str()) {
                    if !t.is_empty() {
                        self.message_start(&mut events);
                        self.ensure_text_block(&mut events);
                        events.push(build_claude_event(
                            "content_block_delta",
                            &json!({
                                "type": "content_block_delta",
                                "index": self.block_index,
                                "delta": { "type": "text_delta", "text": t }
                            }),
                        ));
                    }
                }
            }
            "response.reasoning_summary_text.delta" | "response.reasoning_text.delta" => {
                if let Some(t) = data.get("delta").and_then(|v| v.as_str()) {
                    if !t.is_empty() {
                        self.message_start(&mut events);
                        self.ensure_thinking_block(&mut events);
                        events.push(build_claude_event(
                            "content_block_delta",
                            &json!({
                                "type": "content_block_delta",
                                "index": self.block_index,
                                "delta": { "type": "thinking_delta", "thinking": t }
                            }),
                        ));
                    }
                }
            }
            "response.function_call_arguments.delta" => {
                let key = data
                    .get("item_id")
                    .and_then(|v| v.as_str())
                    .unwrap_or("")
                    .to_string();
                if let Some(args) = data.get("delta").and_then(|v| v.as_str()) {
                    if !args.is_empty() {
                        if let Some(tool) = self.tools.get_mut(&key) {
                            tool.args_streamed = true;
                            let idx = tool.anthropic_index;
                            events.push(build_claude_event(
                                "content_block_delta",
                                &json!({
                                    "type": "content_block_delta",
                                    "index": idx,
                                    "delta": { "type": "input_json_delta", "partial_json": args }
                                }),
                            ));
                        }
                    }
                }
            }
            "response.output_item.done" => {
                if let Some(item) = data.get("item") {
                    match item.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                        "function_call" => {
                            let key = tool_item_key(item);
                            let args = item.get("arguments").and_then(|v| v.as_str());
                            self.close_tool(&key, args, &mut events);
                        }
                        "reasoning" => self.emit_redacted_thinking(item, &mut events),
                        "message" => self.close_text(&mut events),
                        _ => {}
                    }
                }
            }
            "response.completed" => {
                self.message_start(&mut events);
                let resp = data.get("response").cloned().unwrap_or(json!({}));
                self.finish_from_final(&resp, false, &mut events);
            }
            "response.incomplete" => {
                self.message_start(&mut events);
                let resp = data.get("response").cloned().unwrap_or(json!({}));
                self.finish_from_final(&resp, true, &mut events);
            }
            "response.failed" | "error" => {
                let msg = data
                    .pointer("/response/error/message")
                    .or_else(|| data.pointer("/error/message"))
                    .or_else(|| data.get("message"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("codex 上游返回失败");
                self.error_message = Some(msg.to_string());
                events.push(build_claude_event(
                    "error",
                    &json!({
                        "type": "error",
                        "error": { "type": "api_error", "message": msg }
                    }),
                ));
                // 错误事件后不再发 message_delta/message_stop（客户端按错误中止）
                self.message_stop_sent = true;
            }
            _ => {}
        }
        events
    }

    /// 流结束收尾（幂等）：关块 → message_delta（stop_reason + usage）→ message_stop。
    pub fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();
        if self.message_stop_sent {
            return events;
        }
        self.message_start(&mut events);
        self.close_text(&mut events);
        self.close_thinking(&mut events);
        let mut open_indices: Vec<i64> = self.tools.values().map(|t| t.anthropic_index).collect();
        open_indices.sort_unstable();
        for idx in open_indices {
            events.push(build_claude_event(
                "content_block_stop",
                &json!({ "type": "content_block_stop", "index": idx }),
            ));
        }
        self.tools.clear();
        events.push(build_claude_event(
            "message_delta",
            &json!({
                "type": "message_delta",
                "delta": { "stop_reason": self.stop_reason, "stop_sequence": Value::Null },
                "usage": {
                    "input_tokens": self.input_tokens,
                    "output_tokens": self.output_tokens,
                    "cache_creation_input_tokens": 0,
                    "cache_read_input_tokens": self.cache_read_tokens
                }
            }),
        ));
        events.push(build_claude_event(
            "message_stop",
            &json!({ "type": "message_stop" }),
        ));
        self.message_stop_sent = true;
        events
    }
}

/// tool 块的路由键：优先 Responses item id（arguments.delta 按 item_id 路由），回退 call_id。
fn tool_item_key(item: &Value) -> String {
    item.get("id")
        .or_else(|| item.get("call_id"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn join(events: Vec<String>) -> String {
        events.join("")
    }

    // ---------- 请求转换 ----------

    #[test]
    fn request_maps_system_tools_and_forces_stream_store() {
        let claude = json!({
            "model": "claude-sonnet-4",
            "max_tokens": 4096,
            "system": [{ "type": "text", "text": "You are Claude Code." }],
            "messages": [{ "role": "user", "content": "hi" }],
            "tools": [{ "name": "read_file", "description": "d", "input_schema": { "type": "object" } }],
            "tool_choice": { "type": "any" },
            "stream": false
        });
        let out = claude_request_to_responses(&claude, Some("gpt-5-codex"));
        assert_eq!(out["model"], "gpt-5-codex");
        assert_eq!(out["instructions"], "You are Claude Code.");
        assert_eq!(out["max_output_tokens"], 4096);
        assert_eq!(out["stream"], true);
        assert_eq!(out["store"], false);
        assert_eq!(out["tools"][0]["type"], "function");
        assert_eq!(out["tools"][0]["name"], "read_file");
        assert_eq!(out["tool_choice"], "required");
        assert_eq!(out["input"][0]["type"], "message");
        assert_eq!(out["input"][0]["content"][0]["type"], "input_text");
    }

    #[test]
    fn request_empty_system_gets_default_instructions() {
        let claude = json!({ "model": "gpt-5-codex", "messages": [] });
        let out = claude_request_to_responses(&claude, None);
        assert_eq!(out["instructions"], DEFAULT_INSTRUCTIONS);
    }

    #[test]
    fn request_maps_tool_use_and_tool_result_ordered() {
        let claude = json!({
            "model": "m",
            "messages": [
                { "role": "assistant", "content": [
                    { "type": "text", "text": "checking" },
                    { "type": "tool_use", "id": "call_1", "name": "ls", "input": { "path": "/" } }
                ]},
                { "role": "user", "content": [
                    { "type": "tool_result", "tool_use_id": "call_1", "content": "ok" }
                ]}
            ]
        });
        let out = claude_request_to_responses(&claude, None);
        let input = out["input"].as_array().unwrap();
        assert_eq!(input[0]["type"], "message");
        assert_eq!(input[0]["content"][0]["type"], "output_text");
        assert_eq!(input[1]["type"], "function_call");
        assert_eq!(input[1]["call_id"], "call_1");
        assert_eq!(input[1]["arguments"], "{\"path\":\"/\"}");
        assert_eq!(input[2]["type"], "function_call_output");
        assert_eq!(input[2]["call_id"], "call_1");
        assert_eq!(input[2]["output"], "ok");
    }

    #[test]
    fn redacted_thinking_roundtrip() {
        let data = pack_redacted_thinking("rs_1", "ENC");
        let claude = json!({
            "model": "m",
            "messages": [{ "role": "assistant", "content": [
                { "type": "redacted_thinking", "data": data }
            ]}]
        });
        let out = claude_request_to_responses(&claude, None);
        let item = &out["input"][0];
        assert_eq!(item["type"], "reasoning");
        assert_eq!(item["id"], "rs_1");
        assert_eq!(item["encrypted_content"], "ENC");
        // 非本代理格式（真实 Anthropic 的不透明数据）跳过
        let alien = json!({
            "model": "m",
            "messages": [{ "role": "assistant", "content": [
                { "type": "redacted_thinking", "data": "AAAA-opaque" }
            ]}]
        });
        let out2 = claude_request_to_responses(&alien, None);
        assert!(out2["input"].as_array().unwrap().is_empty());
    }

    // ---------- 流式转换 ----------

    #[test]
    fn stream_text_flow() {
        let mut c = ResponsesToClaudeConverter::new("gpt-5-codex".into());
        let e0 = join(c.process_event(&json!({
            "type": "response.created",
            "response": { "id": "resp_1", "model": "gpt-5-codex" }
        })));
        assert!(e0.contains("event: message_start"));
        assert!(e0.contains("\"id\":\"resp_1\""));

        let e1 = join(c.process_event(&json!({
            "type": "response.output_text.delta", "delta": "Hello"
        })));
        assert!(e1.contains("content_block_start"));
        assert!(e1.contains("\"text_delta\""));
        assert!(e1.contains("Hello"));

        let e2 = join(c.process_event(&json!({
            "type": "response.completed",
            "response": { "status": "completed", "output": [],
                "usage": { "input_tokens": 100, "output_tokens": 7,
                    "input_tokens_details": { "cached_tokens": 40 } } }
        })));
        assert!(e2.contains("content_block_stop"));
        assert!(e2.contains("\"stop_reason\":\"end_turn\""));
        assert!(e2.contains("\"input_tokens\":60"));
        assert!(e2.contains("\"cache_read_input_tokens\":40"));
        assert!(e2.contains("event: message_stop"));
        assert_eq!(c.usage(), (60, 7, 0, 40));
        // finish 幂等
        assert!(c.finish().is_empty());
    }

    #[test]
    fn stream_tool_call_streams_incrementally() {
        let mut c = ResponsesToClaudeConverter::new("m".into());
        c.process_event(&json!({ "type": "response.created", "response": { "id": "r" } }));
        let e0 = join(c.process_event(&json!({
            "type": "response.output_item.added",
            "item": { "type": "function_call", "id": "fc_1", "call_id": "call_a", "name": "ls" }
        })));
        assert!(e0.contains("\"type\":\"tool_use\""));
        assert!(e0.contains("\"id\":\"call_a\""));

        let e1 = join(c.process_event(&json!({
            "type": "response.function_call_arguments.delta",
            "item_id": "fc_1", "delta": "{\"pa"
        })));
        assert!(e1.contains("\"input_json_delta\""));
        assert!(e1.contains("{\\\"pa"));

        let e2 = join(c.process_event(&json!({
            "type": "response.output_item.done",
            "item": { "type": "function_call", "id": "fc_1", "call_id": "call_a",
                "name": "ls", "arguments": "{\"path\":\"/\"}" }
        })));
        // 参数已流式发过 → done 只关块，不重复整包
        assert!(e2.contains("content_block_stop"));
        assert!(!e2.contains("input_json_delta"));

        let e3 = join(c.process_event(&json!({
            "type": "response.completed",
            "response": { "status": "completed", "output": [
                { "type": "function_call", "id": "fc_1", "call_id": "call_a",
                  "name": "ls", "arguments": "{\"path\":\"/\"}" }
            ]}
        })));
        // 快照兜底不重复已发出的工具块
        assert!(!e3.contains("content_block_start"));
        assert!(e3.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn stream_completed_snapshot_replays_missing_tool() {
        // 仅发 completed 快照的中转：工具整包回放
        let mut c = ResponsesToClaudeConverter::new("m".into());
        c.process_event(&json!({ "type": "response.created", "response": { "id": "r" } }));
        let e = join(c.process_event(&json!({
            "type": "response.completed",
            "response": { "status": "completed", "output": [
                { "type": "function_call", "id": "fc_9", "call_id": "call_z",
                  "name": "grep", "arguments": "{\"q\":\"x\"}" }
            ]}
        })));
        assert!(e.contains("\"type\":\"tool_use\""));
        assert!(e.contains("\"id\":\"call_z\""));
        assert!(e.contains("\"partial_json\":\"{\\\"q\\\":\\\"x\\\"}\""));
        assert!(e.contains("\"stop_reason\":\"tool_use\""));
    }

    #[test]
    fn stream_reasoning_summary_and_encrypted() {
        let mut c = ResponsesToClaudeConverter::new("m".into());
        c.process_event(&json!({ "type": "response.created", "response": { "id": "r" } }));
        let e0 = join(c.process_event(&json!({
            "type": "response.reasoning_summary_text.delta", "delta": "planning"
        })));
        assert!(e0.contains("\"type\":\"thinking\""));
        assert!(e0.contains("thinking_delta"));

        let e1 = join(c.process_event(&json!({
            "type": "response.output_item.done",
            "item": { "type": "reasoning", "id": "rs_1", "encrypted_content": "ENC" }
        })));
        assert!(e1.contains("redacted_thinking"));
        assert!(e1.contains("rs_1"));

        // completed 快照里的同一 reasoning 不重复发
        let e2 = join(c.process_event(&json!({
            "type": "response.completed",
            "response": { "status": "completed", "output": [
                { "type": "reasoning", "id": "rs_1", "encrypted_content": "ENC" }
            ]}
        })));
        assert!(!e2.contains("redacted_thinking"));
    }

    #[test]
    fn stream_incomplete_maps_to_max_tokens() {
        let mut c = ResponsesToClaudeConverter::new("m".into());
        c.process_event(&json!({ "type": "response.created", "response": { "id": "r" } }));
        let e = join(c.process_event(&json!({
            "type": "response.incomplete",
            "response": { "status": "incomplete", "output": [] }
        })));
        assert!(e.contains("\"stop_reason\":\"max_tokens\""));
    }

    #[test]
    fn stream_failed_emits_error_event() {
        let mut c = ResponsesToClaudeConverter::new("m".into());
        let e = join(c.process_event(&json!({
            "type": "response.failed",
            "response": { "status": "failed", "error": { "message": "quota exceeded" } }
        })));
        assert!(e.contains("event: error"));
        assert!(e.contains("quota exceeded"));
        assert_eq!(c.error_message(), Some("quota exceeded"));
        assert!(c.finish().is_empty());
    }

    #[test]
    fn stream_finish_fallback_without_completed() {
        let mut c = ResponsesToClaudeConverter::new("m".into());
        c.process_event(&json!({ "type": "response.created", "response": { "id": "r" } }));
        c.process_event(&json!({ "type": "response.output_text.delta", "delta": "hi" }));
        let done = join(c.finish());
        assert!(done.contains("content_block_stop"));
        assert!(done.contains("event: message_delta"));
        assert!(done.contains("event: message_stop"));
    }

    // ---------- 非流式 ----------

    #[test]
    fn buffered_response_converts_output() {
        let resp = json!({
            "id": "resp_1", "status": "completed", "model": "gpt-5-codex",
            "output": [
                { "type": "reasoning", "id": "rs_1",
                  "summary": [{ "type": "summary_text", "text": "think" }],
                  "encrypted_content": "ENC" },
                { "type": "message", "role": "assistant",
                  "content": [{ "type": "output_text", "text": "hello" }] },
                { "type": "function_call", "call_id": "call_a", "name": "ls",
                  "arguments": "{\"path\":\"/\"}" }
            ],
            "usage": { "input_tokens": 50, "output_tokens": 9,
                "input_tokens_details": { "cached_tokens": 20 } }
        });
        let claude = responses_response_to_claude(&resp, "fallback");
        assert_eq!(claude["model"], "gpt-5-codex");
        let content = claude["content"].as_array().unwrap();
        assert_eq!(content[0]["type"], "thinking");
        assert_eq!(content[1]["type"], "redacted_thinking");
        assert_eq!(content[2]["type"], "text");
        assert_eq!(content[2]["text"], "hello");
        assert_eq!(content[3]["type"], "tool_use");
        assert_eq!(content[3]["input"]["path"], "/");
        assert_eq!(claude["stop_reason"], "tool_use");
        assert_eq!(claude["usage"]["input_tokens"], 30);
        assert_eq!(claude["usage"]["cache_read_input_tokens"], 20);
    }

    #[test]
    fn final_response_extracted_from_sse_text() {
        let sse = concat!(
            "event: response.created\n",
            "data: {\"type\":\"response.created\",\"response\":{\"id\":\"r\"}}\n\n",
            "event: response.output_text.delta\n",
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n\n",
            "event: response.completed\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"r\",\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"hi\"}]}]}}\n\n",
        );
        let r = final_response_from_sse(sse).unwrap();
        assert_eq!(r["id"], "r");
        assert_eq!(r["status"], "completed");
        assert!(final_response_from_sse("data: not-json\n").is_none());
    }
}
