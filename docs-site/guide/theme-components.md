---
title: 文档主题组件
description: 文档站展示组件墙：提示条、按钮、徽章、代码组、步骤、手风琴与表格。
outline: deep
---

# 文档主题组件

本页集中展示文档站的自定义组件样式，供撰写与核对页面时参考；结构对齐设计稿组件墙，主色为 `#22C55E`。

## 按钮与徽章

<div class="doc-btn-row">
  <a class="VPButton brand" href="/ccMesh/guide/quickstart">主按钮</a>
  <a class="VPButton alt" href="/ccMesh/guide/introduction">描边按钮</a>
  <a class="VPButton" href="/ccMesh/guide/installation">幽灵按钮</a>
</div>

<Badge type="tip" text="可用" />
<Badge type="info" text="Note" />
<Badge type="warning" text="警告" />
<Badge type="danger" text="失败" />

快捷键 <kbd>Ctrl</kbd> <kbd>K</kbd> 打开搜索。

## 提示条

::: info Note
客户端填 [`http://127.0.0.1:3000`](http://127.0.0.1:3000)。端口以仪表盘为准。
:::

::: tip Tip
不改客户端即可在端点管理里切换上游。
:::

::: warning Warning
macOS 当前为未签名包，请用右键「打开」。
:::

::: danger Danger
熔断 Open 的端点不会再被选中，直到冷却结束。
:::

## 代码组

::: code-group

```bash [Local]
curl http://127.0.0.1:3000/v1/models
```

```bash [Absolute]
curl http://127.0.0.1:3000/v1/messages
```

:::

## 能力卡

<div class="feature-mini-grid">

<div class="feature-mini">

![](/icons/plug.svg)

**多协议**

Claude / OpenAI / Codex 三类转换器

</div>

<div class="feature-mini">

![](/icons/shield.svg)

**轮换熔断**

按模型过滤，三态熔断器

</div>

<div class="feature-mini">

![](/icons/chart.svg)

**用量监控**

耗时、首字延迟、Token

</div>

</div>

## 步骤

<div class="doc-steps">
  <div class="doc-step">
    <span class="doc-step__n">1</span>
    <div>
      <strong>配端点</strong>
      <p>添加上游并测试连通性。</p>
    </div>
  </div>
  <div class="doc-step">
    <span class="doc-step__n">2</span>
    <div>
      <strong>开代理</strong>
      <p>仪表盘打开本地代理开关。</p>
    </div>
  </div>
  <div class="doc-step">
    <span class="doc-step__n">3</span>
    <div>
      <strong>填地址</strong>
      <p>客户端 Base URL 指向本机端口。</p>
    </div>
  </div>
</div>

## 手风琴

::: details 本机地址怎么填？
默认 `http://127.0.0.1:3000`。改过设置里的端口时，以仪表盘显示为准。
:::

::: details 密钥要填吗？
本地代理默认不校验客户端密钥，可留空或填任意值。
:::

## 表格

| 模块 | 状态 | 说明 |
|------|------|------|
| 仪表盘 | 可用 | 启停代理与实时请求 |
| 端点管理 | 可用 | CRUD、点亮、映射 |
| 同步 | 可用 | 本地备份与 WebDAV |
