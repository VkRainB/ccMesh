---
title: 如何安装 CC Mesh
description: 从 GitHub Releases 安装 Windows / macOS / Linux 包，以及系统要求。
meta:
  contentType: How-to
---

# 如何安装 CC Mesh

最新安装包见 [Releases](https://github.com/VkRainB/ccMesh/releases/latest)。应用内置基于 GitHub Releases 的自动更新器。

## Windows

下载 `*-setup.exe`（NSIS）或 `*.msi`，双击安装。

首次运行需要 **WebView2 运行时**。多数 Windows 10/11 已预装；若缺失，安装程序会引导安装。

## macOS（当前为未签名版本）

::: warning Warning
当前 macOS 包未签名、未公证。Gatekeeper 可能拦截首次打开，请用右键「打开」。
:::

暂未配置 Apple 开发者签名与公证。推荐步骤：

1. 将 `ccMesh.app` 拖入「应用程序」。
2. **右键** CC Mesh →「打开」→ 再次确认「打开」。

若提示「已损坏」，在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/ccMesh.app
```

## Linux

按发行版选择安装包：

::: code-group

```bash [deb（Debian/Ubuntu，推荐）]
sudo apt install ./ccMesh_*_amd64.deb
```

```bash [AppImage]
chmod +x ccMesh_*.AppImage
./ccMesh_*.AppImage
```

```bash [rpm（Fedora/RHEL）]
sudo dnf install ./ccMesh-*.x86_64.rpm
```

:::

## 系统要求

| 平台 | 要求 |
|------|------|
| Windows | Windows 10/11，WebView2 运行时 |
| macOS | macOS 通用二进制（Apple Silicon / Intel） |
| Linux | AppImage / deb / rpm，依赖 WebKitGTK |
