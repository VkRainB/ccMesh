/**
 * 模型映射弹窗「快捷添加」预设。
 * 改这里即可增删/换色；`from` 写入入站模型，出站由 UI 默认选第一个可用模型。
 * OpenAI 兼容项对齐 sub2api；Claude 项对齐 Anthropic models overview。
 */
export interface ModelMappingPreset {
  /** 芯片上显示的文案 */
  label: string;
  /** 入站模型名（客户端请求名） */
  from: string;
  /** Tailwind 类：背景/文字/悬停（含 dark） */
  color: string;
}

export const MODEL_MAPPING_PRESETS: ModelMappingPreset[] = [
  {
    label: "GPT-5.6 Sol",
    from: "gpt-5.6-sol",
    color:
      "bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-400",
  },
  {
    label: "GPT-5.6 Terra",
    from: "gpt-5.6-terra",
    color:
      "bg-lime-100 text-lime-700 hover:bg-lime-200 dark:bg-lime-900/30 dark:text-lime-400",
  },
  {
    label: "GPT-5.6 Luna",
    from: "gpt-5.6-luna",
    color:
      "bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-900/30 dark:text-sky-400",
  },
  {
    label: "GPT-5.5",
    from: "gpt-5.5",
    color:
      "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400",
  },
  {
    label: "Fable",
    from: "claude-fable-5",
    color:
      "bg-rose-100 text-rose-700 hover:bg-rose-200 dark:bg-rose-900/30 dark:text-rose-400",
  },
  {
    label: "Opus",
    from: "claude-opus-5",
    color:
      "bg-purple-100 text-purple-700 hover:bg-purple-200 dark:bg-purple-900/30 dark:text-purple-400",
  },
  {
    label: "Sonnet",
    from: "claude-sonnet-5",
    color:
      "bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400",
  },
  {
    label: "Haiku",
    from: "claude-haiku-4-5",
    color:
      "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400",
  },
];
