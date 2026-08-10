---
title: 关于页能做什么
description: 查看版本、检查更新，以及本机 Claude Code / Codex / OpenCode / Pi 的环境检查。无登录。
meta:
  contentType: Reference
---

# 关于页能做什么

**关于** 展示应用信息与本机工具环境。ccMesh 无账号登录或认证页。

## 应用信息

- 显示当前版本号。
- **检查更新**：对照 GitHub Releases；若有新版本可进入更新流程，也可跳过该版本。
- 打开 GitHub 仓库、Releases，或快速入门文档链接。

更新机制细节见 [自动更新如何工作](/advanced/auto-update)。

## 本地环境检查

检测并管理这些 CLI 工具：

- Claude Code
- Codex
- OpenCode
- Pi

每张卡片显示当前版本、最新版本、运行环境（Win / WSL / macOS / Linux）以及安装或升级按钮。可 **刷新**、**诊断安装冲突**、**全部升级**。也支持复制手动 npm 安装命令。

升级前若检测到需确认的安装布局，会弹出确认对话框。
