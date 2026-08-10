---
title: 如何从源码构建
description: 安装 Rust / Node / pnpm 与平台依赖后，用 pnpm tauri 开发与打包。
meta:
  contentType: How-to
---

# 如何从源码构建

在本地从源码构建 ccMesh。

## 环境要求

- **Rust** stable：通过 [rustup](https://rustup.rs) 安装
- **Node.js** LTS 与 **pnpm** 10+
- 各平台 Tauri 构建依赖：见 [Tauri Prerequisites](https://tauri.app/start/prerequisites/)

## 开发

```bash
pnpm install
pnpm tauri dev
pnpm test
```

## 生产构建

```bash
pnpm tauri build
```

## 各平台额外依赖

::: code-group

```text [Windows]
MSVC 工具链 + WebView2
```

```text [macOS]
Xcode Command Line Tools（通用二进制）
```

```bash [Linux（Ubuntu/Debian 构建机）]
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  patchelf
```

:::

本地 `pnpm tauri build` 若要生成带 updater 签名的产物，需配置 `TAURI_SIGNING_PRIVATE_KEY` 等环境变量，见 [自动更新如何工作](/advanced/auto-update)。

## 代码检查

```bash
pnpm check:front
pnpm check:rust
pnpm check
```

## 常用脚本

| 命令 | 作用 |
|------|------|
| `pnpm dev` | 仅启动 Vite 前端开发服务器 |
| `pnpm build` | `tsc && vite build` 构建前端 |
| `pnpm test` | 运行 Vitest 前端单测 |
| `pnpm tauri dev` | 启动完整桌面开发环境 |
| `pnpm tauri build` | 打包生产安装包 |
| `pnpm version:set` | 更新版本号（`scripts/update-version.mjs`） |

## 技术栈

Tauri 2、Rust、axum、reqwest（rustls）、SQLite、React 19、TypeScript、Vite、TanStack Query、Tailwind CSS v4、shadcn/ui、CodeMirror 6。

模块划分见 [ccMesh 内部如何分层](/advanced/architecture)。发布与签名见 [自动更新如何工作](/advanced/auto-update)。
