# Claude Desktop 配置文件接管管理 PRD

## Goal

在现有“配置文件”页面中新增 Claude Desktop 配置管理能力，让用户可以在 ccMesh 内查看、创建、编辑、注册和应用 Claude Desktop 3P 自定义网关配置文件，同时清楚理解 `_meta.json` 与各 profile 文件的实时关系，并在 Windows MSIX 场景下读写正确的物理目录。

## Requirements

1. **新增入口**
   - 在现有 `配置文件` 页面新增 `Claude Desktop` 卡项 / Tab。
   - 不新增全局导航入口，避免功能入口膨胀。

2. **路径解析**
   - 支持 macOS、Windows 的 Claude Desktop 3P 配置路径解析。
   - Linux 可按 XDG 公式预留支持；若实现阶段风险高，可先返回 unsupported 并在 UI 灰显。
   - Windows 必须优先解析 MSIX 物理目录，不得只写 `%LOCALAPPDATA%\Claude-3p`。
   - Windows 路径获取只实现两个高效方法：
     1. `Get-AppxPackage -Name Claude` 获取 Package Family Name。
     2. 候选目录探测和标记打分。
   - `CLAUDE_USER_DATA_DIR` 作为跨平台最高优先级覆盖项。

3. **文件接管**
   - 直接读取 Claude Desktop 真实配置目录，而不是把配置先复制到 app data profiles 快照目录作为主数据源。
   - 管理以下文件：
     - `configLibrary/_meta.json`
     - `configLibrary/<profile-id>.json`
     - `claude_desktop_config.json`
     - `developer_settings.json`
   - 读取时必须识别每个文件的存在状态、JSON 有效性、最后修改时间和注册关系。

4. **profile 与 `_meta.json` 关系表达**
   - 左栏展示 profile 列表，来源以 `_meta.json` 注册项为主，并补充孤儿 profile 文件。
   - 中栏展示当前 profile 的结构化表单、注册状态、当前应用状态、路径信息。
   - 右栏用 JSON 编辑器查看 / 编辑原始文件。
   - 新增 profile 时必须同步注册 `_meta.json`。

5. **网关配置写入**
   - 支持“端点配置写入”：自动使用当前 ccMesh 网关地址、端点模型和 API Key 字段。
   - 支持“自定义配置写入”：允许用户手动填写 base URL、API Key、模型映射或直接编辑 JSON。
   - 具体 profile JSON 的字段映射要以真实 Claude Desktop profile 结构为准；不能把 Claude Code `settings.json` 结构无脑套用。

6. **3P 模式启用**
   - 提供“启用 / 应用 3P 模式”动作。
   - 写入或合并 `claude_desktop_config.json` 与 `developer_settings.json` 所需字段。
   - UI 必须提示：Claude Desktop 可能需要重启后生效。

7. **写盘安全**
   - 所有写入必须先备份再原子写。
   - 多文件写入要尽可能分阶段，失败时给出清晰错误和已写入文件列表。
   - 不在日志、toast、文档中输出完整配置内容或 token。

## Acceptance Criteria

- [ ] 用户能在“配置文件”页面看到 `Claude Desktop` Tab。
- [ ] 打开 Tab 后能看到解析出的 3P 配置目录、解析来源、是否 Windows MSIX 物理路径。
- [ ] Windows MSIX 场景优先读写 `Packages\<PFN>\LocalCache\Local\Claude-3p` 下的 `configLibrary`。
- [ ] 用户能看到 `_meta.json` 注册的 profile 列表，也能识别未注册但存在的孤儿 JSON 文件。
- [ ] 用户能新增一个 profile，新增时同步写入 `<profile-id>.json` 和 `_meta.json`。
- [ ] 用户能用表单写入 ccMesh 本机网关配置，也能切换到自定义配置。
- [ ] 用户能在右栏查看 / 编辑当前 profile JSON、`_meta.json`、`developer_settings.json`、`claude_desktop_config.json`。
- [ ] 应用 3P 模式时会备份并写入必要文件，完成后提示需要重启 Claude Desktop。
- [ ] 删除动作需二次确认；确认后默认同时解除 `_meta.json` 注册并删除真实 `<profile-id>.json`。
- [ ] 错误提示不泄漏 API Key、token 或完整 JSON。

## Definition of Done

- 后端提供 Claude Desktop 专用路径解析、文件读取、profile 保存、profile 删除 / 解除注册、3P 应用命令。
- 前端提供 Claude Desktop Workspace 并复用现有配置页三栏体验。
- 完成路径解析单元测试、profile/meta 关系纯函数测试、前端关键纯函数测试。
- 完成 Windows 本机人工核对清单，尤其是 MSIX 物理目录场景。
- 文档和 `progress.csv` 更新完成。

## User Stories

1. 作为 ccMesh 用户，我希望在配置文件页面直接管理 Claude Desktop 网关配置，以便不用手工编辑多个 JSON 文件。
2. 作为 Windows 用户，我希望软件自动找到 Claude Desktop 实际读取的物理配置目录，以便避免写到看似正确但不生效的逻辑路径。
3. 作为需要多个网关渠道的用户，我希望能新增、选择、注册和切换 Claude Desktop profile，以便让 Claude Desktop 使用不同网关配置。
4. 作为谨慎用户，我希望应用前看到将写入哪些文件并自动备份，以便降低误改配置导致 Claude Desktop 不可用的风险。

## Implementation Decisions

1. **入口决策**：新增到现有 `ConfigProfiles` 页面第三个 Tab，不新增全局导航。
2. **后端组织决策**：在 `src-tauri/src/modules/tool_config/claude_desktop.rs` 新增文件接管模块，复用 `tool_config` 的读写工具与命令层模式，但不复用 app data profiles 快照模型。
3. **前端 API 决策**：新建 `src/services/modules/claude_desktop_config.ts`，避免把“文件接管”混进 `toolConfigApi.save/apply` 的快照语义。
4. **Windows 路径决策**：只做 `Get-AppxPackage` 和候选目录探测两种方法；不实现注册表、协议、StartApps、进程路径等所有 fallback。
5. **安全决策**：写盘前备份，错误只报路径和字段，不报完整 JSON。
6. **删除决策**：删除配置文件时默认同时从 `_meta.json` 解除注册，并删除真实 `<profile-id>.json`（二次确认后执行）。仍保留仅解除注册 / 仅删文件的底层命令供扩展。
7. **UI 决策**：右栏单编辑器 + 文件 Tabs，不做四个编辑器并排，避免布局臃肿。
8. **保存决策**：点击「保存配置文件」直接写真实 Claude Desktop 文件（先备份再原子写），不拆「保存草稿 / 应用到真实文件」两步。

## Testing Decisions

- 后端优先测纯逻辑：路径候选排序、meta/profile 关系合并、JSON 保留未知字段、写入前校验。
- Windows `Get-AppxPackage` 需要集成 / 人工核对，单测只覆盖命令输出解析和 fallback 打分。
- 前端优先测纯函数和组件基本渲染，不做低价值 snapshot 测试。

## Out of Scope

- 不实现报告中所有 Windows 路径获取方法。
- 不做 Claude Desktop 运行进程控制，不负责自动关闭或重启 Claude Desktop。
- 不读取或展示敏感配置到任务文档中。
- 不把 Claude Desktop 配置复制为 ccMesh 私有快照仓库作为主流程。
- 不实现 Snap / Flatpak 等 Linux 沙箱特殊路径探测。

## Technical Notes

- Claude Desktop 写入对象很可能包含 token；实现阶段需要对日志做脱敏。
- `_meta.json` 的确切 schema 必须以真实样例为准，计划阶段只定义“保留未知字段 + 最小注册字段”的策略。
- Windows `powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ...` 调用需要超时和失败 fallback。
- 写入多个文件时，不能保证跨文件真正原子；因此要做备份、分步错误报告和可恢复提示。
