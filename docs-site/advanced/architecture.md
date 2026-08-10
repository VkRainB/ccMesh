---
title: ccMesh 内部如何分层
description: Tauri 前后端分层、页面清单、代理数据流与持久化边界，供贡献者与进阶用户对照源码。
meta:
  contentType: Conceptual
---

# ccMesh 内部如何分层

本节说明整体架构与模块划分，帮助贡献者与进阶用户对照源码。

## 总体分层

ccMesh 是 Tauri 2 桌面应用：**Rust 后端** 与 **React 前端** 通过 IPC（命令 + 事件）通信。

```text
┌──────────────────────────────────────────────┐
│                  前端（React 19）               │
│  pages · components · hooks · stores · services │
│        TanStack Query / Zustand / shadcn        │
└───────────────────────┬──────────────────────┘
                        │ Tauri IPC（invoke / event）
┌───────────────────────┴──────────────────────┐
│                  后端（Rust / Tauri）           │
│  commands  ── 对前端暴露的命令                   │
│  modules   -- proxy / transform / stats …       │
│  models    ── 数据结构                           │
│  storage   ── SQLite 持久化                      │
└───────────────────────┬──────────────────────┘
                        │ reqwest（rustls）
                  ┌──────┴──────┐
                  │  上游 API     │
                  └─────────────┘
```

## 前端结构（`src/`）

| 目录 | 职责 |
|------|------|
| `pages/` | 见下方页面清单 |
| `components/` | UI（`ui/`、`business/`、`common/`） |
| `layouts/` | 侧栏、顶栏、标题栏、窗口控制 |
| `hooks/` | `useEndpoints`、`useStats`、`useUpdate` 等 |
| `stores/` | Zustand（proxy、update、layout、filters） |
| `services/` | 调用后端命令的服务层 |
| `locales/` | 国际化（中 / 英） |

### 页面清单（`src/pages/`）

| 页面 | 说明 |
|------|------|
| `Dashboard` | 代理启停、端点队列、快速队列、实时监控 |
| `Endpoints` | 端点 CRUD、点亮、映射、测试 |
| `ConfigProfiles` | Claude Code / Codex / Claude Desktop 渠道 |
| `Chat` | 无工具连通性试探 |
| `ToolSessions` | 本机 Claude / Codex 会话文件 |
| `Statistics` | 端点统计 / 用量统计 |
| `Sync` | cc-switch 迁移、WebDAV、本地备份 |
| `Logs` | 运行日志环形缓冲 |
| `Settings` | 常规、启动、UA、代理、宠物入口 |
| `Pet` | 精灵宠物导入与激活 |
| `About` | 版本、更新、本地环境检查 |

## 后端结构（`src-tauri/src/`）

| 模块 | 职责 |
|------|------|
| `commands/` | Tauri 命令 |
| `modules/proxy/` | `server`、`forward`、`resolver`、`rotation`、`circuit_breaker`、`client` |
| `modules/transform/` | 协议转换与流式处理 |
| `modules/stats/` | 网关用量聚合 |
| `modules/usage_local/` | 本机 Claude / Codex 会话用量 |
| `modules/storage/` | SQLite 与迁移 |
| `modules/tool_config/` | 工具配置读写 |
| `modules/cc_switch_migration/` | cc-switch 导入 |
| `modules/webdav/` | WebDAV 客户端 |
| `modules/logs/` | 日志捕获层（约 500 行缓冲） |
| `models/` | 数据结构 |
| `utils/` | 路径、原子写、脱敏、UA 等 |

## 本地代理数据流

1. **接收**：`proxy/server`（axum）在本机端口接收请求。
2. **可路由列表**：`list_routable`：若存在 `fast=true` 的启用端点则只取快速队列，否则取全部启用端点。
3. **解析**：`resolver` 按请求模型过滤候选。
4. **选路**：`rotation` + `circuit_breaker` 选出可用端点。
5. **转换**：`transform` 按转换器改写并应用模型映射。
6. **转发**：`forward` + `client`；出站代理真值见 `should_use_proxy`。
7. **记录**：结果驱动熔断，并写入 stats。
8. **重试**：失败时切换候选，直到成功或耗尽预算。

## 持久化

**SQLite** 存端点、配置、用量与请求日志，含迁移。写入工具配置用 **原子写**，避免半写损坏。

## 安全性

- 密钥在界面脱敏（`utils/mask`）
- TLS 走 rustls，不依赖系统 OpenSSL
- 写入工具配置前自动备份

转换细节见 [请求如何在协议间转换](/advanced/protocol-transform)。选路数字见 [轮换与熔断如何工作](/advanced/rotation)。
