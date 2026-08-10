# 设置

设置模块集中管理全局选项，包括出站代理、CLI User-Agent 与应用内自动更新。

![设置](/screenshots/settings/settings.png)

## 全局出站代理

为 ccMesh 访问上游配置统一的出站代理地址。配合端点的「经全局代理」开关使用：

- 在设置中填写全局代理地址；
- 在 [端点管理](./endpoints) 中为需要走代理的端点开启 `useProxy`。

只有开启了该开关的端点才会经全局代理出网，其余端点直连。

## CLI User-Agent

可自定义 Claude / Codex CLI 的 User-Agent。某些上游会基于 UA 做识别或限制，自定义 UA 有助于兼容这些场景。

## 应用内自动更新

ccMesh 内置基于 **GitHub Releases** 的更新器：

- 检测新版本；
- 下载并应用更新。

更新机制的细节（签名、发布流程）见 [自动更新](../advanced/auto-update)。

## 主题

ccMesh 应用本体采用暗色优先的设计语言，并支持明暗主题与跟随系统。

## 相关

- 端点级代理开关见 [端点管理](./endpoints)。
- 备份与同步见 [同步](./sync)。
