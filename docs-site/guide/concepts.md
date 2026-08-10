---
title: ccMesh 里这些词分别指什么
description: 端点、点亮模型、转换器、模型映射、轮换、熔断、快速队列与渠道等术语的定义，以及各自在哪配置。
meta:
  contentType: Conceptual
---

# ccMesh 里这些词分别指什么

下面术语是文档其余页面的共用定义。每个词只给定义，并标明在应用里哪里配置。

## 端点（Endpoint）

上游 API 提供方的一条配置：地址、密钥、转换器、模型清单等。多个启用端点组成可轮换的池。

在 **端点管理** 新建或编辑。字段说明见 [如何配置上游端点](/features/endpoints)。

## 点亮模型（activeModels）

端点 `models` 清单里，你勾选对外公布的子集。客户端拉取 `/v1/models`、对话页选模型、映射出站下拉，都按点亮结果来。

规则：

- `activeModels` 为空：默认公布全部 `models`（兼容旧端点）
- `activeModels` 非空：只公布点亮项（并保留 `models` 顺序）
- 填了 **锁定模型** 时：对外基础集以锁定模型为准

在端点表单的 **模型清单** 里点击模型徽章切换点亮。

## 转换器（Transformer）

决定 ccMesh 如何把客户端请求改写为上游协议，取值：`claude`（直通）、`openai`（Chat Completions 互转）、`codex`（Responses）。

在端点表单选择 **转换器**。互转细节见 [请求如何在协议间转换](/advanced/protocol-transform)。

## 模型映射（Model Mapping）

一条 `from → to`：客户端用入站名 `from` 请求，路由命中后改写为出站名 `to` 再转发。出站候选来自点亮模型（未点亮则全部 `models`）；关闭 **启用映射** 时保留规则但不改写、不公布入站别名。

在端点卡片打开 **模型映射**。

## 快速队列（fast）

启用端点上的优先子集。只要存在至少一个 `fast=true` 的启用端点，代理选路只在快速队列内轮询；队列为空时回退全部启用端点。

在仪表盘点闪电图标打开 **编辑快速队列**，或在已启用端点的编辑表单打开 **加入快速队列**。算法与数字见 [轮换与熔断如何工作](/advanced/rotation)。

## 轮换（Rotation）

在可路由端点之间分配请求：按当前索引前进，并按请求模型过滤候选，避免选到不支持该模型的端点。

在 **端点管理** 拖拽排序影响全局顺序；快速队列另有独立顺序。参数真源见 [轮换与熔断如何工作](/advanced/rotation)。

## 熔断器（Circuit Breaker）

每个端点独立的三态保护：Closed（放行）、Open（跳过）、HalfOpen（冷却后探测）。连续失败或错误率超阈值进入 Open；部分客户端错误（如 400 / 401 / 422 等）为中性，不计入熔断；`403` 可重试并计入熔断。

状态显示在仪表盘端点队列。阈值数字见 [轮换与熔断如何工作](/advanced/rotation)。

## 出站代理（useProxy / proxyEnabled）

转发与拉取模型是否走设置里的全局代理地址。真值：`(端点 useProxy 或 全局 proxyEnabled) 且 代理 URL 非空`；URL 为空时一律直连。应用更新另看 `proxyForUpdate`。

全局开关在 **设置 → 代理**；单端点开关在端点表单 **启用代理**。

## 渠道（Channel / Profile）

面向某个工具的一整套本地配置快照，可保存多套；点 **应用** 写入工具配置文件，应用前自动备份。

在 **配置文件** 管理。支持 Claude Code、Codex、Claude Desktop。见 [如何用配置文件接入客户端](/features/config-profiles)。

## 应用（App）

统计与配置里区分的客户端来源，主要为 Claude Code 与 Codex。用量统计可按应用过滤。
