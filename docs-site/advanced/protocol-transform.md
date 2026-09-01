---
title: 请求如何在协议间转换
description: 入站路径与客户端兼容矩阵，以及转换管线中的模型映射插入点与流式处理。
meta:
  contentType: Conceptual
---

# 请求如何在协议间转换

客户端按入站路径发请求；CC Mesh 按端点上的转换器改写请求与响应，让不同上游协议对外表现一致。转换器取值是 `claude` / `openai` / `codex`；按上游协议怎么选，见「如何配置上游端点」的选择转换器一节。

## 入站路径与兼容矩阵

网关按入站路径识别客户端协议：`/v1/messages` 为 Anthropic Messages，`/v1/chat/completions` 为 OpenAI Chat，`/v1/responses` 为 OpenAI Responses，`/v1/images/generations` 与 `/v1/images/edits` 为 OpenAI Images。

![API 格式转换矩阵](/screenshots/guide/07-api-matrix.png)

| 入站路径 | 入站协议 | 典型客户端 |
|----------|----------|------------|
| `/v1/messages` | Anthropic Messages | Claude Code、Claude CLI |
| `/v1/chat/completions` | OpenAI Chat Completions | OpenAI SDK、OpenAI 兼容工具 |
| `/v1/responses` | OpenAI Responses API | Codex CLI |
| `/v1/images/generations` | OpenAI Images（文生图） | OpenAI SDK、兼容绘图工具 |
| `/v1/images/edits` | OpenAI Images（图生图 / 蒙版） | OpenAI SDK、兼容绘图工具 |

矩阵中的「不支持」不是静默失败：该类入站只在匹配的端点间选路，找不到匹配端点时直接返回 400。

| 客户端 | Claude | OpenAI | Codex | 选路 |
|--------|:------:|:------:|:-----:|------|
| Claude Code | √ 直通 | √ 转 Chat | √ 转 Responses | 全部启用 |
| OpenAI 工具 | — | √ 直通 | — | 仅 OpenAI |
| Codex CLI | — | √ 转 Chat | √ 直通 | Codex + OpenAI |
| Images API | — | √ 直通 | √ 直通 | OpenAI + Codex |

## 转换时会发生什么

- **协议改写**：按转换器把请求与响应映射到上游协议；`claude` 直通。
- **流式**：上游 SSE 边解析边转换边回传；仪表盘实时监控可看到首字延迟（TTFT）。
- **思考 / reasoning**：转换时规整思考片段（如剥离或改写签名块），避免上游因结构不合规拒绝。
- **请求体规范化**：转发前整理 JSON 形态，避免上游校验失败。

用端点卡片上的连通性测试或应用内对话页验证选型是否正确。

## 模型映射在转换中的位置

1. 客户端用入站模型名发起请求。
2. 路由命中后按 `from → to` 改写出站名（映射总开关关闭则跳过）。
3. 端点设置了锁定模型时，强制覆盖请求 `model`。
4. 转换器把请求体改写为上游协议后转发。

