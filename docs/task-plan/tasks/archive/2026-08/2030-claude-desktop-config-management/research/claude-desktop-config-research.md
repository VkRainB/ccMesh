# Claude Desktop 配置文件接管管理调研

## 1. 需求理解

用户希望在现有“配置文件”功能中新增一个 Claude Desktop 卡项 / Tab，用来管理 Claude Desktop 的 3P 自定义网关配置。该功能和当前 Claude Code、Codex 配置管理不同：

- 当前项目已有功能偏“快照模式”：从真实配置抽取快照，保存到应用自己的 profiles 目录，用户点击“应用”时再覆写真实配置。
- Claude Desktop 需求是“文件接管模式”：直接读取和管理 Claude Desktop 真实配置目录下的 JSON 文件。
- Claude Desktop 的一个 `<profile-id>.json` 代表一个具体渠道 / 网关配置。
- `configLibrary/_meta.json` 是所有 profile 文件的实时总索引；新增 profile 文件时必须同步注册 `_meta.json`。
- 开启 3P 模式还要接管 / 写入 `developer_settings.json` 和 `claude_desktop_config.json`。
- Windows 上不能只按逻辑路径写 `%LOCALAPPDATA%\Claude-3p`，因为 MSIX 可能把实际文件放到 `Packages\<PackageFamilyName>\LocalCache\Local\Claude-3p`。

## 2. 外部路径报告结论

### 2.1 跨平台路径

来自 `E:\check-claude-desktop\CLAUDE_DESKTOP_CONFIG_PATH_CROSS_PLATFORM.md`：

| 平台 | 3P 数据根 | 实现策略 |
| --- | --- | --- |
| macOS | `~/Library/Application Support/Claude-3p` | 逻辑路径通常就是物理路径，直接拼接即可 |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/Claude-3p` | 可按 XDG 公式支持；若项目想短期保守，也可先灰显 |
| Windows | `%LOCALAPPDATA%\Claude-3p` | 逻辑路径不可靠，必须优先探测 MSIX 物理目录 |

核心文件清单：

```text
<3p-root>/claude_desktop_config.json
<3p-root>/developer_settings.json
<3p-root>/configLibrary/_meta.json
<3p-root>/configLibrary/<profile-id>.json
```

普通 Claude 目录还可能存在：

```text
<normal-claude-root>/claude_desktop_config.json
```

它主要用于把普通 1P 侧也切换到 `deploymentMode: "3p"`。

### 2.2 Windows MSIX 物理目录

来自 `CLAUDE_MSIX_PATH_REPORT.md` 与 `CLAUDE_PHYSICAL_PATH_INTEGRATION.md`：

- `Claude_pzs8sxrjxfjjc` 是 Package Family Name，来自 MSIX Identity Name + PublisherId。
- Package Family Name 通常不随版本变；安装目录 Package Full Name 会随版本变。
- 当前机器实测 3P 物理目录：

```text
C:\Users\Administrator\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Claude-3p
```

- 1P / Roaming 侧可能物理目录：

```text
C:\Users\Administrator\AppData\Local\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude
```

### 2.3 Windows 路径获取只做两个高收益方法

需求明确要求“只需要采取两个高效的方法获取即可，不用全部实现，注意精简”。推荐实现：

1. **`Get-AppxPackage -Name Claude`**
   - 官方包信息，能直接拿 `PackageFamilyName`。
   - 拼出：`%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Local\Claude-3p`。
   - 同时可拼出：`%LOCALAPPDATA%\Packages\<PFN>\LocalCache\Roaming\Claude`。

2. **候选目录探测**
   - 枚举 / 检查：
     - `%LOCALAPPDATA%\Packages\Claude_*\LocalCache\Local\Claude-3p`
     - `%LOCALAPPDATA%\Claude-3p`
   - 用标记文件打分：
     - `configLibrary/_meta.json`：高权重
     - `configLibrary/*.json`：高权重
     - `claude_desktop_config.json`：中权重
     - `developer_settings.json`：中权重
     - `logs/main.log`：中权重

`CLAUDE_USER_DATA_DIR` 可作为跨平台最高优先级覆盖项保留；它不是 Windows 物理路径获取方法，不违反“只做两个高效方法”的精简要求。

## 3. 当前项目现有架构

### 3.1 后端配置管理

关键文件：

- `src-tauri/src/modules/tool_config/mod.rs`
- `src-tauri/src/modules/tool_config/claude.rs`
- `src-tauri/src/modules/tool_config/codex.rs`
- `src-tauri/src/models/tool_config.rs`
- `src-tauri/src/commands/tool_config.rs`
- `src-tauri/src/utils/paths.rs`
- `src-tauri/src/lib.rs`

当前 `tool_config` 模块负责：

```text
抽取真实配置 -> 保存 app_data profiles 快照 -> 用户编辑 -> 应用时备份并覆写真实配置
```

当前支持：

- Claude Code：`~/.claude/settings.json` 单 JSON 文件。
- Codex：`~/.codex/auth.json` + `~/.codex/config.toml` 双文件。

当前 `Tool` 枚举只有：

```rust
pub enum Tool {
    Claude,
    Codex,
}
```

这些抽象对 Claude Desktop 的帮助：

- 可复用 `atomic_write`、JSON 读写、备份策略、错误类型、命令注册方式。
- 不建议复用 app_data profiles 快照目录作为主存储，因为 Claude Desktop 是真实文件接管。

### 3.2 前端配置页面

关键文件：

- `src/pages/ConfigProfiles/index.tsx`
- `src/pages/ConfigProfiles/_components/ClaudeWorkspace.tsx`
- `src/pages/ConfigProfiles/_components/CodexWorkspace.tsx`
- `src/pages/ConfigProfiles/_components/ChannelList.tsx`
- `src/pages/ConfigProfiles/_components/FormFieldLabel.tsx`
- `src/pages/ConfigProfiles/_components/ModelCombobox.tsx`
- `src/components/common/JsonEditor.tsx`
- `src/services/modules/tool_config.ts`
- `src/hooks/useToolConfigChannels.ts`
- `src/lib/toolConfig.ts`

当前页面结构是：

```text
配置文件页
  顶部 Tabs: Claude Code / Codex
  Workspace:
    左栏 ChannelList
    中栏字段表单 + 关键配置编辑器
    右栏完整配置 JsonEditor
    底部保存 / 应用操作区
```

Claude Desktop 最适合接入：

- 在 `ConfigProfiles/index.tsx` 新增第三个 Tab：`Claude Desktop`。
- 新建 `ClaudeDesktopWorkspace.tsx`，复用三栏布局。
- 左栏复用或轻量泛化 `ChannelList`，文案从“渠道”改为可传入的“配置文件”。
- 中栏复用 `FormFieldLabel`、`ModelCombobox`、`Input`、`Switch`、`Tabs`。
- 右栏复用 `JsonEditor`，用文件 Tab 切换 profile / `_meta.json` / `developer_settings.json` / `claude_desktop_config.json`。

## 4. 产品风险与设计约束

### 4.1 不直接暴露敏感内容到日志和文档

`configLibrary/*.json` 可能含 token、网关地址、账号信息。后端错误和日志只允许输出文件路径、字段名、错误类型，不允许输出完整 JSON 文本。

### 4.2 文件接管要比快照模式更谨慎

因为保存动作可能直接写真实文件，UI 必须说明：

- 当前解析出的真实物理目录。
- 本次将写入哪些文件。
- 是否需要关闭 / 重启 Claude Desktop。
- 写入前会创建备份。

### 4.3 `_meta.json` 是实时关系，不是普通快照

推荐把 `_meta.json` 的关系在 UI 中结构化表达：

```text
当前配置文件：xxx.json
_meta 注册状态：已注册 / 未注册
当前应用配置：是 / 否
文件状态：存在 / 缺失 / JSON 无效
```

右栏仍提供原始 JSON 查看 / 编辑，但用户默认通过中栏表单理解关系。

## 5. 推荐结论

1. Claude Desktop 放在现有“配置文件”页面第三个 Tab，而不是新增全局导航入口。
2. 后端在 `tool_config` 模块下新增 `claude_desktop.rs`，但不把它塞进现有 `Tool::Claude/Codex` 快照流程。
3. 前端服务新建 `src/services/modules/claude_desktop_config.ts`，避免污染 `toolConfigApi` 的快照语义。
4. Windows 路径解析只实现两种高收益方法：`Get-AppxPackage` + 候选目录探测。
5. 写盘前必须备份，删除默认应先设计成“解除注册”，真正删除真实文件需要二次确认。
