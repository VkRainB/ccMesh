---
layout: home

hero:
  name: "ccMesh"
  text: "跨平台 AI 代理网关"
  tagline: 在本机统一接入 Claude / OpenAI / Codex 等多类上游，提供协议转换、模型映射、端点轮换与熔断、请求统计与配置管理。
  image:
    src: /screenshots/logo.png
    alt: ccMesh
  actions:
    - theme: brand
      text: 快速上手
      link: /guide/getting-started
    - theme: alt
      text: 项目简介
      link: /guide/introduction
    - theme: alt
      text: 下载安装包
      link: https://github.com/VkRainB/ccMesh/releases/latest

features:
  - title: 多协议统一接入
    details: "支持 claude（直通）、openai（转换）、codex（Responses）三类转换器，一个本地端点对外，屏蔽上游协议差异。"
  - title: 智能轮换与熔断
    details: "多端点按模型过滤轮换，每端点独立三态熔断器（Closed/Open/HalfOpen），自动跳过故障上游、惰性探测恢复。"
  - title: 渠道化配置管理
    details: "以「渠道」管理 Claude Code settings.json 与 Codex auth.json + config.toml，表单与 JSON 双向联动，应用前自动备份。"
  - title: 用量统计与监控
    details: "实时请求监控（模型、耗时、首字延迟、Token 明细），按应用 / 端点 / 模型维度查看历史用量。"
  - title: 配置同步与备份
    details: "配置与数据本地备份、恢复、导出，支持 WebDAV 远程同步，跨设备迁移无忧。"
  - title: 轻量跨平台
    details: "基于 Tauri 2 + Rust + React 19，原生体积小、启动快，覆盖 Windows / macOS / Linux 三端。"
---
