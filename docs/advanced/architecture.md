# 技术架构

本节介绍 ccMesh 的整体架构与关键模块划分，帮助贡献者与进阶用户理解其内部工作方式。

## 总体分层

ccMesh 是一个 Tauri 2 桌面应用，由 **Rust 后端** 与 **React 前端** 组成，二者通过 Tauri 的 IPC（命令 + 事件）通信。

```
┌──────────────────────────────────────────────┐
│                  前端（React 19）               │
│  pages · components · hooks · stores · services │
│        TanStack Query / Zustand / shadcn        │
└───────────────────────┬──────────────────────┘
                        │ Tauri IPC（invoke / event）
┌───────────────────────┴──────────────────────┐
│                  后端（Rust / Tauri）           │
│  commands  ── 对前端暴露的命令                   │
│  modules   ── proxy / transform / stats ...     │
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
| `pages/` | 页面：Dashboard、Endpoints、ConfigProfiles、Statistics、Sync、Settings、Logs |
| `components/` | UI 组件（`ui/` shadcn 基础件、`business/` 业务件、`common/` 通用件） |
| `layouts/` | 应用外壳：侧边导航、顶栏、标题栏、窗口控制 |
| `hooks/` | 数据与逻辑封装（`useEndpoints`、`useStats`、`useUpdate` 等） |
| `stores/` | Zustand 全局状态（proxy、update、layout、filters） |
| `services/` | 调用后端命令的服务层（按模块划分） |
| `locales/` | 国际化（中 / 英） |

## 后端结构（`src-tauri/src/`）

| 模块 | 职责 |
|------|------|
| `commands/` | 暴露给前端的 Tauri 命令（endpoint、proxy、config、stats、usage、backup、webdav、update 等） |
| `modules/proxy/` | 本地代理服务：`server`、`forward`、`resolver`、`rotation`、`circuit_breaker`、`client` |
| `modules/transform/` | 协议转换：`claude_openai`、`responses_chat`、`streaming`、`reasoning_effort`、`thinking_rectifier` 等 |
| `modules/stats/` | 用量聚合（`aggregator`、`periods`） |
| `modules/usage_local/` | 本地用量解析（`claude`、`codex`） |
| `modules/storage/` | SQLite 持久化（各 repo、迁移、设备标识） |
| `modules/tool_config/` | Claude / Codex 工具配置读写 |
| `modules/webdav/` | WebDAV 同步客户端 |
| `models/` | 数据结构定义（endpoint、config、stats、usage、backup 等） |
| `utils/` | 工具（路径、原子写、脱敏、UA 等） |

## 本地代理数据流

1. **接收**：`proxy/server`（基于 axum）在本机端口接收客户端请求。
2. **解析路由**：`proxy/resolver` 根据请求模型与端点配置确定候选端点（按模型过滤）。
3. **选路**：`rotation` + `circuit_breaker` 在候选中选出一个可用端点（跳过熔断中的端点）。
4. **转换**：`transform` 按端点转换器把请求改写为上游协议，并应用模型映射。
5. **转发**：`proxy/forward` + `proxy/client`（reqwest/rustls）转发到上游并流式回传。
6. **记录**：成功 / 失败结果驱动熔断状态转换，同时写入用量与请求日志（`stats` / `storage`）。
7. **重试**：失败时按轮换策略切换到下一个端点，直到成功或耗尽重试预算。

## 持久化

使用 **SQLite** 存储端点、配置、用量统计、请求日志等，包含数据库迁移机制（`storage/migration`）。配置文件写入采用 **原子写**（`utils/atomic_write`）避免半写损坏。

## 安全性

- 密钥在界面上脱敏显示（`utils/mask`）。
- TLS 走 rustls（reqwest），不依赖系统 OpenSSL。
- 写入工具配置前自动备份原文件。

## 相关

- 转换细节见 [协议转换](./protocol-transform)。
- 选路与容错见 [轮换与熔断](./rotation)。
