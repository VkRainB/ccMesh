# cc-switch 推理强度到 Chat Completions 的映射调研

调研对象：`E:/myCode/cc-switch`，日期：2026-07-28。

## 结论摘要

cc-switch 里有两条容易混淆的转换路径：

1. Claude/Anthropic Messages 入站 `/v1/messages`，当供应商配置为 OpenAI Chat 兼容上游时，转换为出站 `/v1/chat/completions`。这条路径的推理强度来自 Anthropic 请求体的 `output_config.effort` 或 `thinking`。
2. Codex 客户端入站通常不是 `/v1/messages`，而是 `/responses` 或 `/v1/responses`；当供应商配置为 Chat Completions 上游时，cc-switch 转换为出站 `/v1/chat/completions`。这条路径的推理强度来自 Codex/OpenAI Responses 请求体的 `reasoning.effort`，并由供应商元数据 `codexChatReasoning` 决定输出字段和值域。

用户侧提到的 `Low / Medium / High / Extra / Max / Ultracode` 更贴近 Codex 的强度档位。cc-switch 源码中实际实现的规范值是 `low / medium / high / xhigh / max`，其中 `Extra` 可按 `xhigh` 理解；未发现 `Ultracode` 的源码映射，若外部 UI 使用该档位，需要在进入 cc-switch 前先转换成 cc-switch 识别的规范值，否则会被当作未知值处理。

## 路由入口

### Claude/Anthropic Messages -> OpenAI Chat

相关文件：

- `src-tauri/src/proxy/server.rs`
- `src-tauri/src/proxy/handlers.rs`
- `src-tauri/src/proxy/forwarder.rs`
- `src-tauri/src/proxy/providers/claude.rs`
- `src-tauri/src/proxy/providers/transform.rs`

`/v1/messages` 和 `/claude/v1/messages` 注册到 messages handler。供应商是 Claude/Anthropic 类型且 `api_format` 指向 `openai_chat` 等需要转换的格式时，forwarder 会把上游目标改成 Chat Completions，并在发送前调用 Anthropic -> OpenAI Chat 的转换逻辑。

推理强度解析核心在 `src-tauri/src/proxy/providers/transform.rs`：

- `supports_reasoning_effort(model)` 判断模型是否支持 OpenAI Chat 的 `reasoning_effort`。
- `resolve_reasoning_effort(body)` 从 Anthropic 请求体解析强度。
- `anthropic_to_openai_with_reasoning_content(body, preserve_reasoning_content)` 生成 Chat Completions 请求体。

### Codex Responses -> OpenAI Chat

相关文件：

- `src-tauri/src/proxy/forwarder.rs`
- `src-tauri/src/proxy/providers/codex.rs`
- `src-tauri/src/proxy/providers/transform_codex_chat.rs`
- `src/types.ts`
- `src/config/codexProviderPresets.ts`

生产路径在 `forwarder.rs`：Codex/GrokBuild 请求命中 `/responses`、`/v1/responses`、`/responses/compact`、`/v1/responses/compact`，且 provider 被识别为 Chat Completions 上游时，进入 `responses_to_chat_completions_with_reasoning`。

判断条件在 `codex.rs`：

- `should_convert_codex_responses_to_chat(provider, endpoint)`：只处理 Responses 端点。
- `codex_provider_uses_chat_completions(provider)`：从 `meta.api_format`、settings 里的 `apiFormat/api_format`、TOML `wire_api`，或完整 `/chat/completions` URL 判断上游是否是 Chat。
- `resolve_codex_chat_reasoning_config(provider, body)`：读取或推断供应商推理参数配置。

## Claude/Anthropic Messages 路径的强度映射

`resolve_reasoning_effort` 优先看 `output_config.effort`：

| 入站字段 | 出站字段 |
| --- | --- |
| `output_config.effort = "low"` | `reasoning_effort = "low"` |
| `output_config.effort = "medium"` | `reasoning_effort = "medium"` |
| `output_config.effort = "high"` | `reasoning_effort = "high"` |
| `output_config.effort = "max"` | `reasoning_effort = "xhigh"` |
| 其他值，包括 `xhigh` | 不注入 `reasoning_effort` |

如果没有显式 `output_config.effort`，再按 `thinking` 回退：

| 入站字段 | 出站字段 |
| --- | --- |
| `thinking.type = "adaptive"` | `reasoning_effort = "xhigh"` |
| `thinking.type = "enabled"` 且 `budget_tokens < 4000` | `reasoning_effort = "low"` |
| `thinking.type = "enabled"` 且 `4000 <= budget_tokens < 16000` | `reasoning_effort = "medium"` |
| `thinking.type = "enabled"` 且 `budget_tokens >= 16000` | `reasoning_effort = "high"` |
| `thinking.type = "enabled"` 但无预算 | `reasoning_effort = "high"` |
| `thinking.type = "disabled"` 或无 `thinking` | 不注入 `reasoning_effort` |

这条路径没有 `Low / Medium / High / Extra / Max / Ultracode` 这些 UI 标签的直接处理，只处理请求体里已有的 Anthropic 字段。

## Codex Responses 路径的强度映射

核心函数在 `transform_codex_chat.rs`：

- `apply_reasoning_options(result, body, model, config)`：总入口。
- `reasoning_requested(body)`：判断是否显式请求或关闭推理。
- `map_reasoning_effort(effort, mode)`：按供应商模式映射值。

处理顺序：

1. 如果没有 provider reasoning config，但模型支持 `reasoning_effort`，直接把 `body.reasoning.effort` 原样复制到顶层 `reasoning_effort`。
2. 如果存在 config，先判断 `reasoning` 是否出现；完全不带 `reasoning` 时不注入任何推理字段。
3. 如果 `reasoning.effort` 是 `none/off/disabled`，认为是显式关闭。
4. 如果供应商支持 thinking toggle，先输出对应开关：`thinking.type`、`enable_thinking` 或 `reasoning_split`。
5. 如果供应商支持 effort，再通过 `effortValueMode` 映射具体强度，并写到 `reasoning_effort` 或 `reasoning.effort`。

### 规范档位

cc-switch 识别的 Codex canonical effort 值：

| 用户侧档位 | cc-switch 中可识别的值 | 备注 |
| --- | --- | --- |
| Low | `low` | 可识别 |
| Medium | `medium` | 可识别 |
| High | `high` | 可识别 |
| Extra | `xhigh` | 源码用 `xhigh`，未见 literal `extra` 映射 |
| Max | `max` | 可识别，但部分上游会被钳制 |
| Ultracode | 无 | 未发现源码映射；直接传入会作为未知值被丢弃或不注入 effort |

### `effortValueMode = passthrough`

默认模式。合法值原样输出：

| 入站 `reasoning.effort` | 映射结果 |
| --- | --- |
| `minimal` | `minimal` |
| `low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh` | `xhigh` |
| `max` | `max` |
| `none/off/disabled` | 不返回 effort 值 |
| 未知值，例如 `extra`、`ultracode` | 不返回 effort 值 |

输出字段由 `effortParam` 决定：

- `reasoning_effort`：输出顶层 `reasoning_effort`。
- `reasoning.effort`：输出嵌套对象 `reasoning: { effort: ... }`。
- `none`：不输出具体 effort。

### `effortValueMode = deepseek`

DeepSeek 官方 Chat 兼容接口使用。预设中 `DeepSeek` 明确配置：

```ts
codexChatReasoning: {
  supportsThinking: true,
  supportsEffort: true,
  thinkingParam: "thinking",
  effortParam: "reasoning_effort",
  effortValueMode: "deepseek",
  outputFormat: "reasoning_content",
}
```

映射结果：

| 入站 `reasoning.effort` | 出站 |
| --- | --- |
| `xhigh` | `thinking: { type: "enabled" }` + `reasoning_effort: "max"` |
| `max` | `thinking: { type: "enabled" }` + `reasoning_effort: "max"` |
| `minimal/low/medium/high` | `thinking: { type: "enabled" }` + `reasoning_effort: "high"` |
| `none/off/disabled` | `thinking: { type: "disabled" }`，不输出 `reasoning_effort` |
| 未知值 | `thinking: { type: "enabled" }`，但不输出 `reasoning_effort` |

因此在 DeepSeek 模式下：

- Low、Medium、High 都会压成 DeepSeek 的 `high`。
- Extra/xhigh 和 Max 都会压成 DeepSeek 的 `max`。
- Ultracode 没有特殊规则。

### `effortValueMode = low_high`

StepFun 2603 这类只有 low/high 两档的上游使用。

| 入站 `reasoning.effort` | 出站 |
| --- | --- |
| `minimal` | `low` |
| `low` | `low` |
| `medium/high/xhigh/max` | `high` |
| `none/off/disabled` | 不输出 effort |
| 未知值 | 不输出 effort |

### `effortValueMode = openrouter`

OpenRouter 平台使用原生归一化对象 `reasoning: { effort }`，不是顶层 `reasoning_effort`。原因是 OpenRouter 会把它翻译成底层 OpenAI/Grok/Gemini/Anthropic 等模型的正确参数，覆盖面比 OpenAI 顶层别名更全。

映射结果：

| 入站 `reasoning.effort` | 出站 |
| --- | --- |
| `minimal` | `reasoning: { effort: "minimal" }` |
| `low` | `reasoning: { effort: "low" }` |
| `medium` | `reasoning: { effort: "medium" }` |
| `high` | `reasoning: { effort: "high" }` |
| `xhigh` | `reasoning: { effort: "xhigh" }` |
| `max` | `reasoning: { effort: "xhigh" }` |
| `none/off/disabled` | `reasoning: { effort: "none" }` |
| 未知值 | 不输出 effort |

OpenRouter 不接受 `max`，cc-switch 显式把 `max` 钳到 `xhigh`，避免上游返回 `400 reasoning_effort: Invalid option`。

### thinking-only provider

Kimi、Kimi For Coding、GLM/Zhipu、ModelScope、Novita、Nvidia Kimi、SiliconFlow、Qwen/DashScope、MiniMax/MiMo 等路径通常只支持开关，不支持强度。

常见输出形态：

| provider 配置 | 出站字段 |
| --- | --- |
| `thinkingParam = "thinking"` | `thinking: { type: "enabled" }` 或 `thinking: { type: "disabled" }` |
| `thinkingParam = "enable_thinking"` | `enable_thinking: true/false` |
| `thinkingParam = "reasoning_split"` | `reasoning_split: true/false` |
| `supportsEffort = false` | 不输出 `reasoning_effort` 或 `reasoning.effort` |

因此这些 provider 上 Low/Medium/High/Extra/Max 只影响“是否打开 thinking”，不影响强度档位；只要 `reasoning` 非空且不是显式关闭，就开启 thinking。

## Codex -> Anthropic Messages 的补充映射

虽然这不是出站 `/v1/chat/completions`，但与用户提到的 `/v1/messages` 相关。`transform_codex_anthropic.rs` 负责 Codex Responses -> Anthropic Messages：

| 入站 `reasoning.effort` | Anthropic thinking 预算 |
| --- | --- |
| `minimal` | `budget_tokens = 2048` |
| `low` | `budget_tokens = 2048` |
| `medium` | `budget_tokens = 8192` |
| `high` | `budget_tokens = 16384` |
| `xhigh` | `budget_tokens = 24576` |
| `max` | `budget_tokens = 24576` |
| 未知值 | 不启用 thinking |

如果目标模型使用 adaptive thinking，则还会把 Codex effort 归一到 Anthropic `output_config.effort`：

| 入站 `reasoning.effort` | Anthropic `output_config.effort` |
| --- | --- |
| `minimal/low` | `low` |
| `medium` | `medium` |
| `high` | `high` |
| `xhigh/max` | `max` |

## 边界行为

- 完全不带 `reasoning`：cc-switch 不注入 thinking 或 effort。
- `reasoning = null` 或 `reasoning.effort = none/off/disabled`：视为显式关闭。
- 顶层 `reasoning_effort` 形态不支持 `none`，cc-switch 会发送可用的 thinking 关闭信号，并丢弃 effort。
- OpenRouter 的 `reasoning.effort` 支持 `none`，cc-switch 会保留为 `reasoning: { effort: "none" }`。
- 未知值会被丢弃，避免上游拒绝请求；`Ultracode` 在源码中属于未知值。
- `Extra` 这个字面值未在源码中作为输入枚举出现；如果 UI 要支持 Extra，应在进入 cc-switch 前映射成 `xhigh`。

## 对本项目迁移的建议

若 tauri-gateway 要复用 cc-switch 的规则，建议只迁移 Codex Chat 路径的这几个最小抽象：

- provider 元数据：`supportsThinking`、`supportsEffort`、`thinkingParam`、`effortParam`、`effortValueMode`。
- 强度规范值：`minimal/low/medium/high/xhigh/max`，用户 `Extra` 映射为 `xhigh`。
- OpenRouter 特例：输出 `reasoning.effort`，`max -> xhigh`，显式关闭输出 `none`。
- DeepSeek 特例：输出顶层 `reasoning_effort`，`xhigh/max -> max`，其他开启档位 -> `high`。
- thinking-only 特例：只输出 thinking 开关，不输出 effort。

不建议直接引入 `Ultracode -> 某个 effort` 的隐式规则。应先定义它在本项目里的语义：例如等价 `max`、等价 `xhigh`，还是表示 workflow/agent 数量级别而非模型推理强度。当前 cc-switch 源码没有提供这个答案。

## 主要源码锚点

- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/transform.rs:56`：OpenAI reasoning 模型识别。
- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/transform.rs:83`：Anthropic Messages -> OpenAI Chat 的 `resolve_reasoning_effort`。
- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/transform_codex_chat.rs:264`：Codex Responses -> Chat Completions 转换入口。
- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/transform_codex_chat.rs:353`：`apply_reasoning_options`。
- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/transform_codex_chat.rs:458`：`map_reasoning_effort`。
- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/codex.rs:330`：`resolve_codex_chat_reasoning_config`。
- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/codex.rs:477`：OpenRouter/SiliconFlow 平台推断。
- `E:/myCode/cc-switch/src-tauri/src/proxy/providers/transform_codex_anthropic.rs:36`：Codex effort -> Anthropic thinking budget。
- `E:/myCode/cc-switch/src/config/codexProviderPresets.ts:154`：Kimi thinking-only 预设。
- `E:/myCode/cc-switch/src/config/codexProviderPresets.ts:965`：DeepSeek reasoning effort 预设。
