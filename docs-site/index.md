---
layout: home
title: ccMesh 文档首页
description: 跨平台 AI 代理网关：协议转换、模型映射、端点轮换与熔断、配置与统计。
meta:
  contentType: Landing

hero:
  name: "ccMesh"
  text: "跨平台 AI 代理网关"
  tagline: 在本机统一接入 Claude / OpenAI / Codex 等多类上游，并完成协议转换、模型映射、端点轮换与熔断、请求统计与配置管理。
  image:
    src: /screenshots/logo.png
    alt: ccMesh
  actions:
    - theme: brand
      text: 快速入门
      link: /guide/quickstart
    - theme: alt
      text: 项目简介
      link: /guide/introduction
    - theme: alt
      text: 下载安装包
      link: https://github.com/VkRainB/ccMesh/releases/latest

features:
  - title: 多协议统一接入
    details: "Claude / OpenAI / Codex 三类转换器，单端点对外，统一上游协议差异。"
  - title: 轮换与熔断
    details: "按模型过滤轮换，每端点独立三态熔断器；支持快速队列优先选路。"
  - title: 渠道化配置管理
    details: "「渠道」管理 Claude Code / Codex / Claude Desktop 配置，表单与原文双向联动，应用前自动备份。"
  - title: 用量统计与监控
    details: "实时监控请求（模型、耗时、Token）；端点统计与本机工具用量统计分栏查看。"
  - title: 配置同步与备份
    details: "本地备份、恢复、导出，WebDAV 远程同步；支持从 cc-switch 迁移端点。"
  - title: 跨平台桌面应用
    details: "Tauri 2 + Rust + React 19，覆盖 Windows / macOS / Linux。"
---
