---
title: 用截图完成第一次接入
description: 图文 Tutorial：配置上游端点、启动本地代理、让第三方客户端拉取模型并对话。
meta:
  contentType: Tutorial
---

![ccMesh 简介](/screenshots/guide/01-intro.png)

## 第 1 步：配置上游端点

进入 **端点管理**，添加上游 API。

![端点管理](/screenshots/guide/02-endpoints.png)

按图中标注操作：

1. **新建端点**：点击右上角 **+ 新建端点**，填写名称、API 地址、密钥，并选择转换器（`claude` / `openai` / `codex`）。
2. **测试连通性**：保存后点击端点卡片上的测试按钮（绿色「可用」表示通过）。
3. **模型映射**：为端点配置入站 → 出站映射。
4. **可用模型（按端点）**：启动本地代理后，页面下方列出对外可获取的模型。

可以添加多个端点；存在快速队列时优先轮询其中成员。详见 [如何配置上游端点](/features/endpoints) 与 [轮换与熔断如何工作](/advanced/rotation)。

## 第 2 步：启动本地代理

进入 **仪表盘**，开启本地代理服务。

![仪表盘启动代理](/screenshots/guide/03-dashboard-start.png)

1. **点击开启端口**：打开 **本地代理** 开关，服务进入运行中（示例端口 `3000`）。这就是稍后填到客户端的地址。
2. **实时请求监控**：下方表格显示经网关的请求：时间、端点、入站/出站路径、状态、用时、首字延迟与 Token。

记住端口号，后面配置客户端时要用。

## 第 3 步：在客户端配置地址

打开支持自定义服务商的第三方客户端，新增本地代理服务商。

![客户端配置地址](/screenshots/guide/04-client-config.png)

1. **API 密钥**：本地代理默认不校验密钥，留空或填任意值。
2. **API 地址**：填写 `http://127.0.0.1:3000`（换成你的端口）。
3. **获取模型**：点击获取模型列表，从 ccMesh 拉取对外公布的模型。

## 第 4 步：选择模型并开始使用

获取成功后，客户端列出模型，按需勾选启用。

![客户端拉取到的模型](/screenshots/guide/05-client-models.png)

这些模型来自第 1 步配置的端点。在客户端对话，回到 [仪表盘](/features/dashboard) 可看实时请求记录。

## 用配置文件接管 Claude Code

若使用 **Claude Code**，可用 **配置文件** 生成或覆写 `settings.json`。逐步操作见 [如何用配置文件接入客户端](/features/config-profiles#claude-code)。

![配置文件：Claude Code](/screenshots/guide/06-config-profile.png)

## 客户端与供应商兼容

入站路径表与客户端 × 供应商矩阵以 [请求如何在协议间转换](/advanced/protocol-transform#入站路径与兼容矩阵) 为准。下图是同一矩阵的示意：

![API 格式转换矩阵](/screenshots/guide/07-api-matrix.png)
