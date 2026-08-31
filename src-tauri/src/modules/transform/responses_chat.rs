//! OpenAI Responses API ↔ Chat Completions 协议转换（codex 端点）。
//!
//! 入站固定为 Responses 请求。codex（OpenAiResponses）端点走透传（见 proxy::forward）；
//! openai（OpenAiChat）端点走本模块：请求 [`responses_request_to_chat`] 转 Chat，
//! 上游 Chat 响应再由 [`chat_response_to_responses`]（非流式）或 [`ResponsesStreamConverter`]（流式）转回 Responses。
//!
//! 字段映射对齐 moon-bridge 调研基准（research/03）：
//! `max_output_tokens→max_completion_tokens`、`instructions→单条 system 置首`、
//! `reasoning.effort→reasoning_effort`、`parallel_tool_calls` 透传、`stop` 不映射。
//! tool_call `arguments` 在两侧均为 JSON 字符串；请求侧会对历史 `arguments` 做
//! 完整性校验——合法则规范化（排序键）输出，残缺则降级为 `{}` 以避免上游 prefill
//! 解析失败（`unexpected end of data`）。

use std::collections::HashMap;

use serde_json::{json, Map, Value};

use crate::modules::transform::json_canonical::canonical_json_string;
use crate::modules::transform::types::build_sse_event;

// ============================================================ 请求：Responses → Chat

/// Responses 请求体 → OpenAI Chat 请求体。`endpoint_model` 非空则覆盖请求 model。
pub fn responses_request_to_chat(responses: &Value, endpoint_model: Option<&str>) -> Value {
    let mut out = Map::new();

    // model：端点配置优先，否则请求 model
    let model = endpoint_model
        .filter(|m| !m.trim().is_empty())
        .map(|m| m.to_string())
        .or_else(|| {
            responses
                .get("model")
                .and_then(|m| m.as_str())
                .map(|s| s.to_string())
        });
    if let Some(m) = model {
        out.insert("model".into(), json!(m));
    }

    // max_output_tokens → max_completion_tokens（非 max_tokens）
    if let Some(mt) = responses.get("max_output_tokens").and_then(|v| v.as_i64()) {
        if mt > 0 {
            out.insert("max_completion_tokens".into(), json!(mt));
        }
    }
    // temperature / top_p：Responses 未文档化为入参，但客户端若提供则透传
    if let Some(t) = responses.get("temperature").and_then(|v| v.as_f64()) {
        out.insert("temperature".into(), json!(t));
    }
    if let Some(p) = responses.get("top_p").and_then(|v| v.as_f64()) {
        out.insert("top_p".into(), json!(p));
    }
    // reasoning.effort → reasoning_effort（Chat 顶层字符串）
    if let Some(effort) = responses
        .pointer("/reasoning/effort")
        .and_then(|v| v.as_str())
    {
        out.insert("reasoning_effort".into(), json!(effort));
    }
    // parallel_tool_calls 透传
    if let Some(p) = responses.get("parallel_tool_calls") {
        if !p.is_null() {
            out.insert("parallel_tool_calls".into(), p.clone());
        }
    }
    // stream + stream_options（与 claude_openai 一致，便于上游回传 usage）
    if responses
        .get("stream")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
    {
        out.insert("stream".into(), json!(true));
        out.insert("stream_options".into(), json!({ "include_usage": true }));
    }

    // messages：instructions + input
    let mut system_texts: Vec<String> = Vec::new();
    if let Some(instr) = responses.get("instructions").and_then(|v| v.as_str()) {
        if !instr.is_empty() {
            system_texts.push(instr.to_string());
        }
    }
    let mut messages: Vec<Value> = Vec::new();
    match responses.get("input") {
        Some(Value::String(s)) => messages.push(json!({ "role": "user", "content": s })),
        Some(Value::Array(items)) => convert_input_items(items, &mut system_texts, &mut messages),
        _ => {}
    }
    if !system_texts.is_empty() {
        let mut merged = Vec::with_capacity(messages.len() + 1);
        merged.push(json!({ "role": "system", "content": system_texts.join("\n") }));
        merged.extend(messages);
        messages = merged;
    }
    out.insert("messages".into(), json!(messages));

    // tools（仅 function 可映射到 Chat；web_search/mcp/local_shell 等 Chat 不支持，跳过）
    if let Some(tools) = responses.get("tools").and_then(|v| v.as_array()) {
        let mut otools = Vec::new();
        for t in tools {
            let ttype = t.get("type").and_then(|v| v.as_str()).unwrap_or("function");
            if ttype != "function" {
                continue;
            }
            let name = t.get("name").and_then(|v| v.as_str()).unwrap_or("");
            if name.is_empty() {
                continue;
            }
            let mut func = Map::new();
            func.insert("name".into(), json!(name));
            if let Some(d) = t.get("description") {
                func.insert("description".into(), d.clone());
            }
            func.insert(
                "parameters".into(),
                t.get("parameters")
                    .cloned()
                    .unwrap_or(json!({ "type": "object" })),
            );
            if let Some(strict) = t.get("strict") {
                func.insert("strict".into(), strict.clone());
            }
            otools.push(json!({ "type": "function", "function": Value::Object(func) }));
        }
        if !otools.is_empty() {
            out.insert("tools".into(), json!(otools));
            if let Some(tc) = responses.get("tool_choice") {
                out.insert("tool_choice".into(), responses_tool_choice_to_chat(tc));
            }
        }
    }

    Value::Object(out)
}

/// Responses `tool_choice` → Chat `tool_choice`。string(auto/none/required) 透传；
/// `{type:function, name}` → `{type:function, function:{name}}`。
fn responses_tool_choice_to_chat(tc: &Value) -> Value {
    match tc {
        Value::String(_) => tc.clone(),
        Value::Object(o) => {
            if o.get("type").and_then(|v| v.as_str()) == Some("function") {
                if let Some(name) = o.get("name").and_then(|v| v.as_str()) {
                    return json!({ "type": "function", "function": { "name": name } });
                }
            }
            tc.clone()
        }
        _ => json!("auto"),
    }
}

/// Responses `input` 数组 → Chat messages。system/developer 收集进 `system_texts`；
/// 连续 function_call 批处理进同一条 assistant 消息；function_call_output → role:tool。
fn convert_input_items(items: &[Value], system_texts: &mut Vec<String>, messages: &mut Vec<Value>) {
    let mut pending_calls: Vec<Value> = Vec::new();

    for item in items {
        // message item（带 role）
        if let Some(role) = item.get("role").and_then(|v| v.as_str()) {
            flush_pending_calls(&mut pending_calls, messages);
            match role {
                "system" | "developer" => {
                    if let Some(t) = extract_content_text(item.get("content")) {
                        if !t.is_empty() {
                            system_texts.push(t);
                        }
                    }
                }
                _ => {
                    let content = convert_message_content(item.get("content"));
                    messages.push(json!({ "role": role, "content": content }));
                }
            }
            continue;
        }
        // 非 message item（按 type）
        match item.get("type").and_then(|v| v.as_str()) {
            Some("function_call") => {
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
                // Responses 历史里的 arguments 可能是流式累积未闭合的 JSON 串
                // （例如 `{"path":"foo","content":"bar` 缺尾部 `}`）。原样透传给
                // Chat 上游会在 prefill 解析 tool_calls 时报
                // `unexpected end of data`。这里做一次完整性校验：能解析则规范化
                // 输出（顺带排序键提升 prefix-cache 命中），否则降级为 `{}` 并告警。
                let safe_args = match serde_json::from_str::<Value>(args) {
                    Ok(parsed) => canonical_json_string(&parsed),
                    Err(err) => {
                        tracing::warn!(
                            call_id = %call_id,
                            name = %name,
                            error = %err,
                            args_len = args.len(),
                            "function_call.arguments 非合法 JSON，已降级为 {{}} 以避免上游 prefill 解析失败"
                        );
                        "{}".to_string()
                    }
                };
                if !call_id.is_empty() && !name.is_empty() {
                    pending_calls.push(json!({
                        "id": call_id,
                        "type": "function",
                        "function": { "name": name, "arguments": safe_args }
                    }));
                }
            }
            Some("function_call_output") => {
                flush_pending_calls(&mut pending_calls, messages);
                let call_id = item.get("call_id").and_then(|v| v.as_str()).unwrap_or("");
                let content = output_to_text(item.get("output"));
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": call_id,
                    "content": content
                }));
            }
            // reasoning / 其他 item：MVP 跳过（不影响 Chat 上游）
            _ => {}
        }
    }
    flush_pending_calls(&mut pending_calls, messages);
}

fn flush_pending_calls(pending: &mut Vec<Value>, messages: &mut Vec<Value>) {
    if !pending.is_empty() {
        messages.push(json!({
            "role": "assistant",
            "content": Value::Null,
            "tool_calls": std::mem::take(pending)
        }));
    }
}

/// system/developer item 的 content → 纯文本（拼接各文本部件）。
fn extract_content_text(content: Option<&Value>) -> Option<String> {
    match content {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Array(parts)) => Some(
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join(""),
        ),
        _ => None,
    }
}

/// user/assistant item 的 content → Chat content。纯文本合并为字符串；含图片则用部件数组。
fn convert_message_content(content: Option<&Value>) -> Value {
    match content {
        Some(Value::String(s)) => json!(s),
        Some(Value::Array(parts)) => {
            let mut out_parts: Vec<Value> = Vec::new();
            let mut has_image = false;
            for p in parts {
                match p.get("type").and_then(|v| v.as_str()).unwrap_or("") {
                    "input_text" | "text" | "output_text" => {
                        if let Some(t) = p.get("text").and_then(|v| v.as_str()) {
                            out_parts.push(json!({ "type": "text", "text": t }));
                        }
                    }
                    "input_image" | "image" | "image_url" => {
                        let url = p
                            .get("image_url")
                            .and_then(|v| v.as_str())
                            .or_else(|| p.pointer("/image_url/url").and_then(|v| v.as_str()));
                        if let Some(u) = url {
                            has_image = true;
                            out_parts.push(json!({
                                "type": "image_url",
                                "image_url": { "url": u }
                            }));
                        }
                    }
                    _ => {}
                }
            }
            if has_image {
                json!(out_parts)
            } else {
                json!(out_parts
                    .iter()
                    .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                    .collect::<Vec<_>>()
                    .join(""))
            }
        }
        _ => json!(""),
    }
}

/// function_call_output 的 output → 文本（字符串原样；对象/数组规范化为 JSON）。
fn output_to_text(output: Option<&Value>) -> String {
    match output {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) | None => String::new(),
        Some(other) => canonical_json_string(other),
    }
}

// ============================================================ 响应：Chat → Responses（非流式）

/// OpenAI Chat（非流式）响应 → Responses 响应体。`fallback_model` 在上游未回显 model 时使用。
pub fn chat_response_to_responses(chat: &Value, fallback_model: &str) -> Value {
    let id = chat.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let model = chat
        .get("model")
        .and_then(|v| v.as_str())
        .unwrap_or(fallback_model);

    let mut output: Vec<Value> = Vec::new();
    let mut status = "completed";

    if let Some(ch) = chat
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
    {
        let msg = ch.get("message");
        if let Some(text) = msg.and_then(|m| m.get("content")).and_then(|c| c.as_str()) {
            if !text.is_empty() {
                output.push(json!({
                    "type": "message",
                    "role": "assistant",
                    "content": [{ "type": "output_text", "text": text, "annotations": [] }]
                }));
            }
        }
        if let Some(tcs) = msg
            .and_then(|m| m.get("tool_calls"))
            .and_then(|t| t.as_array())
        {
            for tc in tcs {
                let call_id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let func = tc.get("function");
                let name = func
                    .and_then(|f| f.get("name"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let args = func
                    .and_then(|f| f.get("arguments"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("{}");
                output.push(json!({
                    "type": "function_call",
                    "id": format!("fc_{call_id}"),
                    "call_id": call_id,
                    "name": name,
                    "arguments": args
                }));
            }
        }
        status = match ch.get("finish_reason").and_then(|v| v.as_str()) {
            Some("length") => "incomplete",
            Some("content_filter") => "failed",
            _ => "completed",
        };
    }

    let usage = chat.get("usage");
    let input_tokens = first_usage(usage, &["prompt_tokens", "input_tokens"]);
    let output_tokens = first_usage(usage, &["completion_tokens", "output_tokens"]);
    let total = {
        let t = usage_i64(usage, "total_tokens");
        if t > 0 {
            t
        } else {
            input_tokens + output_tokens
        }
    };

    json!({
        "id": id,
        "object": "response",
        "status": status,
        "model": model,
        "output": output,
        "usage": {
            "input_tokens": input_tokens,
            "input_tokens_details": { "cached_tokens": cached_usage(usage) },
            "output_tokens": output_tokens,
            "output_tokens_details": { "reasoning_tokens": 0 },
            "total_tokens": total
        }
    })
}

fn usage_i64(usage: Option<&Value>, key: &str) -> i64 {
    usage
        .and_then(|u| u.get(key))
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}

fn first_usage(usage: Option<&Value>, keys: &[&str]) -> i64 {
    keys.iter()
        .map(|k| usage_i64(usage, k))
        .find(|v| *v > 0)
        .unwrap_or(0)
}

fn cached_usage(usage: Option<&Value>) -> i64 {
    usage
        .and_then(|u| {
            u.pointer("/prompt_tokens_details/cached_tokens")
                .or_else(|| u.pointer("/input_tokens_details/cached_tokens"))
        })
        .and_then(|v| v.as_i64())
        .unwrap_or(0)
}

// ============================================================ 流式：Chat SSE → Responses SSE

/// 当前在构造的工具调用 item 状态（按 Chat `tool_calls[].index` 区分）。
struct ToolItem {
    output_index: i64,
    item_id: String,
    call_id: String,
    name: String,
    args: String,
}

/// 有状态的流式转换器：逐个消费 OpenAI Chat 流 chunk，产出 Responses SSE 事件文本。
///
/// 用法：每收到一个上游 `data:` chunk JSON 调用 [`process_chunk`]，
/// 收到 `data: [DONE]`（或流结束）时调用 [`finish`] 收尾。事件带全局递增 `sequence_number`，
/// item_id 前缀 text=`msg_`、tool=`fc_`。
pub struct ResponsesStreamConverter {
    seq: i64,
    response_id: String,
    model: String,
    created_sent: bool,
    finished: bool,
    incomplete: bool,
    next_output_index: i64,
    // 文本 item
    text_open: bool,
    text_item_id: String,
    text_output_index: i64,
    text_accum: String,
    // 工具 item（Chat tool_calls index → 状态）
    tools: HashMap<i64, ToolItem>,
    // 已完成的 output items（供 response.completed 快照）
    output_items: Vec<Value>,
    // usage
    input_tokens: i64,
    output_tokens: i64,
    cache_read: i64,
}

impl ResponsesStreamConverter {
    pub fn new(model: String, input_tokens: i64) -> Self {
        Self {
            seq: 0,
            response_id: String::new(),
            model,
            created_sent: false,
            finished: false,
            incomplete: false,
            next_output_index: 0,
            text_open: false,
            text_item_id: String::new(),
            text_output_index: 0,
            text_accum: String::new(),
            tools: HashMap::new(),
            output_items: Vec::new(),
            input_tokens,
            output_tokens: 0,
            cache_read: 0,
        }
    }

    /// 当前累积 token 用量 `(input, output, cache_creation, cache_read)`，供流结束后统计。
    pub fn usage(&self) -> (i64, i64, i64, i64) {
        (self.input_tokens, self.output_tokens, 0, self.cache_read)
    }

    fn next_seq(&mut self) -> i64 {
        let s = self.seq;
        self.seq += 1;
        s
    }

    fn push_event(&mut self, events: &mut Vec<String>, etype: &str, mut data: Value) {
        let seq = self.next_seq();
        if let Some(o) = data.as_object_mut() {
            o.insert("type".into(), json!(etype));
            o.insert("sequence_number".into(), json!(seq));
        }
        events.push(build_sse_event(etype, &data));
    }

    fn ensure_created(&mut self, events: &mut Vec<String>) {
        if self.created_sent {
            return;
        }
        self.created_sent = true;
        if self.response_id.is_empty() {
            self.response_id = "resp_stream".to_string();
        }
        let snap = json!({
            "id": self.response_id,
            "object": "response",
            "status": "in_progress",
            "model": self.model,
            "output": []
        });
        self.push_event(
            events,
            "response.created",
            json!({ "response": snap.clone() }),
        );
        self.push_event(events, "response.in_progress", json!({ "response": snap }));
    }

    fn ensure_text_item(&mut self, events: &mut Vec<String>) {
        if self.text_open {
            return;
        }
        self.text_open = true;
        let idx = self.next_output_index;
        self.next_output_index += 1;
        self.text_output_index = idx;
        self.text_item_id = format!("msg_{idx}");
        let item_id = self.text_item_id.clone();
        self.push_event(
            events,
            "response.output_item.added",
            json!({
                "output_index": idx,
                "item": {
                    "id": item_id,
                    "type": "message",
                    "status": "in_progress",
                    "role": "assistant",
                    "content": []
                }
            }),
        );
        let item_id = self.text_item_id.clone();
        self.push_event(
            events,
            "response.content_part.added",
            json!({
                "item_id": item_id,
                "output_index": idx,
                "content_index": 0,
                "part": { "type": "output_text", "text": "", "annotations": [] }
            }),
        );
    }

    fn close_text(&mut self, events: &mut Vec<String>) {
        if !self.text_open {
            return;
        }
        self.text_open = false;
        let id = self.text_item_id.clone();
        let idx = self.text_output_index;
        let full = self.text_accum.clone();
        self.push_event(
            events,
            "response.output_text.done",
            json!({
                "item_id": id, "output_index": idx, "content_index": 0, "text": full
            }),
        );
        self.push_event(
            events,
            "response.content_part.done",
            json!({
                "item_id": id, "output_index": idx, "content_index": 0,
                "part": { "type": "output_text", "text": full, "annotations": [] }
            }),
        );
        let final_item = json!({
            "id": id, "type": "message", "status": "completed", "role": "assistant",
            "content": [{ "type": "output_text", "text": full, "annotations": [] }]
        });
        self.output_items.push(final_item.clone());
        self.push_event(
            events,
            "response.output_item.done",
            json!({ "output_index": idx, "item": final_item }),
        );
        self.text_accum.clear();
    }

    fn handle_tool_call(&mut self, tc: &Value, events: &mut Vec<String>) {
        let index = tc.get("index").and_then(|v| v.as_i64()).unwrap_or(0);
        let func = tc.get("function");
        let id = tc.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let has_name = func
            .and_then(|f| f.get("name"))
            .and_then(|v| v.as_str())
            .is_some();

        // 首见该 index（带 id 或 name）→ 关文本、开新 function_call item
        if !self.tools.contains_key(&index) && (!id.is_empty() || has_name) {
            self.close_text(events);
            let out_idx = self.next_output_index;
            self.next_output_index += 1;
            let name = func
                .and_then(|f| f.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let call_id = if id.is_empty() {
                format!("call_{out_idx}")
            } else {
                id.to_string()
            };
            let item_id = format!("fc_{out_idx}");
            self.tools.insert(
                index,
                ToolItem {
                    output_index: out_idx,
                    item_id: item_id.clone(),
                    call_id: call_id.clone(),
                    name: name.clone(),
                    args: String::new(),
                },
            );
            self.push_event(
                events,
                "response.output_item.added",
                json!({
                    "output_index": out_idx,
                    "item": {
                        "id": item_id, "type": "function_call", "status": "in_progress",
                        "call_id": call_id, "name": name, "arguments": ""
                    }
                }),
            );
        }

        // 参数片段 → function_call_arguments.delta（按 index 路由）
        if let Some(args) = func
            .and_then(|f| f.get("arguments"))
            .and_then(|v| v.as_str())
        {
            if !args.is_empty() {
                let routed = self.tools.get_mut(&index).map(|t| {
                    t.args.push_str(args);
                    (t.item_id.clone(), t.output_index)
                });
                if let Some((item_id, out_idx)) = routed {
                    self.push_event(
                        events,
                        "response.function_call_arguments.delta",
                        json!({ "item_id": item_id, "output_index": out_idx, "delta": args }),
                    );
                }
            }
        }
    }

    fn close_tools(&mut self, events: &mut Vec<String>) {
        if self.tools.is_empty() {
            return;
        }
        let mut items: Vec<ToolItem> = self.tools.drain().map(|(_, v)| v).collect();
        items.sort_by_key(|t| t.output_index);
        for t in items {
            let ToolItem {
                output_index,
                item_id,
                call_id,
                name,
                args,
            } = t;
            self.push_event(
                events,
                "response.function_call_arguments.done",
                json!({ "item_id": item_id, "output_index": output_index, "arguments": args }),
            );
            let final_item = json!({
                "id": item_id, "type": "function_call", "status": "completed",
                "call_id": call_id, "name": name, "arguments": args
            });
            self.output_items.push(final_item.clone());
            self.push_event(
                events,
                "response.output_item.done",
                json!({ "output_index": output_index, "item": final_item }),
            );
        }
    }

    fn absorb_usage(&mut self, chunk: &Value) {
        if let Some(u) = chunk.get("usage") {
            if !u.is_null() {
                // 先取 cache_read，再算净输入：OpenAI 的 prompt_tokens/input_tokens
                // 已含 cached_tokens，需扣除以与 Claude（input_tokens 不含缓存）对齐，
                // 避免下游合计 input + output + cache_read 双重计算缓存。
                let cr = u
                    .pointer("/prompt_tokens_details/cached_tokens")
                    .or_else(|| u.pointer("/input_tokens_details/cached_tokens"))
                    .and_then(|v| v.as_i64())
                    .unwrap_or(0);
                if cr > 0 {
                    self.cache_read = cr;
                }
                if let Some(i) = u
                    .get("prompt_tokens")
                    .or_else(|| u.get("input_tokens"))
                    .and_then(|v| v.as_i64())
                {
                    self.input_tokens = (i - self.cache_read).max(0);
                }
                if let Some(o) = u
                    .get("completion_tokens")
                    .or_else(|| u.get("output_tokens"))
                    .and_then(|v| v.as_i64())
                {
                    self.output_tokens = o;
                }
            }
        }
    }

    /// 处理一个 OpenAI Chat chunk JSON，返回应发出的 Responses SSE 事件文本。
    pub fn process_chunk(&mut self, chunk: &Value) -> Vec<String> {
        let mut events = Vec::new();
        if self.response_id.is_empty() {
            if let Some(id) = chunk.get("id").and_then(|v| v.as_str()) {
                if !id.is_empty() {
                    self.response_id = format!("resp_{id}");
                }
            }
        }
        if self.model.is_empty() {
            if let Some(m) = chunk.get("model").and_then(|v| v.as_str()) {
                self.model = m.to_string();
            }
        }
        self.ensure_created(&mut events);
        self.absorb_usage(chunk);

        let choice = chunk
            .get("choices")
            .and_then(|c| c.as_array())
            .and_then(|a| a.first());
        if let Some(ch) = choice {
            let delta = ch.get("delta");

            if let Some(text) = delta
                .and_then(|d| d.get("content"))
                .and_then(|v| v.as_str())
            {
                if !text.is_empty() {
                    self.ensure_text_item(&mut events);
                    self.text_accum.push_str(text);
                    let id = self.text_item_id.clone();
                    let idx = self.text_output_index;
                    self.push_event(
                        &mut events,
                        "response.output_text.delta",
                        json!({
                            "item_id": id, "output_index": idx, "content_index": 0, "delta": text
                        }),
                    );
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

            // SenseNova 进行中 chunk 带 finish_reason:""（标准 OpenAI 是 null）；空串视为未结束，避免每条关块
            if let Some(fr) = ch
                .get("finish_reason")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
            {
                if fr == "length" {
                    self.incomplete = true;
                }
                self.close_text(&mut events);
                self.close_tools(&mut events);
            }
        }
        events
    }

    /// 收到 `data: [DONE]` 或流结束时调用：收尾未关闭 item，发 response.completed/incomplete。幂等。
    pub fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();
        self.ensure_created(&mut events);
        self.close_text(&mut events);
        self.close_tools(&mut events);
        if self.finished {
            return events;
        }
        self.finished = true;
        let status = if self.incomplete {
            "incomplete"
        } else {
            "completed"
        };
        let snap = json!({
            "id": self.response_id,
            "object": "response",
            "status": status,
            "model": self.model,
            "output": self.output_items.clone(),
            "usage": {
                "input_tokens": self.input_tokens,
                "input_tokens_details": { "cached_tokens": self.cache_read },
                "output_tokens": self.output_tokens,
                "output_tokens_details": { "reasoning_tokens": 0 },
                "total_tokens": self.input_tokens + self.output_tokens
            }
        });
        let etype = if self.incomplete {
            "response.incomplete"
        } else {
            "response.completed"
        };
        self.push_event(&mut events, etype, json!({ "response": snap }));
        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- 请求转换 ----

    #[test]
    fn string_input_becomes_user_message() {
        let req = json!({ "model": "m", "input": "hello" });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["messages"][0]["role"], json!("user"));
        assert_eq!(out["messages"][0]["content"], json!("hello"));
    }

    #[test]
    fn endpoint_model_overrides_request_model() {
        let req = json!({ "model": "req-model", "input": "hi" });
        let out = responses_request_to_chat(&req, Some("ep-model"));
        assert_eq!(out["model"], json!("ep-model"));
    }

    #[test]
    fn instructions_become_system_first() {
        let req = json!({
            "input": [{ "role": "user", "content": "q" }],
            "instructions": "be brief"
        });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["messages"][0]["role"], json!("system"));
        assert_eq!(out["messages"][0]["content"], json!("be brief"));
        assert_eq!(out["messages"][1]["role"], json!("user"));
        assert_eq!(out["messages"][1]["content"], json!("q"));
    }

    #[test]
    fn max_output_tokens_maps_to_max_completion_tokens() {
        let req = json!({ "input": "x", "max_output_tokens": 256 });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["max_completion_tokens"], json!(256));
        assert!(out.get("max_tokens").is_none());
    }

    #[test]
    fn reasoning_effort_flattens() {
        let req = json!({ "input": "x", "reasoning": { "effort": "high" } });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["reasoning_effort"], json!("high"));
    }

    #[test]
    fn parallel_tool_calls_passthrough() {
        let req = json!({ "input": "x", "parallel_tool_calls": false });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["parallel_tool_calls"], json!(false));
    }

    #[test]
    fn stop_is_dropped() {
        let req = json!({ "input": "x", "stop": ["END"] });
        let out = responses_request_to_chat(&req, None);
        assert!(out.get("stop").is_none());
    }

    #[test]
    fn stream_sets_include_usage() {
        let req = json!({ "input": "x", "stream": true });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["stream"], json!(true));
        assert_eq!(out["stream_options"]["include_usage"], json!(true));
    }

    #[test]
    fn tools_function_mapping() {
        let req = json!({
            "input": "x",
            "tools": [{
                "type": "function",
                "name": "get_weather",
                "description": "d",
                "parameters": { "type": "object" }
            }],
            "tool_choice": { "type": "function", "name": "get_weather" }
        });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["tools"][0]["type"], json!("function"));
        assert_eq!(out["tools"][0]["function"]["name"], json!("get_weather"));
        assert_eq!(out["tools"][0]["function"]["description"], json!("d"));
        assert_eq!(
            out["tool_choice"],
            json!({ "type": "function", "function": { "name": "get_weather" } })
        );
    }

    #[test]
    fn non_function_tools_skipped() {
        let req = json!({
            "input": "x",
            "tools": [{ "type": "web_search_preview" }]
        });
        let out = responses_request_to_chat(&req, None);
        assert!(out.get("tools").is_none());
    }

    #[test]
    fn input_array_function_call_becomes_assistant_tool_calls() {
        let req = json!({
            "input": [
                { "type": "function_call", "call_id": "c1", "name": "f", "arguments": "{\"a\":1}" }
            ]
        });
        let out = responses_request_to_chat(&req, None);
        let m = &out["messages"][0];
        assert_eq!(m["role"], json!("assistant"));
        assert_eq!(m["content"], Value::Null);
        assert_eq!(m["tool_calls"][0]["id"], json!("c1"));
        assert_eq!(m["tool_calls"][0]["function"]["name"], json!("f"));
        assert_eq!(
            m["tool_calls"][0]["function"]["arguments"],
            json!("{\"a\":1}")
        );
    }

    #[test]
    fn input_array_function_call_output_becomes_tool_message() {
        let req = json!({
            "input": [
                { "type": "function_call_output", "call_id": "c1", "output": "result text" }
            ]
        });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(out["messages"][0]["role"], json!("tool"));
        assert_eq!(out["messages"][0]["tool_call_id"], json!("c1"));
        assert_eq!(out["messages"][0]["content"], json!("result text"));
    }

    #[test]
    fn input_array_function_call_malformed_arguments_downgraded_to_empty() {
        // 模拟流式累积未闭合的 arguments（codex 多轮历史里常见），
        // 转换时必须降级为 `{}`，否则上游 prefill 会报 `unexpected end of data`。
        let req = json!({
            "input": [
                { "type": "function_call", "call_id": "c1", "name": "f",
                  "arguments": "{\"path\":\"foo\",\"content\":\"bar" }
            ]
        });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(
            out["messages"][0]["tool_calls"][0]["function"]["arguments"],
            json!("{}")
        );
    }

    #[test]
    fn input_array_function_call_valid_arguments_canonicalized() {
        // 合法 JSON 应规范化（排序键）后输出，保持 prefix-cache 友好。
        let req = json!({
            "input": [
                { "type": "function_call", "call_id": "c1", "name": "f",
                  "arguments": "{\"b\":2,\"a\":1}" }
            ]
        });
        let out = responses_request_to_chat(&req, None);
        assert_eq!(
            out["messages"][0]["tool_calls"][0]["function"]["arguments"],
            json!("{\"a\":1,\"b\":2}")
        );
    }

    #[test]
    fn input_array_image_part_preserved() {
        let req = json!({
            "input": [{
                "role": "user",
                "content": [
                    { "type": "input_text", "text": "what's this" },
                    { "type": "input_image", "image_url": "data:image/png;base64,AAA" }
                ]
            }]
        });
        let out = responses_request_to_chat(&req, None);
        let content = &out["messages"][0]["content"];
        assert!(content.is_array());
        assert_eq!(content[0]["type"], json!("text"));
        assert_eq!(content[1]["type"], json!("image_url"));
        assert_eq!(
            content[1]["image_url"]["url"],
            json!("data:image/png;base64,AAA")
        );
    }

    // ---- 响应转换（非流式）----

    #[test]
    fn response_text_becomes_output_text() {
        let chat = json!({
            "id": "cmpl-1", "model": "gpt-4o",
            "choices": [{ "message": { "content": "hello" }, "finish_reason": "stop" }],
            "usage": { "prompt_tokens": 10, "completion_tokens": 5 }
        });
        let out = chat_response_to_responses(&chat, "fallback");
        assert_eq!(out["object"], json!("response"));
        assert_eq!(out["status"], json!("completed"));
        assert_eq!(out["model"], json!("gpt-4o"));
        assert_eq!(out["output"][0]["type"], json!("message"));
        assert_eq!(out["output"][0]["content"][0]["type"], json!("output_text"));
        assert_eq!(out["output"][0]["content"][0]["text"], json!("hello"));
        assert_eq!(out["usage"]["input_tokens"], json!(10));
        assert_eq!(out["usage"]["output_tokens"], json!(5));
        assert_eq!(out["usage"]["total_tokens"], json!(15));
    }

    #[test]
    fn response_tool_calls_become_function_call() {
        let chat = json!({
            "choices": [{
                "message": { "content": Value::Null, "tool_calls": [
                    { "id": "call_1", "function": { "name": "f", "arguments": "{\"a\":1}" } }
                ]},
                "finish_reason": "tool_calls"
            }]
        });
        let out = chat_response_to_responses(&chat, "m");
        assert_eq!(out["output"][0]["type"], json!("function_call"));
        assert_eq!(out["output"][0]["call_id"], json!("call_1"));
        assert_eq!(out["output"][0]["name"], json!("f"));
        assert_eq!(out["output"][0]["arguments"], json!("{\"a\":1}"));
    }

    #[test]
    fn response_length_maps_to_incomplete() {
        let chat = json!({
            "choices": [{ "message": { "content": "x" }, "finish_reason": "length" }]
        });
        let out = chat_response_to_responses(&chat, "m");
        assert_eq!(out["status"], json!("incomplete"));
    }

    #[test]
    fn response_cached_tokens_mapped() {
        let chat = json!({
            "choices": [{ "message": { "content": "x" }, "finish_reason": "stop" }],
            "usage": {
                "prompt_tokens": 100, "completion_tokens": 20,
                "prompt_tokens_details": { "cached_tokens": 30 }
            }
        });
        let out = chat_response_to_responses(&chat, "m");
        assert_eq!(
            out["usage"]["input_tokens_details"]["cached_tokens"],
            json!(30)
        );
    }

    // ---- 流式转换 ----

    fn join(events: Vec<String>) -> String {
        events.join("")
    }

    fn parse_events(joined: &str) -> Vec<Value> {
        joined
            .split("\n\n")
            .filter_map(|block| {
                block
                    .lines()
                    .find_map(|l| l.strip_prefix("data:"))
                    .and_then(|d| serde_json::from_str::<Value>(d.trim()).ok())
            })
            .collect()
    }

    #[test]
    fn stream_text_emits_full_event_sequence() {
        let mut c = ResponsesStreamConverter::new("gpt-4o".into(), 7);
        let s1 = join(c.process_chunk(&json!({
            "id": "cmpl-x",
            "choices": [{ "delta": { "content": "Hi" }, "finish_reason": Value::Null }]
        })));
        assert!(s1.contains("event: response.created"));
        assert!(s1.contains("event: response.in_progress"));
        assert!(s1.contains("event: response.output_item.added"));
        assert!(s1.contains("event: response.content_part.added"));
        assert!(s1.contains("event: response.output_text.delta"));
        assert!(s1.contains("\"delta\":\"Hi\""));
        assert!(s1.contains("\"msg_0\""));

        let s2 = join(c.process_chunk(&json!({
            "choices": [{ "delta": {}, "finish_reason": "stop" }]
        })));
        assert!(s2.contains("event: response.output_text.done"));
        assert!(s2.contains("event: response.content_part.done"));
        assert!(s2.contains("event: response.output_item.done"));

        let done = join(c.finish());
        assert!(done.contains("event: response.completed"));
        assert!(done.contains("\"output_tokens\""));
    }

    #[test]
    fn stream_sequence_numbers_are_monotonic() {
        let mut c = ResponsesStreamConverter::new("m".into(), 0);
        let mut all = c.process_chunk(&json!({
            "id": "x", "choices": [{ "delta": { "content": "a" } }]
        }));
        all.extend(c.process_chunk(&json!({
            "choices": [{ "delta": { "content": "b" }, "finish_reason": "stop" }]
        })));
        all.extend(c.finish());
        let events = parse_events(&join(all));
        let seqs: Vec<i64> = events
            .iter()
            .filter_map(|e| e.get("sequence_number").and_then(|v| v.as_i64()))
            .collect();
        assert!(seqs.len() >= 5);
        for w in seqs.windows(2) {
            assert!(w[1] == w[0] + 1, "sequence_number 必须连续递增: {seqs:?}");
        }
    }

    #[test]
    fn stream_tool_call_emits_function_call_events() {
        let mut c = ResponsesStreamConverter::new("m".into(), 0);
        c.process_chunk(&json!({ "id": "x", "choices": [{ "delta": {} }] }));
        let s = join(c.process_chunk(&json!({
            "choices": [{ "delta": { "tool_calls": [
                { "index": 0, "id": "call_a", "function": { "name": "f", "arguments": "{\"x\":" } }
            ]}}]
        })));
        assert!(s.contains("event: response.output_item.added"));
        assert!(s.contains("\"type\":\"function_call\""));
        assert!(s.contains("\"fc_"));
        assert!(s.contains("event: response.function_call_arguments.delta"));
        assert!(s.contains("\"delta\":\"{\\\"x\\\":\""));

        let fin = join(c.process_chunk(&json!({
            "choices": [{ "delta": {}, "finish_reason": "tool_calls" }]
        })));
        assert!(fin.contains("event: response.function_call_arguments.done"));
        assert!(fin.contains("event: response.output_item.done"));
        let done = join(c.finish());
        assert!(done.contains("event: response.completed"));
    }

    #[test]
    fn stream_usage_chunk_updates_completed() {
        let mut c = ResponsesStreamConverter::new("m".into(), 0);
        c.process_chunk(&json!({ "id": "x", "choices": [{ "delta": { "content": "y" } }] }));
        c.process_chunk(&json!({
            "choices": [],
            "usage": { "prompt_tokens": 11, "completion_tokens": 4 }
        }));
        let done = join(c.finish());
        assert!(done.contains("\"input_tokens\":11"));
        assert!(done.contains("\"output_tokens\":4"));
        assert_eq!(c.usage(), (11, 4, 0, 0));
    }

    #[test]
    fn stream_usage_chunk_deducts_cache_read_from_input() {
        // 复现图片场景：OpenAI 末尾 usage 的 prompt_tokens 已含 cached_tokens，
        // 转换器需扣除 cache_read 得到净输入，避免合计双重计算。
        // prompt_tokens=16987, cached=16832 → 净 input=155, output=279
        let mut c = ResponsesStreamConverter::new("m".into(), 0);
        c.process_chunk(&json!({ "id": "x", "choices": [{ "delta": { "content": "y" } }] }));
        c.process_chunk(&json!({
            "choices": [],
            "usage": {
                "prompt_tokens": 16987,
                "completion_tokens": 279,
                "prompt_tokens_details": { "cached_tokens": 16832 }
            }
        }));
        assert_eq!(c.usage(), (155, 279, 0, 16832));
        // 合计 = 155 + 279 + 0 + 16832 = 17266，与上游 total_tokens 一致
        let (i, o, cc, cr) = c.usage();
        assert_eq!(i + o + cc + cr, 17266);
    }

    #[test]
    fn stream_finish_is_idempotent() {
        let mut c = ResponsesStreamConverter::new("m".into(), 0);
        c.process_chunk(&json!({ "id": "x", "choices": [{ "delta": { "content": "y" }, "finish_reason": "stop" }] }));
        let first = join(c.finish());
        assert!(first.contains("event: response.completed"));
        let second = join(c.finish());
        assert!(!second.contains("event: response.completed"));
    }
}
