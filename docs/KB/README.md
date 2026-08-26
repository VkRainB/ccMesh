# 工程经验库（KB）

从已完成任务中提炼的可复用工程经验，供开发、排查与架构决策时查阅。

**维护方式：**
- **提炼** — `.cursor/skills/kb-extract`：从 `docs/task-plan` 任务产物写入 `docs/KB/`
- **校准** — `.cursor/skills/kb-calibrate`：对照当前代码库验证并修正已有条目
- 条目格式见 `kb-extract/templates.md`

## 目录结构

| 类别 | 说明 |
|------|------|
| [contracts/](./contracts/) | 接口约定、数据契约、字段映射 |
| [decisions/](./decisions/) | 技术选型判据、方案取舍框架 |
| [patterns/](./patterns/) | 通用设计模式、可复用实现套路 |
| [pitfalls/](./pitfalls/) | 踩坑记录、反模式、易错点 |
| [testing/](./testing/) | 测试策略、验收与诊断方法 |
| [tooling/](./tooling/) | 工具链、调试与观测技巧 |

---

## contracts

| 文档 | 摘要 |
|------|------|
| [tool-arguments-canonicalization.md](./contracts/tool-arguments-canonicalization.md) | 可解析则排序键；缺省/非法 JSON 降级 `{}` |
| [responses-chat-field-mapping.md](./contracts/responses-chat-field-mapping.md) | 字段名、token 限额键、arguments 双重编码是 Responses 桥接三大坑 |

## decisions

| 文档 | 摘要 |
|------|------|
| [yagni-protocol-session-state.md](./decisions/yagni-protocol-session-state.md) | Chat Completions 全量历史路径不需要 Responses 专属的 ID 缓存 |
| [passthrough-vs-transform-by-protocol.md](./decisions/passthrough-vs-transform-by-protocol.md) | 上游按端点协议判定透传/转换；入站识别勿硬编码 UA |
| [reference-impl-portability-tiers.md](./decisions/reference-impl-portability-tiers.md) | 私有 crate 不假移植，改自研 + 外部映射表校对 |
| [unknown-field-forwarding-policy.md](./decisions/unknown-field-forwarding-policy.md) | Chat 出站剥离 cache_control；metadata 不进 body |
| [circuit-breaker-status-classification.md](./decisions/circuit-breaker-status-classification.md) | 4xx 请求侧错误中性不计熔断；403 与 429/5xx 一样计失败 |

## patterns

| 文档 | 摘要 |
|------|------|
| [proxy-proactive-sanitize.md](./patterns/proxy-proactive-sanitize.md) | 请求构建期主动 sanitize；错误驱动 rectifier 用 substring + 单次重试 |
| [streaming-multi-tool-by-index.md](./patterns/streaming-multi-tool-by-index.md) | 并行 tool call 用 index→状态映射，勿用单一 current_tool 指针 |
| [atomic-config-write.md](./patterns/atomic-config-write.md) | 同目录 tmp + flush + rename，Windows 先删后换 |
| [config-operation-fields-split.md](./patterns/config-operation-fields-split.md) | 表单只改操作字段，覆写时 merge 快照，TOML 用 AST 局部更新 |
| [models-probe-auth-url-candidates.md](./patterns/models-probe-auth-url-candidates.md) | 先轮换鉴权头，再剥离兼容子路径试候选 URL |
| [upstream-ua-client-restriction.md](./patterns/upstream-ua-client-restriction.md) | 按协议类型用全局 CLI UA；空串才透传客户端 |

## pitfalls

| 文档 | 摘要 |
|------|------|
| [requirement-vs-source-truth.md](./pitfalls/requirement-vs-source-truth.md) | 移植或复刻前以参考项目源码为准，勿信需求摘要 |
| [http-response-body-consumed-once.md](./pitfalls/http-response-body-consumed-once.md) | HTTP 响应体只能读一次，rectifier 与 passthrough 不能共用未缓冲流 |
| [streaming-usage-finish-event.md](./pitfalls/streaming-usage-finish-event.md) | message_start 时 input 为 0 正常，finish 必须带齐四字段 usage |
| [config-single-source-of-truth.md](./pitfalls/config-single-source-of-truth.md) | 同一语义只用一个配置键，读写路径必须共用解析函数 |
| [webkitgtk-linux-click-unresponsive.md](./pitfalls/webkitgtk-linux-click-unresponsive.md) | Linux 设 DMABUF 环境变量，show 后 nudge 窗口 |
| [advertised-models-routing-mismatch.md](./pitfalls/advertised-models-routing-mismatch.md) | 入站模型名必须出现在 advertised 集合，否则 filter 会漏端点或误匹配 |
| [readme-star-history-token-restriction.md](./pitfalls/readme-star-history-token-restriction.md) | GitHub 2026-06 限 stargazers API，README star-history 图需改用带 sealed_token 的 /chart 端点 |

## testing

| 文档 | 摘要 |
|------|------|
| [react-query-cross-page-stale.md](./testing/react-query-cross-page-stale.md) | 查 queryKey 不一致、后端未 emit、staleTime 过长 |

## tooling

| 文档 | 摘要 |
|------|------|
| [error-body-capture-pipeline.md](./tooling/error-body-capture-pipeline.md) | 非 2xx 读 body，4096 字节 cap，重试耗尽后入库 |

---

_索引最后更新：2026-08-10（新增 star-history sealed_token 条目）· 共 22 篇文档、23 条经验条目_
