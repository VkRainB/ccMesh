---
id: 2030-claude-desktop-config-management
title: Claude Desktop 配置文件接管管理
status: done
mode: full
priority: P1
layer: fullstack
deps: []
prd_story: [1, 2, 3, 4]
owner: claude
branch: ""
base_branch: ""
created: 2026-08-07
completed: 2026-08-07
parent: ""
children: []
note: "已确认：保存直接写真实文件；删除=解除注册+删真实文件。编码进行中。"
---

# 2030 Claude Desktop 配置文件接管管理

## 任务来源

- 需求文件：`docs/task-plan/claude desktop配置管理功能.txt`
- 核心外部报告：
  - `E:\check-claude-desktop\CLAUDE_DESKTOP_CONFIG_PATH_CROSS_PLATFORM.md`
  - `E:\check-claude-desktop\CLAUDE_MSIX_PATH_REPORT.md`
  - `E:\check-claude-desktop\CLAUDE_PHYSICAL_PATH_INTEGRATION.md`

## 路由结论

走 full 完整链路。

原因：这是跨平台外部应用配置接管，涉及 Windows MSIX 物理路径探测、多文件 JSON 关系、后端 IPC、前端三栏 UI、新数据契约和写盘安全策略；不是现有 Claude Code / Codex 快照模式的简单扩展。

## 已确认决策

1. 「保存配置文件」直接写真实 Claude Desktop 文件（先备份再原子写）。
2. 删除配置文件默认：从 `_meta.json` 解除注册，并删除 `<profile-id>.json` 真实文件。
3. `_meta.json` 本机抽样字段：`appliedId` + `entries[{id,name}]`；profile 常见字段含 `inferenceGatewayBaseUrl` / `inferenceGatewayApiKey` / `inferenceGatewayAuthScheme` / `inferenceProvider` / `inferenceModels` / `modelDiscoveryEnabled`。

## 产物

- `prd.md`：产品目标、范围、验收和关键决策。
- `feature.md`：技术落点、伪代码、数据契约、任务拆解和验证路径。
- `research/claude-desktop-config-research.md`：需求、外部路径报告和项目框架调研结论。
- `context.jsonl`：后续实现前必须先读的上下文索引。
