# 协议转换

协议转换是 ccMesh 屏蔽上游差异的关键：客户端只用一种协议，ccMesh 按端点的转换器类型把请求 / 响应改写为上游所需的格式。

## 三类转换器

| 转换器 | 上游协议 | 说明 |
|--------|----------|------|
| `claude` | Anthropic Messages | **直通**，请求原样转发 |
| `openai` | OpenAI Chat Completions | 在 Anthropic 与 OpenAI 协议间互转 |
| `codex` | Codex / Responses | 面向 Responses 协议的转换 |

转换器在每个端点上单独配置，见 [端点管理](../features/endpoints)。

## 转换涉及的处理

ccMesh 后端 `modules/transform/` 包含一组协作的转换组件：

- **claude ↔ openai 互转**：请求体 / 响应体在 Anthropic Messages 与 OpenAI Chat Completions 之间的结构映射。
- **Responses ↔ Chat 转换**：面向 Codex / Responses 协议形态的转换。
- **流式处理（streaming）**：对 SSE 流式响应做边解析边转换、边回传，保证首字延迟与逐段输出体验。
- **reasoning effort**：推理强度等参数在不同协议间的传递与映射。
- **thinking rectifier**：对「思考 / reasoning」内容片段做规整，保证下游协议一致性。
- **JSON canonical**：请求体的规范化处理。

## 模型映射在转换中的位置

转换发生时会结合端点的 **模型映射**：

1. 客户端用 **入站模型名** 发起请求。
2. 路由匹配后，按 `from → to` 把模型名改写为上游 **出站模型名**。
3. 若端点设置了 **锁定模型**，则强制以锁定模型覆盖客户端请求的 model。
4. 转换器把请求体改写为上游协议格式后转发。

详见 [核心概念 · 模型映射](../guide/concepts#模型映射-model-mapping)。

## 流式响应

ccMesh 对上游的流式（SSE）响应做实时转换并回传，因此在 [仪表盘](../features/dashboard) 的实时请求监控中可以看到 **首字延迟（TTFT）** 等指标。流式转换确保即使在协议互转的情况下，客户端依然能获得逐段输出体验。

## 选择正确的转换器

- 上游文档说明是 Anthropic / Claude Messages 接口 → 选 `claude`。
- 上游是 OpenAI 兼容的 `chat/completions` 接口 → 选 `openai`。
- 上游是 Codex / Responses 接口 → 选 `codex`。

转换器与上游实际协议不匹配会导致请求失败，可用端点的 [连通性测试](../features/endpoints#连通性测试) 快速验证。
