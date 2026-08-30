---
title: 用配置文件接入客户端
description: 用渠道管理 Claude Code、Claude Desktop、Codex、Pi、OMP 的本地配置；应用前自动备份。
meta:
  contentType: How-to
---

# 用配置文件接入客户端

**配置文件** 用「渠道」管理工具本地配置，避免手改 JSON / TOML / YAML。右上角五个标签：**Claude Code**、**Claude Desktop**、**Codex**、**Pi**、**OMP**。

![配置文件](/screenshots/config-profiles/profiles.png)

## 渠道是什么

一个渠道是面向某一工具的完整配置快照。你可以建多套（不同上游或模型组合），在列表里切换，并把当前生效内容存回渠道。

Pi / OMP 的渠道是「拆分供应商」：每个 Provider ID 一份拆分文件；**应用** 才把启用项汇总进工具真实配置。

## 写入模式

- **端点配置写入**：地址自动指向本机网关 `http://127.0.0.1:<端口>`（Pi / OMP 会带 `/v1`），接到本地代理。
- **自定义配置写入**：直接改地址与完整配置；可从该地址拉取模型列表。

表单与右侧 Profile JSON 双向同步。汇总文件（`models.json` / `settings.json` / YAML 等）由 **应用** 生成，右侧只能预览。

## 保存与应用

1. **保存渠道**：只写入 CC Mesh 内的渠道记录，不改工具文件。
2. **应用**：把完整配置写入工具配置路径；应用前自动备份原文件。

Claude Desktop 没有单独的「保存渠道」，编辑后点 **应用配置** 即写入。

典型顺序：在端点管理配好上游并启动代理 → 新建渠道并选端点写入 → 核对预览 → **应用** → 打开对应客户端验证。

## Claude Code

管理 `~/.claude/settings.json`。

1. 切到 **Claude Code**，新建渠道（会读取本机原有配置作为基础）。
2. 选 **端点配置写入**；需要精细控制可切自定义写入。
3. 把 Sonnet / Opus / Haiku 等映射到实际模型，并设默认完成模型。
4. 核对右侧完整配置，然后 **保存渠道**、**应用**。

## Claude Desktop

管理本机 `claude_desktop_config.json` / `developer_settings.json` 等。可建多套配置，点 **应用配置** 写入（应用前备份）。把地址指到本机代理端口后，Desktop 经 CC Mesh 访问上游。

启用或关闭 **3P 模式** 后需重启 Claude Desktop。

## Codex

管理 `~/.codex/auth.json` 与 `config.toml`。同样支持端点写入与自定义写入；应用前备份。

## Pi

管理 `~/.pi/agent/models.json` 与 `~/.pi/agent/settings.json`。左侧是拆分渠道列表，可启用、排序、删除；删除会同时清掉真实配置里的引用。

1. 切到 **Pi**，新建渠道，填 **Provider ID**（字母、数字、点、下划线、短横线；已保存后用 **编辑** 改名）。
2. 选端点写入或自定义写入；自定义可点 **拉取模型**。
3. 选 API 类型（如 `openai-completions`、`anthropic-messages`、`pi-messages`），按需填秘钥 / OAuth / 请求头。
4. 在模型列表里加模型；端点模式从网关已公布模型里选。
5. 需要时点 **设为默认**（写入 `settings.json` 的 `defaultProvider` / `defaultModel`）。
6. **保存渠道** 只落拆分文件；**应用** 才写入 `models.json` / `settings.json`。

右侧三个标签：**Profile**（当前渠道，可编辑）、`models.json`、`settings.json`（汇总预览）。

## OMP

管理 `~/.omp/agent/models.yml` 与 `~/.omp/agent/config.yml`。操作与 Pi 相同：拆分渠道 + 保存 / 应用。

差异：

- 鉴权可选 `apiKey` / `none` / `oauth`；另有 `transport`（目前 `pi-native`）、discovery、remoteCompaction。
- 默认模型写入 `config.yml` 的 `modelRoles.default`，并可设 `thinkingLevel`。
- API 类型含 `google-gemini-cli`，没有 Pi 的 `pi-messages` / `mistral-conversations`。

**应用** 后写入 `models.yml` / `config.yml`。

## 备份与迁移

渠道应用会备份工具侧文件。端点与应用数据的跨设备备份在 **同步** 页。
