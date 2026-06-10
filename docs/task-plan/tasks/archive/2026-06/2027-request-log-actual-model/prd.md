# 请求明细记录实际(出站)模型

## Goal

请求明细新增「实际模型」（实际转发上游的出站模型）：当网关把请求模型重写（映射或锁定）为不同模型时，悬停详情弹层在「模型」下方以蓝色显示「实际模型：<出站名>」；未发生重写则不显示该字段。仪表盘实时请求监控与统计页端点请求记录共用同一弹层，二者同时生效。

## Requirements

- `RequestLog` 新增 `actualModel: string | null`：仅当实际出站模型与请求(入站)模型不同（映射/锁定生效）时记录，否则为 null。
- 悬停 TokenDetail：`模型` 行下方，当 `actualModel` 非空时显示 `实际模型：<值>`，蓝色字体（`text-info`）。
- 仪表盘 live 与统计页 ranged 均生效（同一组件）。

## Acceptance Criteria

- [ ] 映射生效的请求（如 claude-opus-4-8 → gpt-5.5）：弹层显示「模型：claude-opus-4-8」+「实际模型：gpt-5.5」（蓝色）。
- [ ] 无重写（透传）的请求：不显示「实际模型」行。
- [ ] 锁定模型导致改写、且与请求模型不同时同样显示。
- [ ] 旧行 / 无数据：actualModel 为 null，不显示。
- [ ] `cargo test` / `npx tsc --noEmit` / `npx vitest run` 通过。

## Definition of Done

- 后端 actual_model 垂直切片（迁移 v8 + 模型 + repo + aggregator + forward），含单测。
- 前端类型 + 弹层展示。
- 真实出网改写为无头不可验，显式声明本地核对。

## User Stories

- 作为用户，我希望在请求详情看到实际转发上游的模型，以便确认映射是否按预期生效、映射到了哪个模型。

## Implementation Decisions

- 触发口径：实际出站模型与请求模型「大小写不敏感不同」即记录并展示（自然覆盖映射与锁定两种改写，皆属"实际模型≠请求模型"）。相同或透传则 null。
- 记录值为 forward 中 `resolve_outbound` 得到的有效出站模型（非空且 != 入站）。最终全失败兜底记录 actual_model=None。
- 新增 DB 列 `request_logs.actual_model TEXT`（迁移 v8，旧行 NULL），随 RequestRecord→RequestLog→repo 贯穿，复用既有切片范式（参照 first_byte_ms）。

## Testing Decisions

- migration：v8 列存在性。
- request_logs_repo：actual_model 往返（含 None）。
- 前端：tsc + vitest 不回归。

## Out of Scope

- 历史旧行回填实际模型。
- 表格新增列（仅悬停弹层展示）。

## Technical Notes

- 弹层蓝色用项目 `text-info` token（badge 已用）。
- 真实转发改写、弹层视觉无法无头验证。
