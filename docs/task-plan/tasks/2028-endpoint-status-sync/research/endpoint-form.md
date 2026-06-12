# Research: 端点新建/编辑表单（api_url 输入辅助提示 + 防止多余 /v1 结尾）

- Query: 端点表单组件结构、api_url 输入与校验现状、transformer 选项联动、刷新模型按钮、现有 helper text 模式、各 transformer 真实请求路径后缀
- Scope: internal
- Date: 2026-06-12

## 结论（先给答案）

端点表单是单组件 `src/pages/Endpoints/_components/EndpointForm.tsx`，受控 `useState`（无 react-hook-form），api_url 输入框由字段数组循环渲染、**当前无任何格式校验与辅助提示**；transformer 是 shadcn Select，选项值 `claude / openai / codex`，与 `form.transformer` 直接联动。后端所有出网点统一 `api_url.trim_end_matches('/')` 后**追加含 `/v1` 的完整后缀**（claude→`/v1/messages`、openai→`/v1/chat/completions`、codex→`/v1/responses`、拉模型→`/v1/models`），因此 api_url 以 `/v1` 结尾会产生 `/v1/v1/...` 双重前缀——后端目前**没有**对此做规整，需要前端提示/规整。项目已有成熟 helper text 模式：`<p className="px-1 text-xs text-ink-mute">例如 ...</p>`（Settings 页代理地址下方），可直接复用。

## Findings

### 1. 相关文件

| 文件路径 | 作用 |
| --- | --- |
| `src/pages/Endpoints/_components/EndpointForm.tsx` | 端点新建/编辑表单（Dialog + 表单/JSON 双 Tab），api_url 输入、transformer 选择、刷新模型按钮全在此 |
| `src/services/modules/endpoint.ts` | 前端 endpoint API 封装，`fetchModels` 调 Tauri 命令 `fetch_endpoint_models` |
| `src/pages/Endpoints/index.tsx` | 列表页，管理 `EndpointForm` 的 open/editing 状态 |
| `src-tauri/src/modules/proxy/forward.rs` | 网关转发：决定 upstream_path 并拼接 `base + path` |
| `src-tauri/src/commands/endpoint.rs` | `test_endpoint`：按 transformer 拼接测试 URL |
| `src-tauri/src/modules/models_cache.rs` | `fetch_model_ids`：拼接 `{base}/v1/models` 拉模型 |
| `src-tauri/src/modules/transform/transformer.rs` | `UpstreamFormat::from_transformer_name`：transformer 字符串 → 格式枚举 |
| `src/pages/Settings/index.tsx` | helper text 既有样式参考（L234） |

### 2. 表单组件结构与 api_url 输入框

**状态管理**：纯受控 `useState<FormState>`，无 react-hook-form / zod。`EndpointForm.tsx:31-51`：

```ts
interface FormState {
  name: string; apiUrl: string; apiKey: string; transformer: string;
  model: string; models: string[]; useProxy: boolean; remark: string;
}
const EMPTY: FormState = { ..., transformer: "claude", ... };
```

- 统一更新入口 `update(patch)`（L91-96），同时同步 JSON Tab 的 `jsonText`；单字段走 `set(k, v)`（L98-99）。**任何 apiUrl 规整逻辑应走 `update`/`set`，否则 JSON Tab 会不同步。**
- api_url 输入框由字段数组循环渲染，`EndpointForm.tsx:143-149`：

```ts
const fields = [
  { k: "name", label: "名称" },
  { k: "apiUrl", label: "API URL", ph: "https://api.anthropic.com" },
  ...
];
```

  渲染在 L165-201 的 `fields.map` 通用分支（L192-198 普通 `<Input>`）。**注意**：要给 apiUrl 单独加 hint，需在 map 内按 `f.k === "apiUrl"` 特判，或把 apiUrl 拆出循环单独渲染。
- **当前校验**：仅保存按钮 disabled 条件 `!form.name || !form.apiUrl`（L315），无 URL 格式校验、无 `/v1` 结尾检测、无任何辅助文案。
- JSON Tab 有错误提示先例：`{jsonErr ? <p className="mt-1 text-xs text-destructive">{jsonErr}</p> : null}`（L305），可作"警告级提示"样式参考。
- 后端 create/update 也**无** api_url 规整：`endpoint_repo.rs` 原样入库，仅各使用点 `trim_end_matches('/')`。

### 3. transformer 选择控件

`EndpointForm.tsx:203-215`，shadcn Select，受控于 `form.transformer`：

```tsx
<Select value={form.transformer} onValueChange={(v) => set("transformer", v)}>
  ...
  <SelectItem value="claude">claude（直通）</SelectItem>
  <SelectItem value="openai">openai（转换）</SelectItem>
  <SelectItem value="codex">codex（Responses）</SelectItem>
```

选项值即存库值。后端枚举映射 `transformer.rs:16-20` 还接受别名（`openai_chat/openai-chat/openai2`→OpenAiChat；`openai_responses/openai-responses`→OpenAiResponses；其余一律 Claude），但 UI 只产出三个标准值。**实现动态 hint 时直接依赖 `form.transformer` 即可，切换 Select 会触发重渲染，hint 自动联动。**

### 4. 刷新模型按钮

`EndpointForm.tsx:243-252`：模型清单区第二个 icon Button（`RefreshCwIcon`），`disabled={refresh.isPending || !form.apiUrl}`。mutation 在 L110-119：

```ts
mutationFn: () => endpointApi.fetchModels(form.apiUrl, form.apiKey, form.transformer, form.useProxy)
```

→ `endpoint.ts:88-99` invoke `fetch_endpoint_models`（按字段传参，支持未保存端点）→ `commands/models.rs:75` → `models_cache.rs:26-59 fetch_model_ids`，内部 `{base}/v1/models`。**若用户填了 `.../v1`，刷新模型会请求 `/v1/v1/models` 直接失败（静默返回空列表）**——这也是该需求的一个隐性痛点。

### 5. 各 transformer 真实请求路径后缀（Rust 侧证据）

**统一规则：所有出网 URL = `api_url.trim_end_matches('/')` + 含 `/v1` 的完整后缀。**

a) 网关转发 `forward.rs:418-422` + `forward.rs:621-622`：

```rust
let upstream_path = if needs_transform || responses_to_chat {
    "/v1/chat/completions"
} else {
    path.as_str()   // 透传入站路径
};
// send_upstream:
let base = ep.api_url.trim_end_matches('/');
let url = format!("{base}{upstream_path}");
```

透传分支的入站路径本身含 `/v1`（Claude 客户端打 `/v1/messages`，codex 打 `/v1/responses`，OpenAI 打 `/v1/chat/completions`，见 `forward.rs:247-249` 入站识别与 `server.rs:68-76` fallback 路由）。

b) 连通性测试 `commands/endpoint.rs:132,149-188`：

```rust
let base = ep.api_url.trim_end_matches('/');
UpstreamFormat::OpenAiChat      => format!("{base}/v1/chat/completions"),
UpstreamFormat::OpenAiResponses => format!("{base}/v1/responses"),
UpstreamFormat::Claude          => format!("{base}/v1/messages"),
```

c) 拉模型 `models_cache.rs:32-33`：`format!("{base}/v1/models")`（三种 transformer 通用）。

**辅助文字建议展示的完整 URL 映射**：

| transformer | 主请求路径 | 拉模型路径 |
| --- | --- | --- |
| claude | `<api_url>/v1/messages` | `<api_url>/v1/models` |
| openai | `<api_url>/v1/chat/completions` | `<api_url>/v1/models` |
| codex | `<api_url>/v1/responses` | `<api_url>/v1/models` |

### 6. 可复用的 helper text UI 模式

项目无独立 FormDescription/HelperText 组件，惯用裸 `<p>` + Tailwind 类：

- **输入框下方示例文案**（最贴合本需求）：`src/pages/Settings/index.tsx:234`
  `<p className="px-1 text-xs text-ink-mute">例如 127.0.0.1:7897 或 http://proxy:8080</p>`
- 段落说明：`ModelMappingDialog.tsx:78-80` `<p className="text-xs text-ink-mute">...`
- 错误/警告：`EndpointForm.tsx:305` `text-xs text-destructive`
- Label 行内附注：`EndpointForm.tsx:220` `<span className="text-xs text-ink-mute">`

## 可复用点小结

1. hint 样式直接复制 Settings:234 的 `px-1 text-xs text-ink-mute` 模式；警告态用 `text-destructive`。
2. 动态完整 URL 预览只需 `form.apiUrl` + `form.transformer` 两个已有 state，后缀映射表可在前端硬编码（与 Rust 三处证据一致）。
3. `/v1` 结尾检测可在保存前于 `save.mutate()` 前置规整或仅提示；若做自动规整需经 `update()` 以同步 JSON Tab。
4. apiUrl 字段需从 `fields.map` 通用渲染中特判/拆出，才能在其下插入 hint。

## Caveats / 未找到

- 后端（create/update/forward）均未对 api_url 结尾 `/v1` 做规整或告警，纯靠用户填对；本需求若只改前端，JSON Tab 直接编辑 apiUrl 仍可绕过提示。
- `forward.rs` 透传分支依赖客户端入站路径，若客户端打非标准路径（fallback 路由接所有路径），实际后缀即客户端路径，hint 中"claude 直通 → /v1/messages"是主流场景的近似表述。
- 项目无表单库（react-hook-form/zod 均未引入，已查 package.json 依赖使用情况——表单全部手写受控 state），不建议为此需求引入。
