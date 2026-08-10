---
title: ccMesh 是做什么的
description: 本机 AI 代理网关如何统一多上游、协议转换、轮换熔断与配置管理。
meta:
  contentType: Conceptual
---

# ccMesh 是做什么的

ccMesh 是基于 Tauri 2 + Rust + React 19 的桌面 AI 代理网关：在本机统一接入 Claude / OpenAI / Codex 等多类上游，并完成协议转换、模型映射、端点轮换与熔断、请求统计与配置管理。支持 Windows、macOS、Linux。

## 要解决的问题

使用 Claude Code、Codex CLI 等工具时，常见情况包括：

- **多个上游渠道**：多个供应商 API Key 或中转站，需要切换与轮换
- **协议不统一**：客户端说 Anthropic Messages，上游可能是 OpenAI Chat 或 Responses
- **模型名不一致**：客户端模型名与上游真实标识不同
- **稳定性**：某一上游故障时希望自动切到下一个
- **配置切换成本高**：Claude Code 的 `settings.json`、Codex 的 `auth.json` + `config.toml` 需要反复手改

把客户端指向 ccMesh 本机端口后，网关处理接入、转换、路由与统计。

## 整体工作方式

```text
┌─────────────┐      本地请求       ┌────────────────────────┐      转换 + 路由      ┌──────────────┐
│ Claude Code │ ───────────────▶  │         ccMesh         │ ───────────────────▶ │  上游 A / B / C │
│  Codex CLI  │  http://127.0.0.1 │  协议转换 · 模型映射     │   轮换 · 熔断 · 统计   │ (Claude/OpenAI)│
│   其它客户端  │ ◀───────────────  │  本地代理服务            │ ◀─────────────────── │              │
└─────────────┘      流式响应       └────────────────────────┘                      └──────────────┘
```

1. 客户端把请求发到本地代理端口。
2. 按模型名与端点配置选出可用上游（含快速队列优先规则）。
3. 按转换器改写协议并应用模型映射。
4. 转发上游、流式回传，并记录用量。
5. 失败时按轮换切换；故障端点进入熔断。

## 功能总览

| 模块 | 能力 |
|------|------|
| **仪表盘** | 代理启停、端点队列与快速队列、今日概览、实时请求监控 |
| **端点管理** | CRUD、点亮模型、模型映射、连通性测试 |
| **配置文件** | Claude Code / Codex / Claude Desktop 渠道，端点写入或自定义写入 |
| **对话** | 无工具的连通性试探 |
| **会话管理** | 本机 Claude / Codex 会话文件 |
| **统计** | 端点统计与用量统计双标签 |
| **同步** | cc-switch 迁移、本地与 WebDAV 备份 |
| **日志** | 约 500 行环形运行日志 |
| **设置** | 端口、主题、启动、UA、出站代理、宠物入口 |
| **精灵宠物** | 导入与激活桌面宠物 |
| **关于** | 版本、更新、本机工具环境检查 |

## 主要技术组件

- **后端**：Tauri 2、Rust、axum、reqwest（rustls）、SQLite
- **前端**：React 19、TypeScript、Vite、TanStack Query、Zustand、Tailwind CSS v4、shadcn/ui、CodeMirror 6

安装见 [如何安装 ccMesh](/guide/installation)。术语见 [ccMesh 里这些词分别指什么](/guide/concepts)。接着看 [第一次把请求跑通](/guide/getting-started) 或 [用截图完成第一次接入](/guide/quickstart)。
