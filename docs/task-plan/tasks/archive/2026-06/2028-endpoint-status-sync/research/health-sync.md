# Research: 端点健康状态与启用状态的同步链路

- Query: 后端健康状态来源 / 前端订阅 / 端点开启关闭链路 / 健康数据结构 / hooks 目录现状，为"状态同步及时"需求做规划输入
- Scope: internal
- Date: 2026-06-12

## 结论（先给答案）

健康状态有**两套互不打通的来源**：运行期内存熔断器（`BreakerRegistry`，由代理转发实时驱动）与 DB 持久字段 `test_status`（仅手动测试写入）。`endpoint-health-changed` 事件**只在熔断器发生状态转换时**发出（payload 为空 `()`），普通成功/失败不发；手动测试和端点启停**完全不发任何事件**。前端启停同步失效的根因是 **queryKey 不一致 + 无事件通知 + 全局 staleTime 60s**：端点管理 toggle 后只 invalidate `["endpoints"]`，而仪表盘"启用端点"读的是 `["health"]`（`get_health`），该 key 从未被 invalidate，60 秒内切回仪表盘也不会重新拉取。

## Findings

### 相关文件

| 文件路径 | 作用 |
| --- | --- |
| `src-tauri/src/modules/proxy/circuit_breaker.rs` | 运行期熔断器（内存态），`EndpointHealthInfo` 定义 |
| `src-tauri/src/modules/proxy/forward.rs` | 代理转发汇聚点：record_success/failure/neutral + emit 事件 |
| `src-tauri/src/modules/stats/aggregator.rs` | `emit_health_changed()`：发 `endpoint-health-changed` 事件 |
| `src-tauri/src/commands/health.rs` | `get_health`、`get_endpoint_health` 两个命令 |
| `src-tauri/src/commands/endpoint.rs` | `test_endpoint`（手动联通性测试）、`update_endpoint`（启停） |
| `src-tauri/src/modules/storage/endpoint_repo.rs` | `set_test_status`(L197)、`list_enabled`(L42) |
| `src/services/modules/health.ts` | `healthApi`：getHealth / getEndpointHealth / onHealthChanged |
| `src/services/modules/endpoint.ts` | `endpointApi`：list / update / test 等 |
| `src/services/request.ts` | `Events` 常量表（L38 `endpointHealthChanged`）、`subscribe` 封装 |
| `src/pages/Dashboard/_components/ServiceCard.tsx` | 仪表盘启用端点列表 + 健康点 |
| `src/pages/Endpoints/index.tsx` | 端点管理页（页级订阅健康事件） |
| `src/pages/Endpoints/_components/EndpointCard.tsx` | 单端点卡片：toggle / test / 熔断徽章 / TestBadge |
| `src/main.tsx` | QueryClient 全局配置（staleTime 60s） |
| `src/hooks/` | 现有 hooks（见第 5 节） |

### 1. 后端健康状态来源

**两套来源：**

A. **运行期熔断器（内存）**：`BreakerRegistry`（circuit_breaker.rs:199-324），存在 `ProxyState`，代理停止即消失。三态 Closed/Open/HalfOpen，由真实代理请求驱动：

- 转发成功（HTTP 200）→ `record_success`，forward.rs:489-491：
  ```rust
  if st.breakers.record_success(&ep.name, used_permit) {
      st.stats.emit_health_changed();
  }
  ```
- 非 200 Retryable → `record_failure`，forward.rs:514-523；网络错误 → forward.rs:569-574。
- **关键**：`record_success/record_failure` 返回值是"是否发生状态转换"（circuit_breaker.rs:252, 271）。**仅状态转换时才 emit 事件**——闭合态下的普通成功、未达阈值（连续 4 次失败 / 错误率 0.6）的失败都不发事件。

B. **DB 持久字段 `test_status`**（available/unavailable/unknown）：**只有**手动联通性测试命令 `test_endpoint`（endpoint.rs:111-221）写入，endpoint.rs:210-213：
  ```rust
  endpoint_repo::set_test_status(&conn, id, status)?;
  ```
  **实时请求成功/失败不会写 `test_status`**（forward.rs 全程不触 endpoint_repo）。`test_endpoint` 也**不发任何事件**。

**事件 `endpoint-health-changed`**：aggregator.rs:15, 93-96：
```rust
const ENDPOINT_HEALTH_EVENT: &str = "endpoint-health-changed";
pub fn emit_health_changed(&self) {
    let _ = self.app_handle.emit(ENDPOINT_HEALTH_EVENT, ());
}
```
- emit 方：仅 `StatsAggregator::emit_health_changed`，调用点仅 forward.rs:490 / 521 / 573（三处均为熔断状态转换时）。
- **payload 为空 `()`**——前端收到后必须重新 invoke `get_endpoint_health` 拉全量。

**查询命令 `get_endpoint_health`**（commands/health.rs:57-73）：代理运行时读熔断器 `breakers.health_of(&e.name)`（**完全忽略 test_status**）；代理未运行时回退 `EndpointHealthInfo::from_test_status`（circuit_breaker.rs:184-195，粗映射 available→healthy）。只返回**已启用**端点。

### 2. 前端订阅

`healthApi` 定义：`src/services/modules/health.ts:44-51`：
```ts
export const healthApi = {
  getHealth: () => request<HealthInfo>("get_health"),
  getEndpointHealth: () => request<EndpointHealth[]>("get_endpoint_health"),
  onHealthChanged: (cb: () => void): Promise<UnlistenFn> =>
    subscribe(Events.endpointHealthChanged, () => cb()),
};
```

订阅点 1 — `src/pages/Dashboard/_components/ServiceCard.tsx:41-49`：
```ts
useEffect(() => {
  let un: (() => void) | undefined;
  healthApi
    .onHealthChanged(() => qc.invalidateQueries({ queryKey: ["endpoint-health"] }))
    .then((u) => { un = u; });
  return () => un?.();
}, [qc]);
```

订阅点 2 — `src/pages/Endpoints/index.tsx:23-31`：
```ts
useEffect(() => {
  let un: (() => void) | undefined;
  healthApi
    .onHealthChanged(() => qc.invalidateQueries({ queryKey: ["endpoint-health"] }))
    .then((u) => { un = u; });
  return () => un?.();
}, [qc]);
```

两处**逐字重复**，都只 invalidate `["endpoint-health"]`。消费方：
- ServiceCard.tsx:37-40 `useQuery({ queryKey: ["endpoint-health"], queryFn: healthApi.getEndpointHealth })`
- EndpointCard.tsx:62-65 同一 key 同一 queryFn（多卡片靠 React Query 去重）。

### 3. 端点开启/关闭链路（不同步根因）

**端点管理侧 toggle**：EndpointCard.tsx:57-58, 77-81：
```ts
const invalidate = () => qc.invalidateQueries({ queryKey: ["endpoints"] });
const toggle = useMutation({
  mutationFn: (v: boolean) => endpointApi.update(endpoint.id, { enabled: v }),
  onSuccess: invalidate,
  ...
});
```
调用命令 `update_endpoint`（endpoint.rs:27-35，纯 DB 写，**不发事件**）；mutation 后只 invalidate `["endpoints"]`。

**仪表盘侧"启用端点"**：ServiceCard.tsx:32-35, 78：
```ts
const { data: health } = useQuery({ queryKey: ["health"], queryFn: healthApi.getHealth });
...
const endpoints = (health?.endpoints ?? []).filter((e) => e.enabled);
```
数据来自命令 `get_health`（commands/health.rs:31-54，DB `list_all` + enabled 计数）。

**根因（三因叠加）**：
1. **queryKey 不一致**：toggle 只 invalidate `["endpoints"]`（useEndpoints.ts:6），仪表盘读 `["health"]`，二者无交集；`["endpoint-health"]` 也未被 invalidate（启停会改变 `get_endpoint_health` 的返回集合——它只查 enabled）。
2. **无事件通知**：`update_endpoint`/`test_endpoint` 后端均不 emit 事件，跨页面无法感知。
3. **staleTime 60s**（main.tsx:21-27 全局默认）：切换视图（useLayoutStore.setActiveView 条件渲染）重挂载 ServiceCard 时，`["health"]` 60 秒内视为 fresh 不重拉。

附带：手动测试 `test.mutate` 成功后也只 invalidate `["endpoints"]`（EndpointCard.tsx:82-91），`["endpoint-health"]` 与仪表盘 `["health"]` 同样不刷新。

**需求 2 的根因**（实时请求成功但可用性仍显示不可用）：端点卡片可用性徽章 `TestBadge` 读的是 `endpoint.testStatus`（EndpointCard.tsx:212-218），该字段只被手动测试更新；实时请求成功只改熔断器内存态，从不回写 `test_status`，且代理运行时 `get_endpoint_health` 虽反映实时健康但 UI 的可用性徽章不消费它（只消费 circuit 徽章）。

### 4. 健康状态数据结构

Rust 侧 — `EndpointHealthInfo`（circuit_breaker.rs:156-168，命令返回 + 设计上可作事件 payload，但当前事件 payload 是 `()`）：
```rust
pub struct EndpointHealthInfo {
    pub name: String,
    pub status: String,        // healthy | unhealthy | recovering（fallback 时可为 unknown）
    pub circuit: String,       // closed | open | halfOpen
    pub consecutive_failures: u32,
    pub success_rate: f64,
    pub last_error: Option<String>,
    pub last_failure_ms: Option<i64>,
}
```

TS 侧 — `EndpointHealth`（health.ts:24-33）字段一一对应（camelCase）；另有 `Endpoint.testStatus: string`（endpoint.ts:23）。

**是否区分"手动测试"与"实时请求"**：结构上**不区分**。`test_status`（手动）与熔断器（实时）是两个独立存储，唯一交汇点是代理未运行时 `from_test_status` 回退（commands/health.rs:67-70）。没有任何字段标记数据来源/时间戳，无"实时优先于手动"的合并逻辑——这正是需求 2 要补的。

### 5. 前端 hooks 现状

`src/hooks/` 共 6 个，命名 `useXxx.ts`、每文件单 hook 导出：

| 文件 | 内容 |
| --- | --- |
| `useEndpoints.ts` | `useQuery(["endpoints"], endpointApi.list)`，3 行 |
| `useStats.ts` | **可复用模式**：`useStatsEvents()` 内 subscribe 事件 → invalidate，`useStats()` 包 useQuery（L8-20） |
| `useAutoTheme.ts` / `useThemeSync.ts` | 主题相关，内含 `["config"]` query |
| `useTrayActions.ts` / `useUpdate.ts` | 托盘 / 更新 |

`useStats.ts` 的"事件订阅 + invalidate 收口进 hook"写法是需求 3（共享 `useEndpointHealth`）的直接模板。

### 可复用点

- `src/services/request.ts` 的 `Events` 常量表 + `subscribe`：新增事件（如 `endpoints-changed`）只需加一行常量。
- `StatsAggregator::emit_health_changed`（aggregator.rs:94）：后端 emit 范式；但启停事件应挂在 `AppHandle.emit`，命令层（endpoint.rs）可直接拿 `AppHandle` 参数 emit，无需经 StatsAggregator。
- `useStats.ts` 的 hook 化订阅模式 → 抽 `src/hooks/useEndpointHealth.ts`，消除 ServiceCard.tsx:41-49 与 Endpoints/index.tsx:23-31 的重复，并可顺带统一 invalidate `["endpoint-health", "health"]`。
- `EndpointHealthInfo` 已 `derive(Serialize)`，事件 payload 可直接携带增量数据（当前是空 payload，前端全量重拉）。

## Caveats / 未找到

- 未找到任何后台健康轮询：熔断器是纯请求驱动（circuit_breaker.rs 模块注释明确"无后台轮询"），代理空闲时 Open→HalfOpen 的转换也不会主动发事件（惰性转换，等下一个请求）。
- `update_endpoint` 是通用更新命令（编辑表单也用它），若在其中加事件需注意所有字段更新都会触发，不只 enabled。
- 熔断阈值为固定常量（CircuitBreakerConfig::default，circuit_breaker.rs:31-41），无运行时配置。
- 仪表盘 `["health"]` 还被代理启停影响（proxy_running 字段），规划事件时可一并考虑，但本次未深查 proxy start/stop 命令是否 invalidate `["health"]`（grep 未见相关 invalidate，大概率同样不同步）。
