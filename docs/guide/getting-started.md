# 快速上手

本节带你用几分钟完成从「打开应用」到「客户端成功调用」的最小闭环。

## 1. 启动代理服务

打开 ccMesh，进入 **仪表盘**。点击启动按钮开启本地代理服务，记下监听端口（默认本机回环地址）。服务状态、端口会在卡片中实时显示。

详见 [仪表盘](../features/dashboard)。

## 2. 添加一个端点

进入 **端点管理**，点击新增端点，填写：

- **名称**：便于识别的别名。
- **API URL**：上游基础地址。
- **API Key**：上游密钥（界面会脱敏显示）。
- **转换器**：选择上游协议类型
  - `claude` — 直通（上游本身是 Anthropic Messages 协议）
  - `openai` — 转换（上游是 OpenAI Chat Completions 协议）
  - `codex` — Responses（上游是 Codex / Responses 协议）
- **模型 / 模型映射**：按需配置对外暴露的模型清单与入站 → 出站映射。

保存后可点击 **连通性测试** 验证端点是否可用。详见 [端点管理](../features/endpoints)。

## 3. 让客户端指向 ccMesh

把你的 AI 工具的 Base URL 指向 ccMesh 的本地代理地址。最便捷的方式是用 **配置文件** 模块：

- 它能以「渠道」形式直接生成 / 覆写 Claude Code 的 `settings.json` 与 Codex 的 `auth.json` + `config.toml`。
- 应用渠道前会自动备份原配置。

详见 [配置文件](../features/config-profiles)。

> 也可手动把客户端的 `ANTHROPIC_BASE_URL` / OpenAI Base URL 等环境变量指向 ccMesh 的本地端口。

## 4. 发起请求并观察

在客户端正常发起一次对话请求，回到 **仪表盘** 的实时请求监控，应能看到这条请求的模型、耗时、首字延迟与 Token 明细。

随后可在 **统计** 中按应用 / 端点 / 模型维度查看累计用量。

## 5. （可选）配置同步

在 **同步** 中对配置与数据做本地备份，或配置 WebDAV 实现跨设备同步。详见 [同步](../features/sync)。

## 常见下一步

- 多个上游想自动轮换、故障自动切换？了解 [轮换与熔断](../advanced/rotation)。
- 想知道协议是怎么转换的？了解 [协议转换](../advanced/protocol-transform)。
- 需要全局出站代理或修改 CLI UA？前往 [设置](../features/settings)。
