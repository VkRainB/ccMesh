---
title: 如何用配置文件接入客户端
description: 用渠道管理 Claude Code、Codex 与 Claude Desktop 的本地配置；Code/Codex 保存与应用分离，Desktop 以应用配置写入，应用前自动备份。
meta:
  contentType: How-to
---

# 如何用配置文件接入客户端

**配置文件** 用「渠道」管理工具本地配置，避免手改 JSON / TOML。右上角三个标签：**Claude Code**、**Codex**、**Claude Desktop**。

![配置文件](/screenshots/config-profiles/profiles.png)

## 渠道是什么

一个渠道是面向某一工具的完整配置快照。你可以建多套（不同上游或模型组合），在列表里切换，并把当前生效内容存回渠道。

## 写入模式

- **端点配置写入**：选择 ccMesh 已有端点，自动写入 Base URL / 密钥等，接到本地代理。
- **自定义配置写入**：直接编辑完整配置，适合需要精细控制的场景。

编辑时表单与 JSON / TOML 原文双向同步。

## 保存与应用

1. **保存渠道**：只写入 ccMesh 内的渠道记录，不改工具文件。
2. **应用**：把完整配置写入工具配置路径；应用前自动备份原文件。

典型顺序：在 [端点管理](/features/endpoints) 配好上游并启动代理 → 新建渠道并选端点写入 → 核对预览 → **应用** → 打开对应客户端验证。

## Claude Code

管理 `~/.claude/settings.json`（路径随系统用户目录）。可映射 Sonnet / Opus / Haiku 等到实际模型，并设默认完成模型。图文对照见 [快速入门](/guide/quickstart#用配置文件接管-claude-code)。

逐步操作：

1. **选择 Claude Code 标签**：右上角切换（另有 Codex、Claude Desktop）。
2. **新建配置**：新建渠道时会读取本机原有配置作为基础。
3. **渠道列表**：保存、读取、编辑多套渠道。
4. **端点配置写入 / 自定义配置写入**：选 **端点配置写入** 并确认端点；也可切到自定义写入。地址填 `http://127.0.0.1:<端口>`。
5. **模型映射**：把 Sonnet / Opus / Haiku 等映射到实际模型，并设默认完成模型。
6. **完整配置预览**：右侧预览最终写入内容。
7. **保存渠道**：仅保存，不覆盖本机文件。
8. **应用**：写入 `~/.claude/settings.json`，并保存为渠道（应用前自动备份）。

## Codex

管理 `auth.json` 与 `config.toml`。同样支持端点写入与自定义写入；应用前备份。

## Claude Desktop

第三个标签管理 Claude Desktop 相关本机文件。界面可选 `claude_desktop_config.json` / `developer_settings.json` 等。

与 Claude Code / Codex 不同：Desktop 主操作只有 **应用配置**（写入本机文件，应用前备份），没有并列的「保存渠道」按钮。编辑完成后点 **应用配置**；启用 3P 模式后同样靠应用配置生效。把地址指到本机代理端口后，Desktop 经 ccMesh 访问你配置的上游。

本页不涵盖账号登录或第三方认证流程；ccMesh 本身无登录页。

## 备份与迁移

渠道应用会备份工具侧文件。端点与应用数据的跨设备备份见 [如何备份与同步配置](/features/sync)。
