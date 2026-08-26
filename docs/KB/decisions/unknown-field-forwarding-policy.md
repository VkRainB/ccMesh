## Claude→OpenAI 未知字段转发决策框架

> 一句话结论：默认不转发 body 未知字段；Chat 出站剥离 `cache_control`；metadata 不进 body

**你会遇到这个问题的场景**
Anthropic Messages 请求含 `metadata`、`cache_control` 等扩展字段，转换到 OpenAI Chat 时是否保留？GLM / OpenCode Go / Qwen 等严格兼容层拒未知字段，也拒 `messages[].content` 为数组。

**为什么会出错**
「全量透传 body」在严格后端触发 400。把 Anthropic `cache_control` 留在 Chat 的 part / 消息 / tools 上，会同时逼 `content` 走数组（旧实现：有 cc 就保留 `[{type,text}]`），GLM 报 `content.str` 必须是 string，以及 `Extra inputs are not permitted: cache_control`（issue #12，cc-switch #3805/#3841）。

**正确做法**
- 默认：转换器只输出目标 schema 已知字段，未知字段不转发
- `cache_control`（**Chat 出站**）：system / message / part / tools **全部剥离**，不升消息级。纯 text 的 `content` 永远 string，多块 `join("\n")`。不要只 flatten 单 text 块（多块仍是数组，#12 照样 400）
- `cache_control`（Claude 直通 / Responses）：不在此列；直通原样，Responses 重建时本来就不拷
- `metadata`：转换层默认剥离；若需会话关联，**推荐** HTTP 头透传（如 `x-session-id`），而非塞进 OpenAI body——未实现时勿在 body 保留
- 特殊中转需求：可用显式配置开关开启 body 字段白名单，默认关（多数项目 YAGNI 暂不建）
- 每个字段写清「保留 / 剥离 / 改道 header」及单测

**反例**
❌ 错误：Anthropic metadata 原样 merge 进 OpenAI JSON body  
❌ 错误：有 `cache_control` 就把 Chat `content` 留成数组，或升到 `messages[i].cache_control`  
✅ 正确：剥离 metadata；需要时用 `x-session-id` 等头透传  
✅ 正确：Chat 出站 content 永远 string，四处不漏 `cache_control`

---
_最后更新：2026-08-26_
