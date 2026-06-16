# 安装

最新安装包见 [Releases](https://github.com/VkRainB/ccMesh/releases/latest)。应用支持通过内置更新器拉取新版本（详见 [自动更新](../advanced/auto-update)）。

## Windows

下载 `*-setup.exe`（NSIS）或 `*.msi`，双击安装即可。

> 首次运行需要系统已安装 **WebView2 运行时**。Windows 10/11 通常已内置；若缺失，安装程序会引导安装。

## macOS（当前为未签名版本）

由于暂未配置 Apple 开发者签名与公证，首次打开可能被 Gatekeeper 拦截。推荐：

1. 将 `ccMesh.app` 拖入「应用程序」。
2. **右键** ccMesh →「打开」→ 再次确认「打开」。

若提示「已损坏」，可在终端执行：

```bash
xattr -dr com.apple.quarantine /Applications/ccMesh.app
```

## Linux

按发行版选择安装包：

::: code-group

```bash [AppImage（推荐）]
chmod +x ccMesh_*.AppImage
./ccMesh_*.AppImage
```

```bash [deb（Debian/Ubuntu）]
sudo apt install ./ccMesh_*_amd64.deb
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
| Linux | 提供 AppImage / deb / rpm，依赖 WebKitGTK |

## 从源码构建

如果你想自行编译，请参阅 [从源码构建](../advanced/build-from-source)。

## 下一步

安装完成后，前往 [快速上手](./getting-started) 完成首个端点接入。
