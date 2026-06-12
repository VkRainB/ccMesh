# Research: 端点模型列表获取链路（models-fetch）

- Query: 摸清 `fetch_endpoint_models` 完整实现、全部调用方、models_cache 结构与硬编码回落、transformer 定义、HTTP client 构建与响应解析、是否已有多 URL 候选/重试可复用 —— 为"模型获取聚合与 URL 候选策略"（需求 4/6）做规划输入。
- Scope: internal
- Date: 2026-06-12

## 结论（先给答案）

模型拉取核心逻辑全部集中在 `src-tauri/src/modules/models_cache.rs` 的 `fetch_model_ids`（单 URL、单格式、失败静默返回空 Vec），由两条 Rust 路径消费：① Tauri 命令 `fetch_endpoint_models`（commands/models.rs:75，前端唯一 invoke 点是端点表单"刷新"按钮 EndpointForm.tsx:112）；② `get_models` 命令经 `fetch_models` 包装（失败回落硬编码 `claude-3-5-sonnet-latest`，但该命令前端**目前无人调用**）。改动 `fetch_model_ids` 影响面小且收敛；项目中**没有**现成的"多 URL 候选"逻辑可复用（forward.rs 的重试是端点级轮换，不是 URL 级），需新建模块。HTTP client 构建（`build_client`）与请求头/UA 模式（`ua.rs`）可直接复用。

## Findings

### 相关文件

| 文件路径 | 作用 |
| --- | --- |
| `src-tauri/src/modules/models_cache.rs` | 核心：`fetch_model_ids`（按 transformer 构建请求 + 解析 data[].id）、`fetch_models`（含硬编码回落）、`model_info` |
| `src-tauri/src/commands/models.rs` | 两个 Tauri 命令：`get_models`（带缓存聚合）、`fetch_endpoint_models`（表单刷新） |
| `src-tauri/src/modules/transform/transformer.rs` | `UpstreamFormat` 枚举 + `from_transformer_name` 映射 |
| `src-tauri/src/modules/proxy/client.rs` | `build_client` / `should_use_proxy`（HTTP client 构建与代理决策，可复用） |
| `src-tauri/src/utils/ua.rs` | 探测 UA 常量：`CLAUDE_PROBE_UA`、`codex_probe_ua()`、`CODEX_ORIGINATOR` |
| `src-tauri/src/state.rs:20,31` | `AppState.models_cache: Mutex<ModelsCache>`（内存缓存） |
| `src-tauri/src/lib.rs:146-147` | 两命令的 invoke_handler 注册 |
| `src/services/modules/endpoint.ts:88-99` | TS 侧 `endpointApi.fetchModels` → invoke `fetch_endpoint_models` |
| `src/pages/Endpoints/_components/EndpointForm.tsx:110-119` | 前端唯一调用点：刷新按钮 useMutation，成功后与 form.models 去重合并 |
| `src/services/modules/models.ts:15-18` | TS 侧 `modelsApi.getModels` → invoke `get_models`（**无调用方**） |
| `src-tauri/src/modules/proxy/server.rs:170-215` | 本地网关 `/v1/models` 路由：只读库聚合配置态模型，**不请求上游**，与本链路无关（但 import 了 `model_info`） |
| `src-tauri/src/commands/endpoint.rs:130-180` | `test_endpoint`：同样的"按 transformer 分支构建请求头 + base 拼路径"模式，且有按格式区分的默认模型表 |
| `docs/task-plan/状态同步及时需求.txt:26-96` | 需求原文：第 4 点（硬编码回落）、第 6 点（聚合 + URL 候选策略 + KNOWN_COMPAT_SUFFIXES 清单） |

### 1. fetch_endpoint_models 实现

`src-tauri/src/commands/models.rs:74-90`：

```rust
#[tauri::command]
pub async fn fetch_endpoint_models(
    state: State<'_, AppState>,
    api_url: String,
    api_key: String,
    transformer: String,
    use_proxy: Option<bool>,
) -> AppResult<Vec<String>> {
    let (proxy_enabled, proxy_url) = { /* 读库 config */ };
    let want = should_use_proxy(use_proxy.unwrap_or(false), proxy_enabled, &proxy_url);
    let client = build_client(want, &proxy_url, Duration::from_secs(15))?;
    Ok(fetch_model_ids(&client, &api_url, &api_key, &transformer).await)
}
```

实际逻辑在 `models_cache.rs:26-59` 的 `fetch_model_ids`：

```rust
let base = api_url.trim_end_matches('/');
let url = format!("{base}/v1/models");                 // URL 拼接：仅去尾斜杠 + 固定 /v1/models
let req = match UpstreamFormat::from_transformer_name(transformer) {
    UpstreamFormat::OpenAiChat | UpstreamFormat::OpenAiResponses => client
        .get(&url)
        .header("user-agent", crate::utils::ua::codex_probe_ua())
        .header("originator", crate::utils::ua::CODEX_ORIGINATOR)
        .header("authorization", format!("Bearer {api_key}")),
    UpstreamFormat::Claude => client
        .get(&url)
        .header("user-agent", crate::utils::ua::CLAUDE_PROBE_UA)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01"),
};
// 成功且 2xx 且 JSON 有 data[] → 收集 data[].id；任何一步失败 → 返回 Vec::new()（静默，无错误信息）
```

失败回落分两层：
- `fetch_model_ids` 本身：任何失败（网络错误 / 非 2xx / JSON 无 data）→ 返回**空 Vec**，错误被吞掉。
- `fetch_endpoint_models` 命令：不加工，直接把空 Vec 返回前端（前端 toast 显示"拉取到 0 个模型"，EndpointForm.tsx:116）。
- `fetch_models`（仅 get_models 路径用）：空 Vec → 回落 `[model_info(default_model(ep), ep.name)]`，即硬编码默认模型。

### 2. 调用方清单（完整）

`fetch_model_ids`（models_cache.rs:26）的调用方：

| 调用方 | 位置 | 说明 |
| --- | --- | --- |
| `fetch_endpoint_models` 命令 | `src-tauri/src/commands/models.rs:89` | 透传四个字段，供未保存端点的表单刷新 |
| `fetch_models` | `src-tauri/src/modules/models_cache.rs:63` | get_models 聚合路径，空结果回落默认模型 |

`fetch_endpoint_models` 命令的调用方：

| 调用方 | 位置 | 说明 |
| --- | --- | --- |
| invoke_handler 注册 | `src-tauri/src/lib.rs:147` | 命令注册 |
| `endpointApi.fetchModels` | `src/services/modules/endpoint.ts:94` | TS 包装，参数 `(apiUrl, apiKey, transformer, useProxy?)` |
| EndpointForm 刷新按钮 | `src/pages/Endpoints/_components/EndpointForm.tsx:112` | **前端唯一业务调用点**（refresh useMutation） |

`fetch_models`（models_cache.rs:62）的调用方：

| 调用方 | 位置 | 说明 |
| --- | --- | --- |
| `get_models` 命令 | `src-tauri/src/commands/models.rs:61` | 遍历启用端点聚合 |

`get_models` 命令的调用方：

| 调用方 | 位置 | 说明 |
| --- | --- | --- |
| invoke_handler 注册 | `src-tauri/src/lib.rs:146` | 命令注册 |
| `modelsApi.getModels` | `src/services/modules/models.ts:16-17` | TS 包装，**但全前端搜索 `modelsApi.` 零调用** —— get_models 当前是死路径 |

结论：改 `fetch_model_ids` 签名/行为只波及 `fetch_endpoint_models`（活跃，表单刷新）和 `fetch_models`→`get_models`（前端无人用，但命令仍注册，需保持编译与行为兼容）。Endpoints 页的 `ModelList.tsx` 与本地网关 `/v1/models` 路由（server.rs:170）都只读端点配置态 models 字段，不走上游拉取，不受影响。

### 3. models_cache.rs 全文结构（共 69 行）

- L6-12 `default_model(ep)`：`ep.model` 为空时返回硬编码 `"claude-3-5-sonnet-latest"`（**需求第 4 点要消除的硬编码**；注意 `commands/endpoint.rs:135-139` 的 test_endpoint 已有按格式区分的默认表：OpenAiChat→`gpt-4o-mini`、OpenAiResponses→`gpt-5-codex`、Claude→`claude-3-5-sonnet-latest`，可参照/统一）。
- L14-22 `model_info(id, endpoint_name)`：拼 OpenAI 格式模型对象（被 server.rs:215 的 `/v1/models` 路由复用）。
- L26-59 `fetch_model_ids`：见上。
- L62-69 `fetch_models(client, ep)`：调 `fetch_model_ids`，空则 `vec![model_info(default_model(ep), &ep.name)]`。

硬编码默认模型的实际触发场景：仅 `get_models` 命令路径（启用端点拉模型失败/为空时填充缓存）。由于前端没有调用 get_models，**当前硬编码值只可能出现在 get_models 的 JSON 响应里，对 UI 无可见影响**——改造它风险极低。

缓存机制（commands/models.rs:20-34, 64-68）：内存 `state.models_cache`（`Mutex<ModelsCache>{ models, updated_at }`），TTL 取配置 `modelsCacheTtl`（默认 30 分钟，config.rs:47,73），`force_refresh=true` 或过期时全量重拉。`fetch_endpoint_models` **不读不写**该缓存。

### 4. transformer 类型定义

Rust（`src-tauri/src/modules/transform/transformer.rs:5-23`）：

```rust
pub enum UpstreamFormat { Claude, OpenAiChat, OpenAiResponses }

pub fn from_transformer_name(name: &str) -> Self {
    match name.trim().to_ascii_lowercase().as_str() {
        "openai" | "openai_chat" | "openai-chat" | "openai2" => OpenAiChat,
        "codex" | "openai_responses" | "openai-responses" => OpenAiResponses,
        _ => Claude,   // gemini 等未知值一律按 Claude 直通
    }
}
```

TS 侧没有枚举，全是裸 string：
- `Endpoint.transformer: string`（`src/services/modules/endpoint.ts:17`）、`CreateEndpointRequest.transformer?: string`（:35）。
- 表单下拉硬编码三个值：`claude` / `openai` / `codex`（`EndpointForm.tsx:210-212`，默认 `"claude"`，:46）。
- 筛选 store 注释 `"all" | "claude" | "openai"`（`src/stores/modules/filters.ts:6`）——注意筛选项缺 codex，与本任务无直接关系但顺带记录。

### 5. HTTP client 与响应解析（可复用点）

- client 构建：`build_client(want_proxy, proxy_url, timeout)`（`src-tauri/src/modules/proxy/client.rs:22-42`），代理地址无效 warn 后回落直连。模型拉取超时 15s（models.rs:46/88），连通性测试 30s（endpoint.rs:130）。
- 代理决策：`should_use_proxy(use_proxy, proxy_enabled, proxy_url)`（client.rs:11-13）。
- 请求头模板（按格式）：models_cache.rs:34-45；UA 常量在 `src-tauri/src/utils/ua.rs`（Claude 探测 UA `claude-cli/2.1.149 (external, cli)`，OpenAI 探测 UA `codex_cli_rs/0.45.0 (...)` + `originator` 头）。
- 响应解析：models_cache.rs:46-57，`resp.json::<Value>()` → `v["data"].as_array()` → `data[].id` 收 String。Claude 与 OpenAI 上游 `/v1/models` 响应同为 `data[].id`，**一套解析可共用**，聚合策略不需要双解析器。

### 6. 多 URL 候选/重试：无现成可复用

- `proxy/forward.rs` + `rotation.rs` + `circuit_breaker.rs` 的重试是**端点级**轮换/熔断（候选 = 多个 Endpoint，URL 固定 `base + upstream_path`，forward.rs:621-622），不是同一端点的多 URL 尝试，抽象不匹配，不建议强行复用。
- `test_endpoint`（endpoint.rs:132+）与 `fetch_model_ids` 是同一种"`trim_end_matches('/')` + 固定路径"拼法，全项目无任何"剥离子路径/`/v{N}` 检测"逻辑 → **URL 候选构造器需全新实现**（建议放 models_cache.rs 同级新函数或独立小模块，纯函数好单测）。
- 需求文档已给定策略与剥离清单：`docs/task-plan/状态同步及时需求.txt:64-94`（KNOWN_COMPAT_SUFFIXES 共 9 项：/api/claudecode、/api/anthropic、/apps/anthropic、/api/coding、/claudecode、/anthropic、/step_plan、/coding、/claude；明确**不做** `/v{N}`→`/models` 这一档，因任务 5 已做输入提示）。

### 相关约定 / spec

- 需求源：`docs/task-plan/状态同步及时需求.txt` 第 4 点（去硬编码回落）与第 6 点（聚合鉴权：选 Claude 时先 x-api-key 再 Bearer 重试一次；两种鉴权都失败才走 URL 候选；任一步拿到结果立即返回）。
- 历史调研可参考：`docs/task-plan/tasks/archive/2026-06/2027-codex-responses-route/research/01-current-arch.md:127-139`（行号与当前代码仍一致）。

## 改动风险评估

- **低风险**：`fetch_model_ids` 改造（增加鉴权聚合 + URL 候选）只有 2 个 Rust 调用方；`fetch_endpoint_models` 的 Tauri 参数签名若不变（仍收 api_url/api_key/transformer/use_proxy），前端 `endpoint.ts` / `EndpointForm.tsx` 零改动。
- **需注意**：`fetch_models`（get_models 路径）会随之获得新行为（多一次重试 + 候选 URL），15s timeout × 多候选 × 多端点串行可能拉长 get_models 总耗时——虽然该命令前端暂无人用，建议候选尝试设短超时或仅在 `fetch_endpoint_models` 路径启用完整候选策略。
- **需注意**：`default_model` 硬编码若按格式拆分，应与 `commands/endpoint.rs:135-139` 的 fallback 表统一（DRY），避免两处默认模型清单。
- transformer 为 `gemini` 等未知值时落入 Claude 分支（transformer.rs:20），聚合策略天然覆盖（Claude 头失败后会试 Bearer）。

## Caveats / 未找到

- 前端 `modelsApi.getModels` 无任何调用（`modelsApi.` 全局零匹配），`get_models` 是否保留/接线属规划决策，本报告只记录现状。
- 项目内未找到任何现成"多 URL 候选"或"鉴权降级重试"实现，需新写。
- 未做外部调研（需求文档已给定候选策略与后缀清单，无需引外部参考）。
