---
title: 请求如何在协议间转换
description: 入站路径与客户端兼容矩阵，以及转换管线中的映射插入点、流式与常见失败表现。
meta:
  contentType: Conceptual
---

# 请求如何在协议间转换

客户端按入站路径发请求；ccMesh 按端点上的转换器改写请求与响应，让不同上游协议对外表现一致。转换器取值是 `claude` / `openai` / `codex`；按上游协议怎么选见 [如何配置上游端点](/features/endpoints#选择转换器)。本页写兼容矩阵与转换管线。

## 入站路径与兼容矩阵

网关按入站路径区分三类供应商（转换器）：`claude`（Anthropic）、`openai`（OpenAI Chat）、`codex`（OpenAI Responses）。

![API 格式转换矩阵](/screenshots/guide/07-api-matrix.png)

| 入站路径 | 入站协议 | 典型客户端 |
|----------|----------|------------|
| `/v1/messages` | Anthropic Messages | Claude Code、Claude CLI |
| `/v1/chat/completions` | OpenAI Chat Completions | OpenAI SDK、OpenAI 兼容工具 |
| `/v1/responses` | OpenAI Responses API | Codex CLI |

| 客户端 ↓ / 供应商 → | claude | openai | codex |
|---------------------|:------:|:------:|:-----:|
| Claude Code | ✅ | ✅ | 不支持 |
| OpenAI 工具 | 不支持 | ✅ | 不支持 |
| Codex CLI | 不支持 | ✅ | ✅ |

## 转换时会发生什么

- **协议改写**：按转换器把请求体与响应映射到上游协议（Messages ↔ Chat Completions ↔ Responses）；`claude` 直通，不改协议形态。
- **流式**：上游 SSE 边解析边转换边回传；仪表盘实时监控可看到首字延迟（TTFT）。
- **思考 / reasoning**：相关片段会规整后再转发，避免签名或结构不合规导致上游拒绝。
- **请求体规范化**：转发前整理 JSON 形态；转换器与上游协议不匹配时，上游常返回 4xx。

用端点 [连通性测试](/features/endpoints#连通性测试) 或 [对话试探](/features/chat) 验证选型是否正确。

## 模型映射在转换中的位置

1. 客户端用入站模型名发起请求。
2. 路由匹配后按 `from → to` 改写出站名（映射总开关关闭则跳过）。
3. 若端点设置了锁定模型，强制覆盖请求 `model`。
4. 转换器把请求体改写为上游协议后转发。

术语见 [模型映射](/guide/concepts#模型映射-model-mapping)。

## 流式响应

对上游 SSE 做实时转换并回传。仪表盘实时监控可看到首字延迟（TTFT）等指标。
