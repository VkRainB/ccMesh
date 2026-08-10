# 快速使用指南（图文）

本指南用一组实际截图，带你完成从「配置上游端点」到「第三方客户端成功调用」的完整流程。整个过程分为三大阶段：**在 ccMesh 配置上游 → 启动本地代理 → 让客户端接入**。

## 准备：认识 ccMesh

ccMesh 是基于 Tauri 2 + Rust + React 19 的桌面端 AI 代理网关：在本机统一接入 Claude / OpenAI / Codex 等多类上游，提供协议转换、模型映射、端点轮换与熔断、请求统计与配置管理等能力。

![ccMesh 简介](/screenshots/guide/01-intro.png)

## 第 1 步：配置上游端点

进入 **端点管理**，添加你的上游 API 提供方。

![端点管理](/screenshots/guide/02-endpoints.png)

按图中标注操作：

1. **新建端点**：点击右上角「+ 新建端点」，填写名称、API 地址、密钥，并选择转换器（`claude` / `openai`）。
2. **测试连通性**：保存后点击端点卡片上的测试按钮，验证端点是否可用（绿色「可用」表示通过）。
3. **模型映射**：为端点配置入站 → 出站的模型映射，决定客户端用什么模型名请求、实际路由到上游哪个模型。
4. **可用模型（按端点）**：启动本地代理后，页面下方会列出对外可获取的模型清单（如 `claude-opus-4-8`、`claude-fable-5`、`gpt-5.4`）。

> 提示：可以添加多个端点（如示例中的 `lanin`、`mm`），ccMesh 会在它们之间按模型轮换并对故障端点熔断。详见 [端点管理](../features/endpoints) 与 [轮换与熔断](../advanced/rotation)。

## 第 2 步：启动本地代理

进入 **仪表盘**，开启本地代理服务。

![仪表盘启动代理](/screenshots/guide/03-dashboard-start.png)

1. **点击开启端口**：打开「本地代理」开关，服务进入「运行中」（示例端口为 `3000`）。这个地址就是稍后要填到客户端里的地址。
2. **实时请求监控**：下方表格会实时显示经过 ccMesh 的每条请求——时间、端点、入站/出站路径、状态、用时、首字延迟与 Token。

记住此处显示的端口号（如 `3000`），下一步要用到。

## 第 3 步：在客户端配置 ccMesh 地址

打开你的第三方 AI 客户端（如 Cherry Studio 等支持自定义服务商的工具），新增一个「本地代理」服务商。

![客户端配置地址](/screenshots/guide/04-client-config.png)

1. **API 密钥**：ccMesh 本地代理默认不校验密钥，留空或填任意值都可以。
2. **API 地址**：填写 ccMesh 的本地地址与端口，即 `http://127.0.0.1:3000`。
3. **获取模型**：点击「获取模型列表」，客户端会从 ccMesh 拉取对外暴露的模型。

## 第 4 步：选择模型并开始使用

获取成功后，客户端会列出 ccMesh 暴露的全部模型，按需勾选启用即可。

![客户端拉取到的模型](/screenshots/guide/05-client-models.png)

此时这些模型就来自你在第 1 步配置的端点（如 `claude-opus-4-8`、`claude-fable-5`、`gpt-5.4`）。在客户端正常对话，回到 ccMesh [仪表盘](../features/dashboard) 即可看到实时请求记录。

## 进阶：用配置文件接管 Claude Code

如果你用的是 **Claude Code**，可以用 **配置文件** 模块直接生成 / 覆写它的 `settings.json`，免去手工编辑。

![配置文件 - Claude Code](/screenshots/guide/06-config-profile.png)

按图中标注：

1. **选择 Claude Code 标签**：右上角切换到 Claude Code（另有 Codex）。
2. **新建配置**：新建渠道时会读取本机原有配置作为基础。
3. **渠道列表**：可保存、读取、编辑多套渠道，便于在不同上游间切换。
4. **端点配置写入 / 自定义配置写入**：选择「端点配置写入」并确认端点，否则模型获取不到；也可切到「自定义配置写入」精细控制。地址同样填 `http://127.0.0.1:3000`。
5. **模型映射**：把 Sonnet / Opus / Haiku 等映射到实际模型（如 `claude-opus-4-8`、`gpt-5.4`），并设默认完成模型。
6. **完整配置预览**：右侧实时预览最终写入的整合配置。
7. **保存渠道**：仅保存，不覆盖本机文件。
8. **应用**：把完整配置写入 `~/.claude/settings.json`，并同时保存为一个渠道（应用前自动备份原配置）。

详见 [配置文件](../features/config-profiles)。

## 附：客户端与供应商兼容矩阵

ccMesh 网关按入站路径区分三类供应商（转换器）：`claude`（Anthropic）、`openai`（OpenAI Chat）、`codex`（OpenAI Responses）。

![API 格式转换矩阵](/screenshots/guide/07-api-matrix.png)

| 入站路径 | 入站协议 | 典型客户端 |
|----------|----------|------------|
| `/v1/messages` | Anthropic Messages | Claude Code、Claude CLI |
| `/v1/chat/completions` | OpenAI Chat Completions | OpenAI SDK、各类 OpenAI 兼容工具 |
| `/v1/responses` | OpenAI Responses API | Codex CLI |

兼容性一览：

| 客户端 ↓ / 供应商 → | claude | openai | codex |
|---------------------|:------:|:------:|:-----:|
| Claude Code | ✅ | ✅ | 不支持 |
| OpenAI 工具 | 不支持 | ✅ | 不支持 |
| Codex CLI | 不支持 | ✅ | ✅ |

> 说明：Codex CLI 兼容 Anthropic Messages 的需求，会视普遍程度后续考虑排入计划。协议转换细节见 [协议转换](../advanced/protocol-transform)。

## 下一步

- 想深入了解每个页面？前往 [功能详解](../features/dashboard)。
- 想理解轮换、熔断、转换的原理？前往 [进阶](../advanced/architecture)。
