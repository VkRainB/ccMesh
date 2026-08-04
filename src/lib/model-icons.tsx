import type { ComponentType } from "react";
import { Cpu } from "lucide-react";
import {
  Aws,
  Azure,
  Cerebras,
  Claude,
  Cloudflare,
  Cohere,
  DeepSeek,
  Doubao,
  Fireworks,
  Gemma,
  Gemini,
  Google,
  Grok,
  Groq,
  HuggingFace,
  Hunyuan,
  InternLM,
  Kimi,
  KwaiKAT,
  Meta,
  Microsoft,
  Minimax,
  Mistral,
  Nvidia,
  Novita,
  Ollama,
  OpenAI,
  OpenRouter,
  Perplexity,
  Qwen,
  Replicate,
  SambaNova,
  SiliconCloud,
  Spark,
  Stepfun,
  Together,
  Volcengine,
  Wenxin,
  XiaomiMiMo,
  Yi,
  Zhipu,
} from "@lobehub/icons";

/** @lobehub/icons 每个品牌是 CompoundedIcon：默认=Mono 单色，.Color=彩色纯图标（品牌色，无背景圆），.Avatar=带背景圆头像。这里用 .Color 彩色图标。 */
type IconComponent = ComponentType<{ size?: number; className?: string }>;

type ModelIconConfig = {
  prefixes: string[];
  Icon: IconComponent;
};

/** 模型名前缀 → 品牌彩色图标映射（覆盖 40 组品牌前缀）。 */
const MODEL_ICON_PATTERNS: ModelIconConfig[] = [
  // OpenAI - GPT series（OpenAI 无 Color 组件，用默认 Mono）
  { prefixes: ["gpt-", "o1", "o3", "o4", "chatgpt", "text-embedding", "dall-e", "openai", "codex"], Icon: OpenAI },
  // Anthropic - Claude series
  { prefixes: ["claude", "anthropic"], Icon: Claude.Color },
  // Google - Gemini / Gemma / PaLM
  { prefixes: ["gemini"], Icon: Gemini.Color },
  { prefixes: ["gemma"], Icon: Gemma.Color },
  { prefixes: ["palm", "google"], Icon: Google.Color },
  // DeepSeek
  { prefixes: ["deepseek"], Icon: DeepSeek.Color },
  // xAI - Grok（无 Color，用默认 Mono）
  { prefixes: ["grok", "xai"], Icon: Grok },
  // Alibaba - Qwen
  { prefixes: ["qwen", "qwq", "alibaba"], Icon: Qwen.Color },
  // Zhipu - GLM
  { prefixes: ["glm", "chatglm", "zhipu", "z-ai"], Icon: Zhipu.Color },
  // MiniMax
  { prefixes: ["minimax", "abab"], Icon: Minimax.Color },
  // Moonshot / Kimi
  { prefixes: ["moonshot", "kimi"], Icon: Kimi.Color },
  // Mistral
  { prefixes: ["mistral", "mixtral", "codestral", "pixtral"], Icon: Mistral.Color },
  // Meta - Llama
  { prefixes: ["llama", "meta-llama", "meta"], Icon: Meta.Color },
  // ByteDance - Doubao
  { prefixes: ["doubao", "skylark", "bytedance"], Icon: Doubao.Color },
  // Yi (01-ai)
  { prefixes: ["yi-", "01-ai"], Icon: Yi.Color },
  // Tencent - Hunyuan
  { prefixes: ["hunyuan"], Icon: Hunyuan.Color },
  // iFlytek - Spark
  { prefixes: ["spark"], Icon: Spark.Color },
  // Baidu - ERNIE / Wenxin
  { prefixes: ["ernie", "wenxin", "baidu"], Icon: Wenxin.Color },
  // InternLM
  { prefixes: ["internlm"], Icon: InternLM.Color },
  // Stepfun
  { prefixes: ["stepfun", "step-"], Icon: Stepfun.Color },
  // Cloud providers
  { prefixes: ["nvidia", "nemotron"], Icon: Nvidia.Color },
  { prefixes: ["azure"], Icon: Azure.Color },
  { prefixes: ["aws", "amazon", "bedrock"], Icon: Aws.Color },
  { prefixes: ["volcengine"], Icon: Volcengine.Color },
  { prefixes: ["siliconflow"], Icon: SiliconCloud.Color },
  // Inference providers
  { prefixes: ["groq"], Icon: Groq },
  { prefixes: ["together"], Icon: Together.Color },
  { prefixes: ["fireworks"], Icon: Fireworks.Color },
  { prefixes: ["replicate"], Icon: Replicate },
  { prefixes: ["ollama"], Icon: Ollama },
  { prefixes: ["openrouter"], Icon: OpenRouter },
  { prefixes: ["cloudflare"], Icon: Cloudflare.Color },
  { prefixes: ["cerebras"], Icon: Cerebras.Color },
  { prefixes: ["sambanova"], Icon: SambaNova.Color },
  { prefixes: ["novita"], Icon: Novita.Color },
  { prefixes: ["huggingface", "hf"], Icon: HuggingFace.Color },
  // Other models
  { prefixes: ["cohere", "command"], Icon: Cohere.Color },
  { prefixes: ["perplexity"], Icon: Perplexity.Color },
  { prefixes: ["phi-"], Icon: Microsoft.Color },
  { prefixes: ["kat"], Icon: KwaiKAT },
  // Xiaomi - MiMo
  { prefixes: ["mimo"], Icon: XiaomiMiMo },
];

const DEFAULT_ICON = Cpu;

/**
 * 按模型名前缀匹配品牌彩色图标（无背景圆，纯图标）。
 * 含 `/` 时取最后一段再匹配（如 `anthropic/claude-3-5-haiku` → `claude-3-5-haiku`）。
 * 未匹配回退 lucide Cpu 图标。
 */
export function getModelIcon(modelName: string): IconComponent {
  const nameToMatch = modelName.includes("/") ? modelName.split("/").pop()! : modelName;
  const lowerName = nameToMatch.toLowerCase();
  for (const { prefixes, Icon } of MODEL_ICON_PATTERNS) {
    if (prefixes.some((prefix) => lowerName.startsWith(prefix))) {
      return Icon;
    }
  }
  return DEFAULT_ICON;
}
