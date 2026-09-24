# OMP (Oh My Pi) 会话存储与用量统计设计

> 调研基线：omp 仓库 `E:\myCode\oh-my-pi`（版本 17.2.x，`USER_AGENT = omp/17.2.12`）。
> 本文先定位 omp 会话/统计数据的落盘位置（Linux/macOS/Windows 三平台），再给出 token 用量（输入、输出、缓存、成本）的计算口径，最后给出 tauri-gateway 接入设计。
> 结论均来自 omp 源码与文档标注 `文件:行号`，并已在本机 Windows 验证。

---

## 1. 背景与现状

tauri-gateway 已有统一用量表 `usage_records`（`app_type` 区分来源），目前接入 Claude Code / Codex / ZCode：

- 解析层：`src-tauri/src/modules/usage_local/{claude,codex,zcode}.rs`
- 表结构：`src-tauri/src/modules/storage/migration.rs:91-110`（v4 建 `usage_records`，v17 加 `ts` 毫秒列）
- 前端：`src/pages/Statistics/_components/UsagePanel.tsx` 的 `APP_TABS`

目标：新增 `app_type = "omp"`，从 omp 的本机数据读取每次模型请求的输入 / 输出 / 缓存读 / 缓存写 token，与现有三平台同表汇总。

## 2. omp 会话与统计数据的存放位置

### 2.1 目录基准（三平台）

路径解析核心在 [`packages/utils/src/dirs.ts`](../../..\myCode\oh-my-pi\packages\utils\src\dirs.ts)：

| 变量/规则 | 值 |
|---|---|
| 配置根 `getConfigRootDir()` | `<home>/.omp`（`dirs.ts:493-496`；`PI_CONFIG_DIR` 可改根名，`dirs.ts:474-477`） |
| agent 目录 `getAgentDir()` | `<configRoot>/agent`；profile 模式为 `<configRoot>/profiles/<name>/agent`（`OMP_PROFILE`/`PI_PROFILE`，`dirs.ts:61-90`） |
| agent 目录覆盖 | `PI_CODING_AGENT_DIR` 环境变量 = **完整 agent 目录**（会话在 `$PI_CODING_AGENT_DIR/sessions`，不再拼 `agent/`）；仅默认 profile 生效，设置后同时关闭 XDG 分支（`dirs.ts:328-386`，`docs/environment-variables.md:518`） |
| 会话目录启动覆盖 | `PI_CODING_AGENT_SESSION_DIR`：仅启动参数解析时的初始会话目录，写到别处的会话 omp stats 自身也不扫（`docs/environment-variables.md:519`） |
| XDG 迁移（Linux/macOS） | 设置了 `XDG_DATA_HOME`/`XDG_STATE_HOME`/`XDG_CACHE_HOME` **且** `$XDG_*_HOME/omp` 目录已存在时，对应类别路径改指 `$XDG_*_HOME/omp/...`，且 agent/ 前缀被摊平（`dirs.ts:302-348`，需先跑 `omp config init-xdg`） |

`<home>` = `os.homedir()`：Windows 取 `%USERPROFILE%`，Linux/macOS 取 `$HOME`。**三平台目录名相同（`.omp`），无平台分支**。

### 2.2 会话文件位置

来源：[`docs/session.md`](../../..\myCode\oh-my-pi\docs\session.md) 与 [`packages/coding-agent/src/session/session-paths.ts`](../../..\myCode\oh-my-pi\packages\coding-agent\src\session\session-paths.ts)。

```text
~/.omp/agent/sessions/<encoded-cwd>/<ISO时间戳>_<sessionId>.jsonl
```

`getSessionsDir()` = `~/.omp/agent/sessions`（`dirs.ts:884-887`，XDG 下为 `$XDG_DATA_HOME/omp/sessions`）。

**`<encoded-cwd>` 编码规则**（canonical cwd，symlink 归一）：

| cwd 位置 | 目录名 | 示例 |
|---|---|---|
| home 之下 | `-<相对路径>`（分隔符→`-`） | `/home/u/work/pi` → `-work-pi` |
| 系统临时根之下 | `-tmp-<相对路径>` | `/tmp/foo` → `-tmp-foo` |
| 其他绝对路径 | `--<编码后的绝对路径>--` | `C:\tmp` → `--C--tmp--` |

本机（Windows）实际验证：

```text
C:\Users\Administrator\.omp\agent\sessions\--C--tmp--\2026-09-21T01-11-27-832Z_01a0c184-....jsonl
C:\Users\Administrator\.omp\agent\sessions\--D--Program Files (x86)-finch-resources--\...
```

补充要点：

- 历史 hashed 目录名方案（17.2.5–17.2.8 引入、17.2.9 回退）会在访问时 best-effort 迁回路径编码名 → 解析器需**兼容两种目录名**（`session-paths.ts` 的 `migrateHashedSessionDir`）。
- 子代理 transcript 深一层：`<project>/<sessionId>/<id>.jsonl`；advisor 为 `__advisor.jsonl` / `__advisor.<slug>.jsonl`（`packages/stats/src/parser.ts:17,39-55`）。
- 附属位置：blob 库 `~/.omp/agent/blobs/<sha256>`；终端面包屑 `~/.omp/agent/terminal-sessions/<terminal-id>`。

### 2.3 用量统计存储位置（omp 自建）

omp 自带 stats 模块（`omp stats` / `@oh-my-pi/omp-stats`）维护一个派生 SQLite 库：

```text
~/.omp/stats.db          （getStatsDbPath，dirs.ts:811-814；XDG: $XDG_DATA_HOME/omp/stats.db）
```

本机验证存在：`C:\Users\Administrator\.omp\stats.db`（约 10MB，WAL：`stats.db-shm`/`stats.db-wal`）。

| 表 | 作用 | 关键列 |
|---|---|---|
| `messages` | **每行一次模型请求**（对话 + 非对话 `model_usage`） | `session_file, entry_id, folder, model, provider, api, timestamp, duration, ttft, stop_reason, error_message, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_tokens, premium_requests, cost_input, cost_output, cost_cache_read, cost_cache_write, cost_total, cost_no_cache_input, cost_unpriced, agent_type`，`UNIQUE(session_file, entry_id)`（`packages/stats/src/db.ts:184-212`） |
| `file_offsets` | 增量断点 | `session_file PK, offset, last_modified, parser_state`（dev/ino/birthtime 指纹 + 字节偏移，`db.ts:214-218`） |
| `tool_calls` | 工具调用明细 | `UNIQUE(session_file, tool_call_id)` |
| `user_messages` | 用户消息行为指标 | chars/words/yelling 等 |
| `meta` | backfill 哨兵 | `key/value` |

另一处：`~/.omp/agent/agent.db` 的 `usage_history` 表，存**订阅窗口利用率快照**（provider/account/used_fraction，每次拉取 provider 用量时追加一行），供订阅窗口分析用（`packages/stats/src/usage-windows.ts:39-87`）。

## 3. 会话 JSONL 格式与 usage 字段

### 3.1 文件结构

JSONL，首行是 256 字节定宽 title 槽（`{"type":"title",...}`，pad 补齐），随后 session header（`type:"session", version:3`）+ 追加式条目。本机样例（截取）：

```jsonl
{"type":"title","v":1,"title":"我先列出计划…","source":"auto","updatedAt":"...","pad":"..."}
{"type":"session","version":3,"id":"01a040ad-...","timestamp":"2026-08-27T00:44:52.410Z","cwd":"C:\\Program Files\\Docker\\Docker","title":"...","titleSource":"auto"}
{"type":"model_change","id":"347eced2","parentId":null,"timestamp":"...","model":"remote-gpt/gpt-5.6-sol",...}
{"type":"message","id":"0739ef42","parentId":"2ca0596f","timestamp":"2026-08-27T00:46:04.599Z","message":{"role":"user","content":[{"type":"text","text":"…"}],"timestamp":1787791562698}}
```

计量相关条目两类（`packages/coding-agent/src/session/session-entries.ts:71-91`）：

1. `type:"message"` 且 `message.role == "assistant"`：携带 `usage`、`provider`、`model`、`api`、`duration`、`ttft`、`stopReason`、`errorMessage`；`message.timestamp` 为 epoch ms，条目信封 `timestamp` 为 RFC3339。
2. `type:"model_usage"`：**不进对话转录的模型调用**（标题生成、judge 等），字段 `purpose/role/api/provider/model/usage/stopReason`，无 `message` 包装。由 `session-manager.ts` `appendModelUsage()`（2810-2841 行）写入。

真实 usage 样例（本机提取）：

```json
"usage":{"input":23170,"output":536,"cacheRead":0,"cacheWrite":0,"totalTokens":23706,
         "reasoningTokens":279,
         "cost":{"input":0.0032438,"output":0.00015008,"cacheRead":0,"cacheWrite":0,"total":0.00339388}}
"usage":{"input":779,"output":271,"cacheRead":23040,"cacheWrite":0,"totalTokens":24090, ...}
```

### 3.2 `Usage` 字段语义（计费口径的根基）

定义：`packages/catalog/src/types.ts:143-211`。

| 字段 | 语义 |
|---|---|
| `input` | **非缓存**对话输入 token（provider 计费口径的新输入桶） |
| `output` | 输出总量，**含** thinking/assistant 文本/工具调用参数 token |
| `cacheRead` | 从 prompt cache 读取的 token |
| `cacheWrite` | 写入 prompt cache（缓存创建）的 token |
| `totalTokens` | `input+output+cacheRead+cacheWrite+orchestration.*`；provider 报告的有限值**优先**（`parser.ts resolveUsageTotal:186-202`） |
| `orchestration` | provider 侧编排 token `{input, cacheRead, output}`：计费但不属于对话 prompt/cache 桶（如 multi-agent Grok） |
| `reasoningTokens` | output 的子集（思考 token），未知为 undefined ≠ 0 |
| `cttl` | Anthropic 缓存写 TTL 拆分 `{ephemeral5m, ephemeral1h}`，分量之和 = cacheWrite |
| `premiumRequests` | Copilot premium / priority 请求权重 |
| `cost` | **写会话时已按费率算好的成本** `{input,output,cacheRead,cacheWrite,total}` |

### 3.3 token 总量推导规则（容错）

`resolveUsageTotal()`（`packages/stats/src/parser.ts:186-202`）：

```text
provider 报告的 totalTokens 为有限数字 → 直接采用
否则 totalTokens = input + output + cacheRead + cacheWrite
                 + orchestration.input + orchestration.output + orchestration.cacheRead
非法值（字符串/NaN/Infinity）一律按 0，绝不参与字符串拼接
```

## 4. omp 用量统计的计算方式（omp stats 口径）

以下为 `@oh-my-pi/omp-stats` 从会话 JSONL 到 stats.db 的完整规则，是 tauri-gateway 统计口径的参照系。

### 4.1 采集范围（parser.ts）

- 收集 `message`（assistant）与 `model_usage` 条目；**跳过**：无 `id` 的 legacy 行、缺 `model/provider/api/usage` 的行。
- token 计数必须 `Number.isFinite`，否则按 0（`finiteTokenCount`）。
- 缺 `stopReason` 时：有 `errorMessage` → `"error"`，否则 `"aborted"`。
- 时间戳：`message.timestamp`（epoch ms，>0）优先，回退条目信封 RFC3339，再回退 0（哨兵"无时间戳"）。
- premiumRequests：已有非零值信任之；否则由 service tier + provider 推导（priority 实际生效且计费 → 1）。

### 4.2 去重规则（db.ts `insertMessageStats`，866-941 行）

| 场景 | 规则 |
|---|---|
| 同文件重复同步 | `UNIQUE(session_file, entry_id)` upsert：token 不变，`premium_requests` 取 max，`cost_*` 用新值覆盖（修复历史计价） |
| 跨文件 fork/branch | fork 会深拷贝父会话条目（同 entry_id/timestamp/token）。插入前 `WHERE NOT EXISTS (entry_id=? AND timestamp=? AND session_file<>?)`，**first-write-wins**，同一 provider 请求只计一次 |

### 4.3 成本计算（三层决策 + 费率规则）

`resolveStoredCost()`（`db.ts:477-514`）：

```text
1. 会话内记录的 usage.cost 存在且 total 有限非 0（或 timeBased 卡） → 直接采用（冻结价）
2. 无请求时间戳 且 catalog 是 timeBased 卡 → cost=0 且 cost_unpriced=1（零=未知花费，非免费）
3. 否则按公开费率 calculateCatalogCost() 估算；catalog 无卡（订阅制如 xai-oauth）→ cost=0
```

费率计算 `calculateUsageCost()`（`packages/catalog/src/models.ts:138-155`）：

```text
promptInputTokens = input + cacheRead + cacheWrite + orchestration.input + orchestration.cacheRead
multiplier = timeBased 峰时 1.0 / 谷时 offPeakMultiplier（UTC 周 schedule）
cost.input      = rate.input/1e6      × (input + orch.input)      × multiplier
cost.output     = rate.output/1e6     × (output + orch.output)    × multiplier
cost.cacheRead  = rate.cacheRead/1e6  × (cacheRead + orch.cacheRead) × multiplier
cost.cacheWrite = 5m 速率 × (ephemeral5m + 残差) + (rate.input×2)/1e6 × ephemeral1h   ← cttl 拆分
cost.total      = 四项之和
```

- 长上下文阶梯：`promptInputTokens` 超过 `longContext.inputThreshold` 换用长上下文费率（`resolveTokenCost`）。
- `cost_no_cache_input`：同样 token 全按未缓存 input 单价（`calculateUncachedInputCost`）→ 缓存节省的分母。
- "未计价"判定 SQL（`unpricedRequestSql`）：`total_tokens>0 AND cost_total=0 AND (provider='xai-oauth' OR cost_unpriced=1)`。

### 4.4 聚合公式（`buildAggregatedStats` / `getOverallStats`，`db.ts:943-1010`）

| 指标 | 公式 |
|---|---|
| 请求数 | `COUNT(*)`（assistant message + model_usage 每行一次） |
| 错误率 | `SUM(stop_reason='error') / COUNT(*)` |
| 输入 token | `SUM(input_tokens)`（非缓存口径） |
| 输出 token | `SUM(output_tokens)`（含 reasoning） |
| 缓存读 | `SUM(cache_read_tokens)` |
| 缓存写 | `SUM(cache_write_tokens)` |
| **缓存命中率** | `cacheRead / (input + cacheRead)`（>0 才算） |
| **缓存节省率** | `(noCacheInputCost − cachedPromptCost) / noCacheInputCost`；`cachedPromptCost = cost_input+cost_cache_read+cost_cache_write`（仅当 noCache>0 时计入该行） |
| tokens/s | `AVG(CASE WHEN duration>0 THEN output_tokens*1000.0/duration END)`（按请求算再平均） |
| API 等价花费 | `SUM(cost_total)`；未计价请求数单独上报，不计入金额 |

### 4.5 增量同步（aggregator.ts + sync-worker.ts）

- `file_offsets` 记录每文件**字节偏移** + mtime + parser_state（dev/ino/birthtimeMs 指纹，`matchesSessionFile`），只解析尾部新增字节。
- 解析在 worker 线程执行（纯 I/O+CPU），主线程持有 SQLite 句柄；跨进程用文件锁序列化（`withStatsSyncLock`，60min 重试窗口）。
- schema/口径升级通过 `meta` 哨兵触发 backfill：清空 `file_offsets` 强制全量重解析，靠 upsert 幂等回填。

## 5. tauri-gateway 接入设计

### 5.1 数据源决策：读原始 JSONL，不读 stats.db

| 方案 | 取舍 |
|---|---|
| **A. 读 `~/.omp/agent/sessions/**/*.jsonl`（选定）** | source of truth；与 claude.rs 的 JSONL 解析模式同构；不依赖用户是否跑过 `omp stats`；stats.db 是 omp 私有派生库，列随版本演进（backfill 频繁） |
| B. 读 `~/.omp/stats.db` | 省解析，但 schema 变动频繁（agent_type/cost_unpriced 等列后加）、依赖 omp 自己同步过、且无法区分对话/辅助调用语义演进 |

### 5.2 新增 `src-tauri/src/modules/usage_local/omp.rs`

复用 `sync_file`（mtime 增量）+ `insert_record`（upsert 去重）框架，与 claude.rs 同模式（`parse_file` 负责打开文件，纯函数 `parse_lines` 负责解析，便于单测）。zcode 读的是 SQLite，不走 `sync_file`，不能作为模板。核心映射：

| `UsageRecord` 字段 | 来源 | 说明 |
|---|---|---|
| `app_type` | `"omp"` | |
| `record_key` | `omp:<entry_id>:<ts_ms>` | **跨文件 fork 去重**：与 omp `first-write-wins` 口径一致——同 (entry_id, timestamp) 在父子 fork 文件中重复出现时只计一次；短 id 加时间戳防碰撞。`ts_ms` 取值同下行 `ts`（无时间戳时为 `0`），统一用毫秒整数，避免 assistant 行与 model_usage 行一个用 ms、一个用 RFC3339 字符串 |
| `ts` | 对齐 omp `coerceEntryTimestamp`（`parser.ts:327`）：`message.timestamp`（ms，>0）→ 条目信封 RFC3339 经 `ts_millis()` → `None`。model_usage 行没有 `message`，直接取信封 | 复用 `mod.rs` 的 `ts_millis()` |
| `date` | 本地 `YYYY-MM-DD`；`ts` 为 `None` 时写 `"unknown"` | 输入是毫秒，`local_date()` 只收 RFC3339 → 把 `zcode.rs` 私有的 `local_date_from_ms` 挪到 `mod.rs` 设为 `pub(crate)`，两处共用 |
| `model` | `message.model`（model_usage 行取顶层 `model`） | 裸 model id，与 claude.rs 口径一致；provider 不单独存（UsageRecord 无此列） |
| `requests` | `1` | |
| `input_tokens` | `usage.input (+ orchestration.input)` | omp 的 `input` **已是净输入**（不含 cache），直接用，**不要**像 zcode 那样套 `net_input` 扣减；orchestration 是计费输入的组成部分 |
| `output_tokens` | `usage.output (+ orchestration.output)` | 含 reasoning，不拆（与 claude 口径一致） |
| `cache_creation_tokens` | `usage.cacheWrite` | |
| `cache_read_tokens` | `usage.cacheRead (+ orchestration.cacheRead)` | |

采集规则（对齐 §4.1，做简化裁剪）：

1. 逐行读取，先做字符串预过滤 `line.contains("\"usage\"")` 再 JSON 解析（仿 claude.rs 的 `contains("\"assistant\"")`：会话里大量是体积大的工具结果/用户消息行，跳过它们可以省掉大部分反序列化开销）；只取 `type=="message"` 且 `message.role=="assistant"` 且有 `usage` 的行，以及 `type=="model_usage"` 的行。
2. token 桶非有限数 → 0；缺 `id`（legacy 行，无法构造 record_key）/`model`/`usage` → 跳过整行。
3. **跳过全 0 token 行**（error/aborted 空转请求），与 claude.rs/zcode.rs 行为一致，保证"请求数"跨 app 语义统一。
4. model_usage 条目（标题/judge 等辅助调用）**计入**：它们真实消耗 token（omp 口径也计入）。可通过 `purpose` 字段留扩展空间，MVP 不区分。

### 5.3 扫描范围与增量

- 扫描根：**复用现有 `paths::omp_sessions_dir()`**（会话浏览 `tool_sessions/omp.rs` 已在用），不在 omp.rs 里重新拼 `home/.omp/agent/sessions`。
  - **前置修正**：`paths::resolve_sessions_dir` 目前把 `PI_CODING_AGENT_DIR` 当成 agent **根**，拼出来的是 `<env>/agent/sessions`；按 omp 源码与文档（§2.1），这个变量是完整的 agent 目录，正确结果应为 `<env>/sessions`。改完要同步 `paths.rs` 的单测 `resolve_sessions_dir_agent_env_relocates_agent_root`；会话浏览也会因此修正。pi 是否同一语义需另查 pi-mono 源码，本期只改 omp 分支。
  - XDG（仅 Linux/macOS，且没设 `PI_CODING_AGENT_DIR` 时）：`$XDG_DATA_HOME/omp` 目录存在时改用 `$XDG_DATA_HOME/omp/sessions`。在 `omp_sessions_dir()` 里加一个分支即可（和 omp `resolveIf` 同样是"目录存在才生效"），不再列为已知缺口。
  - 命名 profile：额外扫描 `~/.omp/profiles/*/agent/sessions`（多一次 `read_dir`；profile 模式不受 `PI_CODING_AGENT_DIR` 影响）。omp stats 只统计当前激活 profile，本项目是全机汇总，所以全扫。
- 递归深度：`collect_jsonl` 的 `max_depth` 把根目录本身算作第 1 层。`<encoded-cwd>/<file>.jsonl` 需要 2 层，子代理/advisor 的 `<encoded-cwd>/<sessionId>/<sub>.jsonl` 需要 3 层（本机 235 个文件：2 层 169 个、3 层 66 个），取 **4** 给子代理再派生子代理留余量。
- 只收 `*.jsonl`：`collect_jsonl` 天然跳过 `.jsonl.gz` 压缩转录和 `.jsonl.*.bak` 备份，与 omp stats parser（`parser.ts:683` 只收 `.jsonl`）一致。
- 增量：复用 `sync_file` + `usage_sync_state`（文件 mtime_ns）。注意这是**整文件重解析**而不是追加字节增量：活跃会话每追加一行 mtime 就变，下次同步整份重读，靠 record_key 幂等保证不重复计数。不解析 `~/.omp/stats.db*`（属 omp 运行中文件，避免锁冲突）。
- 兼容：跳过无法解析的行（title 槽是合法 JSON 行，没有 `"usage"`，会被预过滤掉）。hashed 目录名迁移会改变文件路径，`usage_sync_state` 把它当作新文件整份重解析，record_key 去重后不会多计；旧路径的状态行残留无害。

### 5.4 前端

- `UsagePanel.tsx`：`APP_TABS` 增加 `{ key: "omp", label: "OMP" }`；**`appLabel()` 同步加 `omp → "OMP"`**（否则「全部」视图的明细表里来源列会显示原始值 `omp`）。
- `usage.ts`：`UsageAppFilter` 联合类型加 `"omp"`。
- 后端 `commands/usage.rs` 对 `app_type` 不做白名单，无需改；`models/usage.rs` 中 `app_type` / `record_key` 字段注释补上 omp 取值，`usage_local/mod.rs` 的 `sync_all` 文档注释同步更新。

### 5.5 无需迁移

`usage_records.app_type` 为 TEXT，`idx_usage_records_app` 对 `"omp"` 直接生效；`ts` 列 v17 已建。

## 6. 不改 / 明确不做

- **不改** `usage_records` 表结构；不新增列（premium_requests / cost / orchestration 明细 / agent_type 均不入库——tauri-gateway 的统计维度是 token 四桶 + 请求数，成本估算不在本期范围）。
- **不做**订阅窗口统计（`agent.db usage_history` 的利用率分析），那是 omp 订阅账号维度，与 token 用量统计目标不同。
- **不做** stats.db 的读取兼容（若未来想要 omp 已聚合的成本数据，再单独立项）。
- **不做** `<encoded-cwd>` 反解码成项目路径（`folder` 维度本项目不用）。
- 不实现 cttl/longContext/峰谷费率复算——JSONL 里 `usage.cost` 已是 omp 按当时费率算好的，直接跳过成本列即可，无需复刻 catalog 计价。

## 7. 风险与注意

| 风险 | 触发条件 | 兜底 |
|---|---|---|
| fork 会话重复计数 | 用户频繁 fork/branch 会话 | record_key 用 `entry_id+timestamp` 天然跨文件去重（§5.2） |
| 会话文件被 omp 原子替换/迁移（目录名迁移、resume 重写） | 旧版本目录仍在被访问 | mtime 增量失效时全量重扫 + upsert 幂等；record_key 稳定不重复入库 |
| 巨型会话文件解析慢 | 单文件数十 MB JSONL，且正处于活跃状态（每次同步都整份重读） | 沿用 claude.rs 逐行流式读 + `"usage"` 字符串预过滤（§5.2）；MVP 不做字节级 offset（stats.db 的 offset 方案依赖 parser_state 指纹，复杂度高收益小）。在 omp.rs 用 `ponytail:` 注释标明上限：单次同步耗时与活跃会话文件大小成正比；以后若成为瓶颈，再给 `usage_sync_state` 加 `offset` 列，只读追加部分 |
| `orchestration` 桶 | multi-agent Grok 等订阅模型 | 并入对应桶（§5.2），总 token 与 provider 计费口径一致；普通模型无此字段无影响 |
| 非对话模型调用（model_usage）与 claude 语义差异 | 跨 app 对比请求数时 | omp 的 model_usage 含标题生成等高频小调用，请求数会偏高；文档明示口径，必要时前端按 model 过滤 |
| 会话被 omp 压缩为 `.jsonl.gz` | omp 存储清理（GC）压缩旧会话 | 已导入的行不会被删除，不受影响；只有"导入前就被压缩"的会话会漏计，omp stats 也不读 `.gz`，口径一致 |

## 8. 验证

1. **单元测试**（`omp.rs` 内 `#[cfg(test)]`，仿 zcode.rs）：
   - 用 §3.1 的真实 JSONL 样例行构造输入：断言四桶映射（input 不扣 cache）、`record_key` 格式、model_usage 行取信封时间戳、全 0 行 / 缺 id 行跳过、非有限数归 0。
   - fork 去重跨文件，`parse_lines` 单测覆盖不到：用内存库对两份相同条目调用两次 `insert_record`，断言只有第一次返回 `true`（仿 `usage_repo.rs` 现有测试）。
   - `paths.rs`：改 `resolve_sessions_dir_agent_env_relocates_agent_root` 的断言为 `<env>/sessions`。
2. **集成验证**：`cargo test -p ccmesh`；运行应用后在「统计 → 用量统计」确认 OMP tab 出现，选日期后四卡（请求/输入/输出/缓存）有数，「全部」含 OMP。
3. **对账抽查**：取一个真实会话文件，手工 `SUM` 其中 assistant 行的 `usage.input` 等，与导入后 `SELECT SUM(input_tokens) FROM usage_records WHERE record_key LIKE 'omp:%' AND record_key IN (该文件条目)` 对比一致；再与 `omp stats --json` 的同窗口 token 总量做数量级核对（不要求相等：omp 含未同步文件与订阅特例）。
4. **跨平台路径**：三平台默认路径都走 `paths::omp_sessions_dir()`；`PI_CODING_AGENT_DIR` / XDG / profile 三种重定向按 §5.3 覆盖。`resolve_sessions_dir` 是纯函数，XDG 分支同样以参数注入的方式写单测。

## 9. 提交策略（按模块 scoped）

1. 路径修正（fix，独立提交，会话浏览同样受益）：`utils/paths.rs`（`PI_CODING_AGENT_DIR` 语义 + XDG 分支 + 单测）
2. 后端：`usage_local/omp.rs` + `usage_local/mod.rs`（注册模块与扫描，`local_date_from_ms` 上移）+ `usage_local/zcode.rs`（改用上移后的函数）+ `models/usage.rs`（注释）
3. 前端：`UsagePanel.tsx`（`APP_TABS` + `appLabel`）+ `services/modules/usage.ts`
4. 文档：本文

精确 `git add` 路径，不 `add -A`；完成后按 CLAUDE.md 约定更新 `docs/task-plan/progress.csv`。
