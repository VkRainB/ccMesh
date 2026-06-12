import type { ClaudeOperationFields } from "@/services/modules/tool_config";

/** ccMesh 本机网关地址：Claude 用裸地址，Codex 末尾补 `/v1`（与 Codex 模板一致）。 */
export function gatewayBaseUrl(port: number, appType: "claude" | "codex"): string {
  const base = `http://127.0.0.1:${port}`;
  return appType === "codex" ? `${base}/v1` : base;
}

/** 按 1M 开关组装模型名：勾选追加 `[1m]`，不勾选去掉。 */
export function withOneM(model: string, is1m: boolean): string {
  const m = model.trim();
  if (!m) return "";
  const bare = m.replace(/\[1m\]$/i, "");
  return is1m ? `${bare}[1m]` : bare;
}

/** 拆解模型名为基名 + 是否 1M。 */
export function splitOneM(model: string): { base: string; is1m: boolean } {
  const m = (model ?? "").trim();
  return { base: m.replace(/\[1m\]$/i, ""), is1m: /\[1m\]$/i.test(m) };
}

const CLAUDE_ENV_KEYS = {
  baseUrl: "ANTHROPIC_BASE_URL",
  apiKey: "ANTHROPIC_API_KEY",
  sonnetModel: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  opusModel: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  haikuModel: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  defaultModel: "ANTHROPIC_MODEL",
} as const;

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as JsonObject) } : {};
}

/**
 * 把 Claude 操作字段合并进基线快照（保留非操作字段），返回完整 settings.json 对象。
 * 与后端 `claude::merge_operation_fields` 等价（空字段 = 清除该 env 键）。
 */
export function mergeClaudeSettings(
  base: unknown,
  f: ClaudeOperationFields,
): JsonObject {
  const root = asObject(base);
  const env = asObject(root.env);
  const setOrRemove = (key: string, val: string) => {
    if (val) env[key] = val;
    else delete env[key];
  };
  setOrRemove(CLAUDE_ENV_KEYS.baseUrl, f.baseUrl);
  setOrRemove(CLAUDE_ENV_KEYS.apiKey, f.apiKey);
  setOrRemove(CLAUDE_ENV_KEYS.sonnetModel, f.sonnetModel);
  setOrRemove(CLAUDE_ENV_KEYS.opusModel, f.opusModel);
  setOrRemove(CLAUDE_ENV_KEYS.haikuModel, f.haikuModel);
  setOrRemove(CLAUDE_ENV_KEYS.defaultModel, f.defaultModel);
  root.env = env;
  return root;
}

/** 从 settings.json 快照解析 Claude 操作字段（用于初始化表单）。 */
export function parseClaudeFields(snapshot: unknown): ClaudeOperationFields {
  const env = asObject(asObject(snapshot).env);
  const get = (k: string) => (typeof env[k] === "string" ? (env[k] as string) : "");
  return {
    baseUrl: get(CLAUDE_ENV_KEYS.baseUrl),
    apiKey: get(CLAUDE_ENV_KEYS.apiKey),
    sonnetModel: get(CLAUDE_ENV_KEYS.sonnetModel),
    opusModel: get(CLAUDE_ENV_KEYS.opusModel),
    haikuModel: get(CLAUDE_ENV_KEYS.haikuModel),
    defaultModel: get(CLAUDE_ENV_KEYS.defaultModel),
  };
}

/** 仅操作字段构成的最小 env 片段（中间"操作字段编辑器"展示用）。 */
export function claudeOperationFragment(f: ClaudeOperationFields): JsonObject {
  return mergeClaudeSettings({}, f);
}

/** 安全格式化 JSON 文本；解析失败原样返回。 */
export function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Claude settings.json 快捷开关（字段映射对齐 cc-switch CommonConfigEditor）。 */
export interface ClaudeToggles {
  /** 隐藏 AI 署名：attribution={commit:"",pr:""} */
  hideAttribution: boolean;
  /** Teammates 模式：env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS="1" */
  teammates: boolean;
  /** 启用 Tool Search：env.ENABLE_TOOL_SEARCH="true" */
  toolSearch: boolean;
  /** 最大强度思考：env.CLAUDE_CODE_EFFORT_LEVEL="max" */
  effortMax: boolean;
  /** 禁用自动升级：env.DISABLE_AUTOUPDATER="1" */
  disableAutoUpdate: boolean;
}

export const DEFAULT_CLAUDE_TOGGLES: ClaudeToggles = {
  hideAttribution: false,
  teammates: false,
  toolSearch: false,
  effortMax: false,
  disableAutoUpdate: false,
};

export const CLAUDE_TOGGLE_DEFS: Array<{ key: keyof ClaudeToggles; label: string }> = [
  { key: "hideAttribution", label: "隐藏 AI 署名" },
  { key: "teammates", label: "Teammates 模式" },
  { key: "toolSearch", label: "启用 Tool Search" },
  { key: "effortMax", label: "最大强度思考" },
  { key: "disableAutoUpdate", label: "禁用自动升级" },
];

/** 从快照读取开关状态（用于回显）。 */
export function parseClaudeToggles(snapshot: unknown): ClaudeToggles {
  const root = asObject(snapshot);
  const env = asObject(root.env);
  const attribution = asObject(root.attribution);
  return {
    hideAttribution: attribution.commit === "" && attribution.pr === "",
    teammates:
      env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === "1" ||
      env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === 1,
    toolSearch:
      env.ENABLE_TOOL_SEARCH === "true" ||
      env.ENABLE_TOOL_SEARCH === "1" ||
      env.ENABLE_TOOL_SEARCH === true,
    effortMax: env.CLAUDE_CODE_EFFORT_LEVEL === "max",
    disableAutoUpdate:
      env.DISABLE_AUTOUPDATER === "1" || env.DISABLE_AUTOUPDATER === 1,
  };
}

/** 把开关状态写进完整 settings.json（在 mergeClaudeSettings 之后调用）。 */
export function applyClaudeToggles(settings: unknown, t: ClaudeToggles): JsonObject {
  const root = asObject(settings);
  if (t.hideAttribution) root.attribution = { commit: "", pr: "" };
  else delete root.attribution;
  const env = asObject(root.env);
  const setEnv = (k: string, on: boolean, v: string) => {
    if (on) env[k] = v;
    else delete env[k];
  };
  setEnv("CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS", t.teammates, "1");
  setEnv("ENABLE_TOOL_SEARCH", t.toolSearch, "true");
  setEnv("CLAUDE_CODE_EFFORT_LEVEL", t.effortMax, "max");
  setEnv("DISABLE_AUTOUPDATER", t.disableAutoUpdate, "1");
  root.env = env;
  return root;
}
