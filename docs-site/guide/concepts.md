# 核心概念

理解以下术语有助于你更好地使用 ccMesh。

## 端点（Endpoint）

一个上游 API 提供方。每个端点包含地址、密钥、认证模式、转换器类型、模型清单与模型映射等。多个端点组成一个可轮换的池。

关键字段：

| 字段 | 含义 |
|------|------|
| `name` | 端点别名 |
| `apiUrl` / `apiKey` | 上游地址与密钥 |
| `authMode` | 认证模式：`api_key`（默认）/ `auth_token` 等 |
| `enabled` | 是否参与路由 |
| `useProxy` | 是否经全局出站代理出网 |
| `transformer` | 转换器：`claude` / `openai` / `codex` |
| `model` | 锁定模型（非空则强制覆盖客户端 model；空则透传） |
| `models` | 对外暴露的模型清单（供 `/v1/models` 与 UI 展示） |
| `modelMappings` | 入站 → 出站模型映射 |
| `testStatus` | 测试状态：`unknown` / `available` / `unavailable` |

## 转换器（Transformer）

决定 ccMesh 如何把客户端请求改写为上游协议：

- **claude（直通）**：上游本身是 Anthropic Messages 协议，原样转发。
- **openai（转换）**：在 Anthropic 与 OpenAI Chat Completions 之间互转。
- **codex（Responses）**：面向 Codex / Responses 协议的转换。

详见 [协议转换](../advanced/protocol-transform)。

## 模型映射（Model Mapping）

一条 `from → to` 规则：客户端用 **入站名** `from` 请求，ccMesh 在路由匹配后把它改写为上游真实的 **出站名** `to` 再转发。这样可以：

- 屏蔽不同上游的模型命名差异；
- 用统一的模型名对客户端暴露；
- 把同一入站模型分发到不同上游的对应模型。

## 轮换（Rotation）

多个启用端点之间的请求分配策略。ccMesh 维护当前端点索引，按需前进到下一个端点；当某端点连续失败到阈值时，自动切换到下一个候选。轮换会按请求的模型进行过滤，避免不支持该模型的端点被误选。

## 熔断器（Circuit Breaker）

每个端点拥有独立的三态熔断器：

- **Closed（闭合）**：正常放行。
- **Open（断开）**：连续失败或错误率超阈值后触发，选路时跳过该端点。
- **HalfOpen（半开）**：冷却到期后，由下一个真实请求惰性进入，单许可放行一个探测请求；探测成功累计达标则恢复 Closed，失败则立即重新 Open。

客户端错误（4xx 业务错误）被视为**中性**，不会污染熔断统计。详见 [轮换与熔断](../advanced/rotation)。

## 渠道（Channel / Profile）

**配置文件** 模块中的概念：把一套面向某个工具（Claude Code 或 Codex）的完整配置打包为一个「渠道」，可保存多个并一键应用。应用渠道时会把对应配置写入工具的配置文件（应用前自动备份）。

## 应用（App）

统计与配置文件中区分的客户端来源，主要为 **Claude Code** 与 **Codex**。统计可按应用维度聚合用量。
