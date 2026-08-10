# 自动更新

ccMesh 内置基于 **GitHub Releases** 的应用内更新器，可检测、下载并应用新版本。

## 用户侧

在 [设置](../features/settings) 中可检查更新。当有新版本时，应用会提示并支持下载、应用更新。版本信息也会在界面中展示。

安装包发布在 [GitHub Releases](https://github.com/VkRainB/ccMesh/releases/latest)。

## 更新机制概述

Tauri 的更新器依赖 **签名机制** 来保证更新包的完整性与来源可信：

- 发布产物时使用私钥对更新包签名；
- 应用内置对应公钥校验签名，校验通过才会应用更新。

## 构建带签名的产物

本地或 CI 构建带 updater 签名的产物时，需要配置签名相关环境变量（例如 `TAURI_SIGNING_PRIVATE_KEY` 及其密码）。请妥善保管私钥，切勿提交到仓库。

```bash
# 示例：构建前注入签名环境变量（请使用你自己的密钥）
# Windows PowerShell
$env:TAURI_SIGNING_PRIVATE_KEY = "..."
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "..."
pnpm tauri build
```

> 具体的发布流程、CI 工作流与密钥管理细节，以项目仓库内 `docs/build-release/` 下的发布文档为准。

## 相关

- 从源码构建见 [从源码构建](./build-from-source)。
- 应用内更新入口见 [设置](../features/settings)。
