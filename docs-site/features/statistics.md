---
title: 如何查看统计
description: 端点统计与用量统计两个标签：周期聚合、历史明细，以及本机 Claude Code / Codex 会话用量。
meta:
  contentType: How-to
---

# 如何查看统计

**统计** 页有两个顶层标签：**端点统计** 与 **用量统计**。前者看经网关的请求聚合，后者读本机工具会话日志汇总 Token。

![统计](/screenshots/statistics/statistics.png)

## 端点统计

数据来自 ccMesh 代理转发记录。

1. 选择周期：**今日** / **昨日** / **本周** / **本月**。
2. 阅读四张卡片：请求、错误、输入 Token、输出 Token。选「今日」且有昨日基线时，卡片显示相对昨日的趋势徽章。
3. 下方端点表按端点列出请求量与 Token，用于识别主力与异常流量。
4. 打开历史记录弹窗查看更细粒度明细。
5. 底部区间请求监控浏览该时段请求流。

![端点维度统计](/screenshots/statistics/statistics2.png)

实时单条请求也可在 [仪表盘](/features/dashboard) 查看。

## 用量统计

数据来自本机 Claude Code / Codex 会话日志，进入面板时会自动同步一次；也可点 **刷新** 再同步。

1. 用顶部标签过滤：**全部** / Claude Code / Codex。
2. 选择时间范围（如今日等）。
3. 阅读汇总：请求数、输入 Token、输出 Token、缓存 Token。
4. 下方按「日期 × 来源 × 模型」查看明细表。

用量统计与端点统计数据源不同，数字不必一致。备份应用数据见 [如何备份与同步配置](/features/sync)。
