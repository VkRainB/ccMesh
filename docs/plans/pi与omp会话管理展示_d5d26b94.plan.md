---
name: pi与omp会话管理展示
overview: "按 ai-toolbox 的路径解析与 JSONL v3 格式，为 ccMesh 新增 pi/omp 两个会话 provider，复现现有 tool_sessions 的扫描/消息/删除链路，含 cwd→slug 编码与会话根 env 覆盖；不改现有 claude/codex/opencode 逻辑。"
todos:
  - id: add-path-resolvers
    content: paths.rs 新增 pi_sessions_dir/omp_sessions_dir（含 PI_CODING_AGENT_DIR / PI_CODING_AGENT_SESSION_DIR env 覆盖），并写单元测试
    status: completed
  - id: add-slug-encoder
    content: paths.rs 新增 encode_cwd_to_slug 编码函数（home 相对 / tmp 相对 / --包裹绝对路径 三情形），并写单元测试
    status: completed
  - id: add-pi-provider
    content: modules/tool_sessions/pi.rs 实现 pi 的 scan_sessions/load_messages/delete_session（head/tail 80 采样、首条 user 作标题），并写单元测试
    status: completed
  - id: add-omp-provider
    content: modules/tool_sessions/omp.rs 实现 omp 的 scan_sessions/load_messages/delete_session（含 title 槽位回退链与 title_change），并写单元测试
    status: completed
  - id: wire-mod-dispatch
    content: tool_sessions/mod.rs 的 load_messages/provider_roots/delete_session_with_roots/scan_sessions 四处注册 pi/omp 分支
    status: completed
  - id: extend-frontend
    content: 前端 ToolSessions 页面 ProviderFilter/ProviderGlyph/getProviderLabel 扩展 pi/omp 与图标
    status: completed
  - id: run-verification
    content: cargo test + pnpm test 全绿，手工核对本机 pi/omp 会话列表与详情
    status: completed
isProject: false
---

# pi 与 omp 本地会话管理展示

## 背景与现状

- 现状：ccMesh 已有「工具会话」模块 [`src-tauri/src/modules/tool_sessions/mod.rs`](src-tauri/src/modules/tool_sessions/mod.rs)，聚合 `codex` / `claude` / `opencode` 三 provider（`mod.rs:58-82` 用 `std::thread::scope` 并发扫描，按 `last_active_at` 倒序合并），前端 [`src/pages/ToolSessions/index.tsx`](src/pages/ToolSessions/index.tsx) 提供列表/详情/搜索/批量删除。删除链路带路径安全校验：`provider_roots` → `canonicalize` → `starts_with` 越界拒绝（`mod.rs:119-186`）。
- 缺口：pi（earendil-works/pi）与 omp（oh-my-pi）本机会话**不在 provider 集合内**。`grep -i "pi|omp"` 于 `modules/tool_sessions` 与 `pages/ToolSessions` 无命中（调研证据：`CcmeshSessionArch` 报告 §7.1）。用户想在这两个 AI CLI 上获得与 Claude/Codex 相同的会话管理体验。
- 关键事实（本机实测 + 参考实现）：
  - pi/omp 同源（omp 由 pi-mono fork，`omp://porting-from-pi-mono.md`），**会话 JSONL 格式互通**：`~/.pi/agent/sessions/<slug>/<ISO时间戳>_<sessionId>.jsonl` 与 `~/.omp/agent/sessions/<slug>/...`（实测 `C:\Users\Administrator\.{pi,omp}\agent\sessions\--E--myCode-tauri-gateway--\2026-09-10T06-54-14-643Z_01a08a18-....jsonl`）。
  - JSONL version=3：首行 `{"type":"session","version":3,"id","timestamp","cwd"}`（omp 额外有固定 256B `type:"title"` 槽 + `title_change` 追加条目）；之后 `message` 树条目带 `id`/`parentId`（8 位 hex），`message.role ∈ {user,assistant,toolResult,...}`，`content[]` part 类型 `text|thinking|toolCall|image`（实测文件头 8 行 + 类型分布统计：`message` 为主，`toolCall`/`thinking`/`image` 均出现）。
  - **slug 编码规则**（`omp://session.md`「On-Disk Layout」原文）：home 下 → `-<相对路径>`；temp 根下 → `-tmp-<相对>`；其它（含 Windows 盘符绝对路径）→ `--<编码绝对路径>--`，分隔符与 `:` 均替换为 `-`。实测 `E:\myCode\tauri-gateway` → `--E--myCode-tauri-gateway--` 与实测目录名一致。
  - **环境变量覆盖**（`omp://environment-variables.md` §6）：`PI_CONFIG_DIR` 改名、`PI_CODING_AGENT_DIR` 整体迁移、`PI_CODING_AGENT_SESSION_DIR` 仅改会话目录；`XDG_*` 仅在目标 root 已存在时于 macOS/Linux 生效。Windows 强绑定 `%USERPROFILE%`。
  - **参考实现**：ai-toolbox [`tauri/src/coding/session_manager/pi.rs`](https://github.com/Rainbow-atom/ai-toolbox)（与 `oh_my_pi.rs` 同构）用 `read_head_tail_lines(80,80)` 采样列表元数据、全文逐行解析详情；标题取首条 user 消息转义后截 80 字符；路径根解析顺序 DB→env→默认。
  - ccMesh 已有可复用件：路径工具 [`src-tauri/src/utils/paths.rs`](src-tauri/src/utils/paths.rs) 的 `home_dir()`（`USERPROFILE` 优先，`paths.rs:30-36`）、`pi_agent_dir()`/`omp_agent_dir()`（`paths.rs:52-57/67-69`）；JSONL 工具 [`modules/tool_sessions/utils.rs`](src-tauri/src/modules/tool_sessions/utils.rs) 的 `read_head_tail_lines`（<16KB 全读否则 head+尾部 seek，`utils.rs:8-49`）、`parse_timestamp_to_ms`、`extract_text`、`truncate_summary`。**但 `sessions/` 子目录与 slug 编码均未实现**（`CcmeshSessionArch` 报告 §7.3「缺口」）。

## 目标

- 在「会话管理」页的 provider 筛选与分组中新增 **pi** 与 **omp**，列表展示标题/项目目录/最后活跃时间，可打开详情查看消息记录，可搜索、可单选/多选删除。
- pi/omp 会话与现有三 provider 共用同一套 `SessionMeta`/`SessionMessage`/删除安全框架，**不新建第二套抽象**（对齐 `codex.rs` 的 JSONL 模式）。
- 列表性能可控：scan 只读每个文件 head 80 / tail 80 行（复用 `read_head_tail_lines`），不全文加载；详情按需全文解析。
- 平台覆盖：Windows / macOS / Linux 均定位 `~/.{pi,omp}/agent/sessions`；支持 `PI_CODING_AGENT_DIR`、`PI_CODING_AGENT_SESSION_DIR` env 覆盖（对齐 ai-toolbox）；XDG 重定向本轮不做（见「不改」）。
- 已确认决策：删除 pi/omp 会话时连带删除同名伴生目录（omp 的 `<ts>_<id>/` bash log 目录），对齐 `claude.rs` 删 sidecar 的模式；`resume_command` 按 ai-toolbox 的 `pi --session <path>` / `omp --session <path>` 生成（`[依据 ai-toolbox pi.rs:182-187，未在本机验证 flag]`）。

## 数据流

```mermaid
flowchart LR
  A[ToolSessions 页面] --> B[toolSessionsApi.list]
  B --> C[list_tool_sessions]
  C --> D[scan_sessions 并发]
  D --> D1[codex::scan]
  D --> D2[claude::scan]
  D --> D3[opencode::scan]
  D --> D4[pi::scan_sessions]
  D --> D5[omp::scan_sessions]
  D1 & D2 & D3 & D4 & D5 --> E[按 last_active_at 排序合并]
  E --> F[SessionMeta 列表]
  A --> G[toolSessionsApi.getMessages]
  G --> H[get_tool_session_messages provider_id=pi/omp]
  H --> I["read_head_tail_lines 定位 session id (scan 已得)"]
  I --> J[load_messages 全文逐行解析 message 条目]
  J --> K[SessionMessage[] 渲染]
  A --> L[delete_tool_sessions]
  L --> M[delete_session_with_roots 路径校验]
  M --> N[pi/omp::delete_session 删 jsonl + 伴生目录]
```

## 方案 / 改动

### 1. 会话根解析 — [`src-tauri/src/utils/paths.rs`](src-tauri/src/utils/paths.rs)

- 新增 `pi_sessions_dir()` / `omp_sessions_dir()`：
  - 先读 `PI_CODING_AGENT_SESSION_DIR`（pi 与 omp 共用同一键，`omp://environment-variables.md` §6）→ 非空且为绝对路径则直接用；
  - 否则 `<agent_dir>/sessions`，其中 agent_dir 尊重 `PI_CODING_AGENT_DIR`（ai-toolbox `runtime_location.rs:1970-1988,1989-2007` 的 env→默认链）；
  - 兜底现有 `pi_agent_dir()`/`omp_agent_dir()` 已返回的 `~/.{pi,omp}/agent` 再 `.join("sessions")`。
- 新增 `encode_cwd_to_slug(cwd, home, tmp) -> String`：按 `omp://session.md` 三情形实现——`cwd` 以 `home` 为前缀 → `-<相对>（分隔符→-）`；以 temp 根为前缀 → `-tmp-<相对>`；否则 `--<绝对编码>--`。编码时把 `\`、`/`、`:` 全部替换为 `-`；中文与空格原样保留（实测 `--D--下载-新建文件夹 (5)--`）。
- 新增 `session_roots(provider)` 不必要——provider 各自的 `session_roots()` 返回这两个新函数的值即可（供删除校验用）。
- 单元测试：Windows 盘符路径（`E:\myCode\tauri-gateway` → `--E--myCode-tauri-gateway--`）、home 相对、temp 相对、中文/空格保留、env 覆盖优先。

### 2. pi provider — [`src-tauri/src/modules/tool_sessions/pi.rs`](src-tauri/src/modules/tool_sessions/pi.rs)（新建）

- `PROVIDER_ID = "pi"`；`session_roots() -> Vec<PathBuf>` 返回 `paths::pi_sessions_dir()`。
- `scan_sessions()`：递归收集 `*.jsonl`（复用 `codex.rs` 的 `collect_jsonl_files` 模式，可提升为 utils 共享）；每个文件 `read_head_tail_lines(path, 80, 80)`：
  - head 中找 `type=="session"` 条目取 `id` / `cwd`（→`project_dir`）/ `timestamp`（→`created_at`）；`type=="message"` 且 `role=="user"` 的首条 text part 作标题（`extract_text` + `truncate_summary(80)`）；
  - tail 中最后一个非 `session` 条目的时间戳作 `last_active_at`；
  - 文件名兜底：从 `<ISO时间戳>_<uuid>.jsonl` 中取 uuid 作 `session_id`（对齐 pi.rs:22-25）。
- `load_messages(path)`：`read_to_string` + 逐行 `serde_json`，仅取 `type=="message"` 条目；`role` 映射 `user/assistant/toolResult→tool`（对齐现有 `SessionMessage` 的 4 角色）；`content[]` 按 part 类型拼接——`text` 原文、`toolCall` → `[Tool: <name>]`（对齐 codex.rs 的 function_call 呈现）、`thinking` 跳过（不混入正文）、`image` → `[图片]`；`ts` 取 `message.timestamp`（ms 数字）经 `parse_timestamp_to_ms`。
- `delete_session(root, source_path, session_id)`：校验文件内 session id 与入参一致（对齐 codex.rs:329-347 的 mismatch 拒绝），删除 jsonl 与其同名伴生目录（`with_extension("")`，存在才删，对齐 claude.rs 删 sidecar）。
- 单元测试：内嵌最小 version=3 样本（session 头 + user text + assistant text/toolCall + thinking/toolResult），断言标题回退、角色映射、伴生目录删除、id mismatch 拒绝。

### 3. omp provider — [`src-tauri/src/modules/tool_sessions/omp.rs`](src-tauri/src/modules/tool_sessions/omp.rs)（新建）

- `PROVIDER_ID = "omp"`，结构同 pi.rs，差异仅在标题来源（`omp://session.md` + 实测 `2026-09-10T06-54-14-643Z_01a08a18-....jsonl` 首行）：
  - 回退链：`type:"title"` 槽的 `title`（首行）→ `type:"session"` 头的 `title` 字段 → 首条 user 消息（截 80）。`title_change` 条目（tail 中最后一条 `source=="user"`）优先于 title 槽（用户重命名/自动标题演进）。
  - 注意 `title` 槽 `pad` 到 256B，解析时必须忽略 padding 只取 `title` 字段（`serde_json` 天然忽略多余字段）。
- `delete_session` 同 pi（omp 伴生目录 `<ts>_<id>/` 实测存在 bash log）。
- 单元测试：title 槽优先、title_change 覆盖槽、session 头 title 兜底、首条 user 兜底、pad 行解析不炸。

### 4. 注册分发 — [`src-tauri/src/modules/tool_sessions/mod.rs`](src-tauri/src/modules/tool_sessions/mod.rs)

- `mod pi; mod omp;`
- `scan_sessions()`（`mod.rs:58-82`）：`thread::scope` 增两个 spawn，5 provider 并发。
- `load_messages()`（`mod.rs:84-94`）：match 增 `"pi"` / `"omp"` 分支 → `pi::load_messages(path)` / `omp::load_messages(path)`。
- `delete_session_with_roots`（`mod.rs:131-161`）与 `provider_roots`（`mod.rs:163-174`）：match 增 `"pi" => vec![pi::session_roots()]` / `"omp" => vec![omp::session_roots()]` 对应分支，删除校验自动生效。
- `map_session_err`（`commands/tool_sessions.rs:6-20`）已按关键字映射，`pi`/`omp` 报错文案含 `not found`/`outside provider roots` 即可复用，无需改。

### 5. 前端扩展 — [`src/pages/ToolSessions/_components/utils.ts`](src/pages/ToolSessions/_components/utils.ts) 与 [`src/pages/ToolSessions/index.tsx`](src/pages/ToolSessions/index.tsx)

- `ProviderFilter` 联合（`index.tsx:55`）加 `"pi" | "omp"`；筛选 Select options（`index.tsx ~530-534`）加两项。
- `ProviderGlyph`/`ProviderIcon`（`SessionItem.tsx`、`index.tsx:65-69`）加 pi/omp 图标；`getProviderLabel`（`utils.ts`）与 `getSessionKey` 分组逻辑自动覆盖（按 `providerId` 分组，无需改映射）。
- 复用现有搜索（`matchesSessionSearch` 已扫 `title/projectDir/sourcePath/sessionId`）与删除 mutations，无需新 IPC。
- 前端单测 `utils.test.ts` 补 `getProviderLabel('pi'/'omp')` 断言。

## 文件清单

- 新建：[`src-tauri/src/modules/tool_sessions/pi.rs`](src-tauri/src/modules/tool_sessions/pi.rs)
- 新建：[`src-tauri/src/modules/tool_sessions/omp.rs`](src-tauri/src/modules/tool_sessions/omp.rs)
- 修改：[`src-tauri/src/utils/paths.rs`](src-tauri/src/utils/paths.rs)
- 修改：[`src-tauri/src/modules/tool_sessions/mod.rs`](src-tauri/src/modules/tool_sessions/mod.rs)
- 修改：[`src/pages/ToolSessions/index.tsx`](src/pages/ToolSessions/index.tsx)
- 修改：[`src/pages/ToolSessions/_components/SessionItem.tsx`](src/pages/ToolSessions/_components/SessionItem.tsx)
- 修改：[`src/pages/ToolSessions/_components/utils.ts`](src/pages/ToolSessions/_components/utils.ts)
- 修改：[`src/pages/ToolSessions/_components/utils.test.ts`](src/pages/ToolSessions/_components/utils.test.ts)
- 不新增 Tauri 命令（复用 `list_tool_sessions` / `get_tool_session_messages` / `delete_tool_session(s)`）；不新增 `commands/tool_sessions.rs` 文件改动。

## 不改 / 明确不做

- 不改现有 `codex.rs` / `claude.rs` / `opencode.rs` 的扫描/解析/删除逻辑（回归风险面最小化）。
- 不做 `history.db` / `session_titles` 读取（omp 的 FTS 提示历史库；会话标题已可从 jsonl 获取，DB 读取留作搜索增强的后续项——ai-toolbox 也采用纯 JSONL 方案，见 `OmpSessionResearch` §2）。
- 不做 XDG 重定向检测：`XDG_DATA_HOME` 等仅当 pi/omp root 已存在时生效且 Windows 不适用；本轮只认 `PI_CODING_AGENT_DIR` / `PI_CODING_AGENT_SESSION_DIR` env（对齐 ai-toolbox `runtime_location.rs` 的核心链）。在 macOS/Linux 手工 `omp config init-xdg` 的用户暂扫不到，**记入风险**。
- 不做 pi/omp 会话编辑/重命名（title 槽写入涉及 256B 定长覆写与原子性，ccMesh 现有页面无 rename 能力，YAGNI）。
- 不做 token 用量聚合进列表（`SessionMeta` 无该字段；用量统计属 `cursor_usage` 模块范围，非本次目标）。
- 不动 `tool_env.rs` 的 `VALID_TOOLS`（那是 CLI 安装/探测，与会话读取无关）；不动 `src/services/request.ts` / `toolSessions.ts` 服务层（IPC 面不变）。

## 风险与注意

- **会话文件大**（实测单文件最大 6.3MB）：scan 务必走 `read_head_tail_lines` 采样；load_messages 全文解析只发生在用户点开详情后。列表首屏若上千会话，后续可加后端分页/虚拟滚动（现前端无虚拟滚动，见 `CcmeshSessionArch` §5.4）。
- **格式演化**：`version` 字段现在为 3，omp 文档说明有历史版本迁移。解析器对未知 `type` 与缺失字段要静默跳过（对齐 `opencode.rs` 的宽容解析），不因单文件坏行全盘失败。
- **删除不可逆**：删除真实用户会话文件，`delete_session_with_roots` 的 canonicalize + starts_with 校验必须在 `PI_CODING_AGENT_*` env 指向新根时依然成立（root 与 source 同一来源解析），并保留前端删除确认 Dialog（已存在）。
- **`resume_command` 未在本机验证**：`pi --session <path>` 为 ai-toolbox 实现推断，需在手工验证步骤用真实 pi/omp 实例确认 flag 语义，不符则修正命令模板。
- **并发写**：pi/omp 在运行时可能正写会话文件；`read_to_string`/`read_head_tail_lines` 在 Windows 上可能因文件占用失败——单文件解析失败静默跳过进列表，详情加载报错文案给「会话文件可能被占用」。

## 验证

- 自动化：
  - `cd src-tauri && cargo test tool_sessions`（或 `cargo test -p ccmesh tool_sessions`，按 Cargo.toml 包名）——必须覆盖：`paths` 的 slug 编码三情形 + env 覆盖、`pi.rs`/`omp.rs` 的内嵌样本解析与标题回退链、`mod.rs` 的删除越界拒绝与批删归集（现有测试仍须全绿）。
  - `pnpm test` ——`utils.test.ts` 新增 pi/omp label 断言通过，既有用例不回归。
  - `pnpm check:rust` / `pnpm check:front`（README 声明的检查命令）。
- 手工：
  1. 打开「会话管理」（Chat 页 History 按钮），筛选下拉出现 pi / omp；本机 `C:\Users\Administrator\.pi\agent\sessions` 与 `.omp\agent\sessions` 下会话按最后活跃时间倒序出现在列表，标题/项目目录正确（omp 应显示 title 槽标题，pi 显示首条用户消息）。
  2. 点开 `--E--myCode-tauri-gateway--`（或本机任一项目）会话详情：消息按时间顺序渲染，toolCall 显示为 `[Tool: name]`，thinking 不混入正文，图片显示占位。
  3. 搜索会话 id / 标题片段命中；多选删除一个 pi 与一个 omp 会话，确认 jsonl 与同名伴生目录（omp bash log 目录）均消失，弹窗确认文案正常。
  4. 设置 `PI_CODING_AGENT_SESSION_DIR` 指向临时目录并放入一个构造的 jsonl 样本，重新扫描确认该目录被识别（验证 env 覆盖链路）。
  5. 若本机装有可运行的 pi/omp：点击详情里的 `resume_command` 复制，在终端执行确认能恢复会话（验证命令模板），不符则按风险节修正。

> 本计划的格式与落盘依据 oi-plant 技能（`docs/plans` 目录、四键 frontmatter、验证段收尾）。实现完成前 todos 状态保持 `pending`/`in_progress`，全部通过验证后逐个置 `completed`。