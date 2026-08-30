---
title: 自动更新如何工作
description: 基于 GitHub Releases 的应用内更新、签名校验，以及构建时注入签名环境变量。
meta:
  contentType: Conceptual
---

# 自动更新如何工作

CC Mesh 内置基于 **GitHub Releases** 的更新器，可检测、下载并应用新版本。

## 用户侧

在 **关于** 页点 **检查更新**；设置里也可配合代理更新开关。有新版本时提示下载与应用，并可跳过指定版本。

安装包发布在 [GitHub Releases](https://github.com/VkRainB/ccMesh/releases/latest)。

## 更新机制概述

Tauri 更新器依赖签名保证完整性与来源可信：

- 发布产物时用私钥对更新包签名
- 应用内置公钥校验，通过后才应用更新

出站下载是否走代理由设置中的 **代理更新**（`proxyForUpdate`）与代理 URL 决定。

## 构建带签名的产物

本地或 CI 构建带 updater 签名的产物时，配置签名环境变量（例如 `TAURI_SIGNING_PRIVATE_KEY` 及其密码）。妥善保管私钥，勿提交到仓库。

```bash
# 示例：构建前注入签名环境变量（使用你自己的密钥）
# Windows PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = "your_private_key_here"
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "your_password_here"
pnpm tauri build
```

发布流程、CI 工作流与密钥管理以仓库内文档为准：

- [`docs/KB_dev/guides/auto-update-and-release.md`](https://github.com/VkRainB/ccMesh/blob/master/docs/KB_dev/guides/auto-update-and-release.md)
- [`docs/KB_dev/build-release/tauri-updater-signing.md`](https://github.com/VkRainB/ccMesh/blob/master/docs/KB_dev/build-release/tauri-updater-signing.md)
- [`docs/KB_dev/build-release/tauri-ci-release-workflow.md`](https://github.com/VkRainB/ccMesh/blob/master/docs/KB_dev/build-release/tauri-ci-release-workflow.md)

