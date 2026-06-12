# 2028 端点状态同步与模型获取优化

## 目标

见 prd.md。六个优化点：启停跨页同步、可用性优先级合并、共享健康 hook、默认模型去硬编码、api_url 输入辅助、模型获取鉴权聚合 + URL 候选策略。

## 现状（根因）

调研详情见 `research/health-sync.md`、`research/models-fetch.md`、`research/endpoint-form.md`。

- **启停不同步**：`EndpointCard` toggle 后只 invalidate `["endpoints"]`；仪表盘 `ServiceCard` 读 `["health"]`（`get_health`）；后端 `update_endpoint`/`test_endpoint` 不发任何事件；全局 staleTime 60s（`src/main.tsx:21-27`）。三因叠加。
- **可用性不准**：`TestBadge`（`EndpointCard.tsx:212-218`）只读 DB `test_status`（仅手动测试写入）；实时请求只更新内存熔断器（`BreakerRegistry`），从不回写。
- **重复订阅**：`ServiceCard.tsx:41-49` 与 `Endpoints/index.tsx:23-31` 逐字重复的 `onHealthChanged → invalidate ["endpoint-health"]`。
- **硬编码回落**：`models_cache.rs:6-12` `default_model` 硬编码 `claude-3-5-sonnet-latest`；而 `commands/endpoint.rs:135-139` 另有一份按格式区分的默认表（两处不 DRY）。
- **api_url 零提示**：`EndpointForm.tsx` 纯受控 useState，api_url 由 `fields` 数组循环渲染（L143-149），无校验无 hint；后端三处出网均 `trim_end_matches('/')` + 含 `/v1` 后缀，用户多填 `/v1` 必产生 `/v1/v1/...`。
- **模型获取单一尝试**：`models_cache.rs:26-59` `fetch_model_ids` 按 transformer 单格式单 URL，失败静默返空。调用方仅 2 处 Rust（`fetch_endpoint_models`@`commands/models.rs:89`、`fetch_models`@`models_cache.rs:63`），前端唯一 invoke 点 `EndpointForm.tsx:112`。

## 关键文件/落点

### 后端（Rust）

| 文件 | 改动 |
| --- | --- |
| `src-tauri/src/commands/endpoint.rs` | `update_endpoint` 落库成功后、`test_endpoint` `set_test_status` 后 emit `endpoints-changed`（需给命令加 `AppHandle` 参数）；默认模型表（L135-139）改为调用共享映射函数 |
| `src-tauri/src/modules/models_cache.rs` | `default_model` 去硬编码 → 按 `UpstreamFormat` 的共享映射函数；`fetch_model_ids` 保持现行为（get_models 路径不变）；抽出可复用的"单次请求 + 解析 data[].id"内核 |
| `src-tauri/src/modules/models_probe.rs`（新建） | 鉴权聚合 + URL 候选策略：`KNOWN_COMPAT_SUFFIXES` 常量、纯函数 `build_candidate_urls(api_url) -> Vec<String>`、`probe_models(client, api_url, api_key, transformer) -> Vec<String>`（鉴权头构建复用 models_cache 现有模式 / ua.rs） |
| `src-tauri/src/commands/models.rs` | `fetch_endpoint_models` 改调 `probe_models`（命令签名不变） |
| `src-tauri/src/modules/mod.rs`（或相应 mod 声明处） | 注册新模块 |

事件常量与 emit 范式参考 `stats/aggregator.rs:15,93-96`；命令层直接用 `AppHandle::emit`，不经 StatsAggregator。

### 前端（TS/React）

| 文件 | 改动 |
| --- | --- |
| `src/services/request.ts` | `Events` 表加 `endpointsChanged: "endpoints-changed"` |
| `src/hooks/useEndpointHealth.ts`（新建） | 仿 `useStats.ts` 模式：`useEndpointHealthEvents()` 订阅 `endpoint-health-changed` + `endpoints-changed` → invalidate `["endpoints"]`,`["health"]`,`["endpoint-health"]`；`useEndpointHealth()` 包 `useQuery(["endpoint-health"], healthApi.getEndpointHealth)` |
| `src/pages/Dashboard/_components/ServiceCard.tsx` | 删 L41-49 内联订阅，改用共享 hook |
| `src/pages/Endpoints/index.tsx` | 删 L23-31 内联订阅，改用共享 hook |
| `src/pages/Endpoints/_components/EndpointCard.tsx` | 健康查询改用 `useEndpointHealth()`；`TestBadge` 合并显示：优先实时 status（healthy/recovering→正常，unhealthy→不可用），无实时数据或 unknown 回退 `endpoint.testStatus` |
| `src/pages/Endpoints/_components/EndpointForm.tsx` | apiUrl 字段从 `fields.map` 特判/拆出：下方加动态 URL 预览（依 `form.transformer`：claude→`/v1/messages`、openai→`/v1/chat/completions`、codex→`/v1/responses`），hint 样式复用 `px-1 text-xs text-ink-mute`（Settings:234 模式）；`/v1` 或 `/v1/` 结尾时警告（`text-destructive`） |

## 任务拆解

- **2028.1 后端事件**：`endpoints-changed` 常量 + `update_endpoint`/`test_endpoint` emit；`cargo check` 通过。
- **2028.2 共享 hook 与跨页同步**：`request.ts` 事件常量、新建 `useEndpointHealth.ts`、三组件接入、删两处重复订阅。
- **2028.3 可用性优先级合并**：`TestBadge` 消费实时健康数据，回退 testStatus。
- **2028.4 默认模型去硬编码**：共享 `default_model_for(format)` 映射，`models_cache.rs` 与 `commands/endpoint.rs` 两处收口 + 单测。
- **2028.5 模型获取聚合 + URL 候选**：新建 `models_probe.rs`（纯函数候选构造 + 鉴权聚合探测），`fetch_endpoint_models` 接入，`build_candidate_urls` 单测。
- **2028.6 api_url 辅助提示**：EndpointForm URL 预览 + `/v1` 警告。
- **2028.7 回归验证**：`cargo test`、`npx tsc --noEmit`、`npx vitest run`；人工核对清单输出。

构建顺序：2028.4 → 2028.5（纯逻辑+单测）→ 2028.1（后端事件）→ 2028.2 → 2028.3 → 2028.6（前端）→ 2028.7。

## 数据契约

```text
事件 endpoints-changed：payload 为空（与 endpoint-health-changed 一致），前端收到后全量重拉。
```

```rust
// models_probe.rs
pub const KNOWN_COMPAT_SUFFIXES: [&str; 9] = [
    "/api/claudecode", "/api/anthropic", "/apps/anthropic", "/api/coding",
    "/claudecode", "/anthropic", "/step_plan", "/coding", "/claude",
];

/// 候选 URL（已含 /v1/models 后缀），去重保序：
/// 1. {trim 尾斜杠后的原始 base}/v1/models
/// 2. 若 base 以某 KNOWN_COMPAT_SUFFIX 结尾：{剥离后}/v1/models
/// 不做 /v{N} → /models 档位。
pub fn build_candidate_urls(api_url: &str) -> Vec<String>;

/// 探测顺序（任一成功立即返回，全失败返回空 Vec）：
/// 对每个候选 URL：先按 transformer 对应鉴权（Claude→x-api-key+anthropic-version；
/// OpenAiChat/Responses→Bearer+codex UA），空结果再换另一种鉴权重试。
/// 原始 URL 的两种鉴权都失败后才进入下一候选。
pub async fn probe_models(client: &Client, api_url: &str, api_key: &str, transformer: &str) -> Vec<String>;
```

```rust
// 共享默认模型映射（落点 models_cache.rs 或 transformer.rs 旁，单一来源）
// Claude → "claude-3-5-sonnet-latest"
// OpenAiChat → "gpt-4o-mini"
// OpenAiResponses → "gpt-5-codex"
pub fn default_model_for(format: UpstreamFormat) -> &'static str;
```

```ts
// useEndpointHealth.ts
export function useEndpointHealthEvents(): void; // 订阅两事件，invalidate ["endpoints"],["health"],["endpoint-health"]
export function useEndpointHealth(): UseQueryResult<EndpointHealth[]>; // queryKey ["endpoint-health"]
```

```ts
// EndpointForm URL 预览映射（前端硬编码，与 Rust 证据一致）
const PATH_BY_TRANSFORMER = { claude: "/v1/messages", openai: "/v1/chat/completions", codex: "/v1/responses" };
// 警告条件：/\/v1\/?$/i.test(apiUrl)
```

## 验收标准

见 prd.md「Acceptance Criteria」。补充实现侧约束：

- `fetch_endpoint_models` Tauri 命令签名不变（`endpoint.ts`/`EndpointForm.tsx` 零改动即可继续工作）。
- `fetch_models`（get_models 路径）行为不变。
- 探测请求沿用 15s client；候选总数有上限（原始 + 至多 1 个剥离候选 × 2 种鉴权 = 最多 4 次请求）。

## 测试点

- `build_candidate_urls`：原始 URL、尾斜杠、DeepSeek 示例（`https://api.deepseek.com/anthropic` → 2 候选）、`/v1` 结尾（不特殊处理，仅 1 候选）、无子路径（1 候选）、子路径大小写。
- `default_model_for`：三格式各返回正确值；`models_cache` 与 `test_endpoint` 共用同一来源（编译期保证）。
- 前端：`tsc --noEmit`；既有 vitest 套件回归；hook 不可无头验证的部分（事件实际触发）列入人工清单。
- 人工核对清单（无头环境无法验证）：toggle 后切仪表盘即时更新；手动测试后两页同步；URL 预览随 transformer 切换；`/v1` 警告出现；DeepSeek 形态端点刷新模型成功。

## 提交策略

按模块分组（scoped commit，精确文件清单）：

1. `docs(task-plan)`: prd.md、feature.md、context.jsonl、research/*、progress.csv、状态同步及时需求.txt（如需入库）。
2. `refactor(models)`: 默认模型映射收口（models_cache.rs、commands/endpoint.rs）+ 单测。
3. `feat(models)`: models_probe.rs 鉴权聚合 + URL 候选 + 单测、commands/models.rs 接入、mod 注册。
4. `feat(health)`: 后端 endpoints-changed 事件（commands/endpoint.rs）。
5. `feat(ui)`: request.ts 事件常量、useEndpointHealth.ts、ServiceCard/Endpoints/EndpointCard 接入与合并显示。
6. `feat(ui)`: EndpointForm URL 预览与 /v1 警告。
