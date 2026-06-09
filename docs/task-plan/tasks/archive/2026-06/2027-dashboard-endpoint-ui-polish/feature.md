# 2027 仪表盘 / 端点 / 设置 多项 UI 与熔断优化

## 目标

落地 `需求.txt` 6 项优化，前端为主、任务 3/5 含后端。

## 现状（根因）

- 任务1：`StatCard` 已有 `hintBelow` 能力，仪表盘未启用。
- 任务2：`TokenDetail`（RequestMonitor.tsx）直接渲染原始数字与 `${durationMs}ms`。
- 任务3：`first_byte`（首字）后端完全未跟踪；`duration_ms` 已有。
- 任务4：`apiKey` 字段固定 `type=password` 无显隐；`JsonEditor` 无宽度约束/容器，易溢出错位。
- 任务5：`handle_proxy` 轮换候选只按入站格式过滤，**未按请求模型过滤**，导致不含该模型的端点也被轮到并失败、污染其熔断。
- 任务6：设置页首段无标题；系统/高级段把示例塞进超长 label，与"代理"段风格不一致。

## 关键文件/落点

- `src/lib/format.ts`：新增 `formatTokenK(n)`、`formatDuration(ms)`。
- `src/pages/Dashboard/index.tsx`：Token 卡加 `hintBelow`。
- `src/components/business/RequestMonitor.tsx`：`TokenDetail` 用新格式化；表头/行加「用时」「首字」列。
- `src/services/modules/stats.ts`：`RequestLog` 加 `firstByteMs: number | null`。
- `src/pages/Endpoints/_components/EndpointForm.tsx`：apiKey 显隐切换。
- `src/pages/Endpoints/_components/JsonEditor.tsx`：容器+宽度修复。
- `src/pages/Settings/index.tsx`：首段标题 + 系统/高级段重排。
- 后端首字：`src-tauri/src/modules/storage/migration.rs`（v6）、`models/stats.rs`、`modules/stats/aggregator.rs`、`modules/storage/request_logs_repo.rs`、`modules/proxy/forward.rs`。
- 后端模型过滤：`src-tauri/src/modules/proxy/resolver.rs`（新 `filter_by_model`）+ `forward.rs` 调用。

## 任务拆解

- 2027.1 前端格式化工具 + Token 卡垂直布局（任务1、2 格式化基础）。
- 2027.2 RequestMonitor 悬停 k/秒格式化（任务2）。
- 2027.3 后端 first_byte 垂直切片：迁移 v6 → 模型/记录/repo → forward 计时（任务3后端）。
- 2027.4 前端明细表「用时」「首字」列 + 类型字段（任务3前端）。
- 2027.5 端点 apiKey 显隐 + JsonEditor 容器修复（任务4）。
- 2027.6 后端按模型过滤候选端点 + 单测（任务5）。
- 2027.7 设置页排版美化（任务6）。

## 数据契约

```ts
// RequestLog 新增
firstByteMs: number | null;
```
```rust
// RequestLog / RequestRecord 新增
pub first_byte_ms: Option<i64>,
// migration v6
"ALTER TABLE request_logs ADD COLUMN first_byte_ms INTEGER;"
```
```rust
// resolver
pub fn filter_by_model(enabled: &[Endpoint], model: Option<&str>) -> Vec<Endpoint>
// 有端点声明该模型 → 仅返回这些；否则返回全量克隆。
```

## 验收标准

见 prd.md Acceptance Criteria。

## 测试点

- `format.test.ts`：`formatTokenK(94)=94`、`(1025)=1k`、`(102291)=102k`；`formatDuration(6458)=6.46s`。
- `resolver` 单测：声明命中过滤、未声明回退全量、大小写不敏感。
- `migration` 单测：v6 含 `first_byte_ms`。
- `request_logs_repo` 单测：first_byte_ms 往返。

## 提交策略

1. `docs`: prd/feature/progress。
2. `feat(stats)`: 后端 first_byte 切片（migration+model+aggregator+repo+forward）。
3. `feat(proxy)`: resolver 按模型过滤 + forward 调用。
4. `feat(ui)`: format 工具 + Dashboard + RequestMonitor（任务1/2/3前端）。
5. `feat(ui)`: EndpointForm/JsonEditor（任务4）。
6. `style(ui)`: Settings 排版（任务6）。
