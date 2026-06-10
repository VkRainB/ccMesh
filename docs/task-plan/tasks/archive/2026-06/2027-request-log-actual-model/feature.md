# 2027 请求明细记录实际(出站)模型

## 目标

记录并展示每条请求的实际出站模型（映射/锁定改写后），弹层蓝色显示「实际模型」。

## 现状（根因）

`RequestLog.model` 存的是入站(请求)模型；forward 中 `resolve_outbound` 得到的实际出站模型未被记录。弹层 `TokenDetail` 只显示 `模型：{log.model}`。需新增 actual_model 列贯穿后端切片，前端弹层条件展示。

## 关键文件/落点

后端（参照 first_byte_ms 切片范式）：
- `src-tauri/src/modules/storage/migration.rs`：v8 `ALTER TABLE request_logs ADD COLUMN actual_model TEXT;` + 列存在性单测。
- `src-tauri/src/models/stats.rs`：`RequestLog` 加 `pub actual_model: Option<String>`。
- `src-tauri/src/modules/stats/aggregator.rs`：`RequestRecord` 加 `actual_model: Option<String>`；`record` 构造 RequestLog 时透传。
- `src-tauri/src/modules/storage/request_logs_repo.rs`：INSERT 列 + 占位符 +1；row_to_log 读取新列（追加在末位索引）；测试 helper + 往返断言。
- `src-tauri/src/modules/proxy/forward.rs`：`RequestMeta` 加 `actual_model: Option<String>`；构造 meta 时按 `outbound_model`（非空且与入站不同，ci）计算；`into_record` 透传；最终失败兜底 RequestRecord 置 None。

前端：
- `src/services/modules/stats.ts`：`RequestLog` 加 `actualModel: string | null`。
- `src/components/business/RequestMonitor.tsx`：`TokenDetail` 模型行下方条件渲染 `实际模型`（`text-info` 蓝色）。
- `src/__tests__/RequestMonitor.test.tsx`：mock 加 `actualModel`，加展示/不展示断言。

## 任务拆解

- 2027e.1 后端 actual_model 垂直切片（迁移 v8 + 模型 + aggregator + repo + forward 计算），含单测。
- 2027e.2 前端类型 + 弹层蓝色「实际模型」条件展示 + 测试。

## 数据契约

```rust
// RequestLog / RequestRecord 新增
pub actual_model: Option<String>,
// migration v8
"ALTER TABLE request_logs ADD COLUMN actual_model TEXT;"
// forward 计算：requested = 入站 model；effective = outbound_model(非空)
// actual_model = (!outbound.is_empty() && !outbound.eq_ignore_ascii_case(requested)) ? Some(outbound) : None
```
```ts
// RequestLog 新增
actualModel: string | null;
```

## 验收标准

见 prd.md。

## 测试点

- migration v8 含 actual_model。
- repo：actual_model 往返（Some / None）。
- forward 计算口径（人工/集成，单测覆盖 repo 与 migration；forward 改写真实出网无头不验）。
- 前端：有 actualModel 显示蓝色行；无则不显示。

## 提交策略

1. `docs`: prd/feature/progress。
2. `feat(stats)`: 后端 actual_model 切片（migration+model+aggregator+repo）。
3. `feat(proxy)`: forward 计算 actual_model。
4. `feat(ui)`: stats 类型 + 弹层展示 + 测试。
