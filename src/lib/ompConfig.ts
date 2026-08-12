// OMP 配置字段定义、解析、合并（表单 ↔ JSON 双向绑定）。
// OMP 文档字段：baseUrl/apiKey/api/headers/compat/remoteCompaction/authHeader/auth/discovery/models[]/disableStrictTools/transport
// + models[]（id/name/api/baseUrl/reasoning/thinking/input/supportsTools/cost/premiumMultiplier/contextWindow/maxTokens/omitMaxOutputTokens/headers/contextPromotionTarget/compactionModel/remoteCompaction）。
// compat 字段保留在 JSON 编辑器内，表单不管理。

import {
  asArray,
  asNumber,
  asObject,
  asString,
  detectSubTab,
  formatProviderJson,
  PI_OMP_INPUT_TYPES,
  type JsonObject,
  type PiOmpInputType,
} from "@/lib/piOmpCommon";

/** OMP 支持的 api 类型（含 OMP 独有的 google-gemini-cli，无 mistral-conversations / pi-messages）。 */
export const OMP_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "bedrock-converse-stream",
  "google-generative-ai",
  "google-gemini-cli",
  "google-vertex",
] as const;

export type OmpApiType = (typeof OMP_API_TYPES)[number];

/** OMP thinking.mode 取值。 */
export const OMP_THINKING_MODES = [
  "effort",
  "budget",
  "google-level",
  "anthropic-adaptive",
  "anthropic-budget-effort",
] as const;

/** OMP discovery.type 取值。 */
export const OMP_DISCOVERY_TYPES = [
  "proxy",
  "openai-models-list",
  "openai-compatible",
  "litellm",
  "ollama",
  "llama-cpp",
  "lm-studio",
] as const;

/** OMP thinking 对象。 */
export interface OmpThinking {
  mode: string;
  efforts: string[];
  effortMap: Record<string, string>;
  defaultLevel: string;
  supportsDisplay: boolean;
}

/** OMP discovery 对象。 */
export interface OmpDiscovery {
  type: string;
  timeoutMs: number | null;
}

/** OMP remoteCompaction 对象。 */
export interface OmpRemoteCompaction {
  enabled: boolean;
  api: string;
  endpoint: string;
  v2StreamingEnabled: boolean;
  v2Endpoint: string;
  streamingEndpoint: string;
  model: string;
}

/** OMP 单个模型的表单视图。 */
export interface OmpModelFields {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  thinking: OmpThinking | null;
  input: PiOmpInputType[];
  supportsTools: boolean | null;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  premiumMultiplier: number | null;
  contextWindow: number;
  maxTokens: number | null;
  omitMaxOutputTokens: boolean;
  headers: Record<string, string>;
  contextPromotionTarget: string;
  compactionModel: string;
  remoteCompaction: OmpRemoteCompaction | null;
}

/** OMP provider JSON 中表单可编辑的字段视图。 */
export interface OmpProviderFields {
  baseUrl: string;
  apiKey: string;
  api: string;
  headers: Record<string, string>;
  remoteCompaction: OmpRemoteCompaction | null;
  authHeader: boolean;
  auth: "apiKey" | "none" | "oauth";
  discovery: OmpDiscovery | null;
  models: OmpModelFields[];
  disableStrictTools: boolean;
  transport: string;
  subTab: "endpoint" | "custom";
}

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

export function emptyOmpModel(): OmpModelFields {
  return {
    id: "",
    name: "",
    api: "",
    baseUrl: "",
    reasoning: false,
    thinking: null,
    input: ["text"],
    supportsTools: null,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    premiumMultiplier: null,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    omitMaxOutputTokens: false,
    headers: {},
    contextPromotionTarget: "",
    compactionModel: "",
    remoteCompaction: null,
  };
}

function parseThinking(raw: unknown): OmpThinking | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as JsonObject;
  const effortsRaw = asArray(obj.efforts).filter((e): e is string => typeof e === "string");
  const effortMapRaw = asObject(obj.effortMap);
  const effortMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(effortMapRaw)) {
    if (typeof v === "string") effortMap[k] = v;
  }
  return {
    mode: asString(obj.mode),
    efforts: effortsRaw,
    effortMap,
    defaultLevel: asString(obj.defaultLevel),
    supportsDisplay: Boolean(obj.supportsDisplay),
  };
}

function parseDiscovery(raw: unknown): OmpDiscovery | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as JsonObject;
  const type = asString(obj.type);
  if (!type) return null;
  const timeoutMs = obj.timeoutMs;
  return {
    type,
    timeoutMs: typeof timeoutMs === "number" && Number.isFinite(timeoutMs) ? timeoutMs : null,
  };
}

function parseRemoteCompaction(raw: unknown): OmpRemoteCompaction | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as JsonObject;
  return {
    enabled: Boolean(obj.enabled),
    api: asString(obj.api),
    endpoint: asString(obj.endpoint),
    v2StreamingEnabled: Boolean(obj.v2StreamingEnabled),
    v2Endpoint: asString(obj.v2Endpoint),
    streamingEndpoint: asString(obj.streamingEndpoint),
    model: asString(obj.model),
  };
}

function parseHeaders(raw: unknown): Record<string, string> {
  const obj = asObject(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function parseInput(raw: unknown): PiOmpInputType[] {
  const arr = asArray(raw).filter((item): item is PiOmpInputType =>
    PI_OMP_INPUT_TYPES.includes(item as PiOmpInputType),
  );
  return arr.length > 0 ? arr : ["text"];
}

function parseAuth(raw: unknown): "apiKey" | "none" | "oauth" {
  const value = asString(raw);
  if (value === "none" || value === "oauth") return value;
  return "apiKey";
}

/** 把 provider JSON 中的单个 model 规整成表单视图；缺字段补默认。 */
export function normalizeOmpModel(raw: unknown): OmpModelFields {
  const model = asObject(raw);
  const costSource = asObject(model.cost);
  return {
    id: asString(model.id),
    name: asString(model.name) || asString(model.id),
    api: asString(model.api),
    baseUrl: asString(model.baseUrl),
    reasoning: Boolean(model.reasoning),
    thinking: parseThinking(model.thinking),
    input: parseInput(model.input),
    supportsTools:
      typeof model.supportsTools === "boolean" ? model.supportsTools : null,
    cost: {
      input: asNumber(costSource.input, 0),
      output: asNumber(costSource.output, 0),
      cacheRead: asNumber(costSource.cacheRead, 0),
      cacheWrite: asNumber(costSource.cacheWrite, 0),
    },
    premiumMultiplier:
      typeof model.premiumMultiplier === "number" && Number.isFinite(model.premiumMultiplier)
        ? model.premiumMultiplier
        : null,
    contextWindow: asNumber(model.contextWindow, DEFAULT_CONTEXT_WINDOW),
    maxTokens:
      typeof model.maxTokens === "number" && Number.isFinite(model.maxTokens)
        ? model.maxTokens
        : null,
    omitMaxOutputTokens: Boolean(model.omitMaxOutputTokens),
    headers: parseHeaders(model.headers),
    contextPromotionTarget: asString(model.contextPromotionTarget),
    compactionModel: asString(model.compactionModel),
    remoteCompaction: parseRemoteCompaction(model.remoteCompaction),
  };
}

/** 从 provider JSON 解析出表单字段视图。 */
export function parseOmpProviderFields(providerJson: unknown, gatewayUrl: string): OmpProviderFields {
  const provider = asObject(providerJson);
  const modelsRaw = asArray(provider.models);
  const baseUrl = asString(provider.baseUrl);
  return {
    baseUrl,
    apiKey: asString(provider.apiKey),
    api: asString(provider.api),
    headers: parseHeaders(provider.headers),
    remoteCompaction: parseRemoteCompaction(provider.remoteCompaction),
    authHeader: Boolean(provider.authHeader),
    auth: parseAuth(provider.auth),
    discovery: parseDiscovery(provider.discovery),
    models: modelsRaw.map(normalizeOmpModel),
    disableStrictTools: Boolean(provider.disableStrictTools),
    transport: asString(provider.transport),
    subTab: detectSubTab(baseUrl, gatewayUrl),
  };
}

function serializeThinking(thinking: OmpThinking | null): JsonObject | undefined {
  if (!thinking) return undefined;
  if (!thinking.mode && thinking.efforts.length === 0 && Object.keys(thinking.effortMap).length === 0 && !thinking.defaultLevel && !thinking.supportsDisplay) {
    return undefined;
  }
  const out: JsonObject = {};
  if (thinking.mode) out.mode = thinking.mode;
  if (thinking.efforts.length > 0) out.efforts = thinking.efforts;
  if (Object.keys(thinking.effortMap).length > 0) out.effortMap = thinking.effortMap;
  if (thinking.defaultLevel) out.defaultLevel = thinking.defaultLevel;
  if (thinking.supportsDisplay) out.supportsDisplay = true;
  return out;
}

function serializeDiscovery(discovery: OmpDiscovery | null): JsonObject | undefined {
  if (!discovery || !discovery.type) return undefined;
  const out: JsonObject = { type: discovery.type };
  if (discovery.timeoutMs !== null && Number.isFinite(discovery.timeoutMs)) {
    out.timeoutMs = discovery.timeoutMs;
  }
  return out;
}

function serializeRemoteCompaction(rc: OmpRemoteCompaction | null): JsonObject | undefined {
  if (!rc) return undefined;
  if (!rc.enabled && !rc.api && !rc.endpoint && !rc.v2Endpoint && !rc.streamingEndpoint && !rc.model && !rc.v2StreamingEnabled) {
    return undefined;
  }
  const out: JsonObject = {};
  if (rc.enabled) out.enabled = true;
  if (rc.api) out.api = rc.api;
  if (rc.endpoint) out.endpoint = rc.endpoint;
  if (rc.v2StreamingEnabled) out.v2StreamingEnabled = true;
  if (rc.v2Endpoint) out.v2Endpoint = rc.v2Endpoint;
  if (rc.streamingEndpoint) out.streamingEndpoint = rc.streamingEndpoint;
  if (rc.model) out.model = rc.model;
  return out;
}

function serializeHeaders(headers: Record<string, string>): JsonObject | undefined {
  const keys = Object.keys(headers);
  if (keys.length === 0) return undefined;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key && value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function serializeOmpModel(model: OmpModelFields): JsonObject {
  const out: JsonObject = { id: model.id };
  if (model.name && model.name !== model.id) out.name = model.name;
  if (model.api) out.api = model.api;
  if (model.baseUrl) out.baseUrl = model.baseUrl;
  if (model.reasoning) out.reasoning = true;
  const thinking = serializeThinking(model.thinking);
  if (thinking) out.thinking = thinking;
  if (model.input.length !== 1 || model.input[0] !== "text") out.input = model.input;
  if (model.supportsTools === false) out.supportsTools = false;
  const hasCost =
    model.cost.input || model.cost.output || model.cost.cacheRead || model.cost.cacheWrite;
  if (hasCost) out.cost = model.cost;
  if (model.premiumMultiplier !== null && Number.isFinite(model.premiumMultiplier)) {
    out.premiumMultiplier = model.premiumMultiplier;
  }
  if (model.contextWindow !== DEFAULT_CONTEXT_WINDOW) out.contextWindow = model.contextWindow;
  if (model.maxTokens !== null && model.maxTokens !== DEFAULT_MAX_TOKENS) {
    out.maxTokens = model.maxTokens;
  }
  if (model.omitMaxOutputTokens) out.omitMaxOutputTokens = true;
  const headers = serializeHeaders(model.headers);
  if (headers) out.headers = headers;
  if (model.contextPromotionTarget) out.contextPromotionTarget = model.contextPromotionTarget;
  if (model.compactionModel) out.compactionModel = model.compactionModel;
  const remoteCompaction = serializeRemoteCompaction(model.remoteCompaction);
  if (remoteCompaction) out.remoteCompaction = remoteCompaction;
  return out;
}

/**
 * 把表单字段合并回 provider JSON 对象，仅覆盖表单管理的键（baseUrl/apiKey/api/headers/remoteCompaction/authHeader/auth/discovery/models/disableStrictTools/transport），
 * 保留 compat/modelOverrides 等高级字段不动。
 */
export function applyFieldsToOmpProvider(providerJson: unknown, fields: OmpProviderFields): JsonObject {
  const base = asObject(providerJson);
  const next: JsonObject = { ...base };
  if (fields.baseUrl) next.baseUrl = fields.baseUrl;
  else delete next.baseUrl;
  if (fields.apiKey) next.apiKey = fields.apiKey;
  else delete next.apiKey;
  if (fields.api) next.api = fields.api;
  else delete next.api;
  const headers = serializeHeaders(fields.headers);
  if (headers) next.headers = headers;
  else delete next.headers;
  const remoteCompaction = serializeRemoteCompaction(fields.remoteCompaction);
  if (remoteCompaction) next.remoteCompaction = remoteCompaction;
  else delete next.remoteCompaction;
  if (fields.authHeader) next.authHeader = true;
  else delete next.authHeader;
  if (fields.auth !== "apiKey") next.auth = fields.auth;
  else delete next.auth;
  const discovery = serializeDiscovery(fields.discovery);
  if (discovery) next.discovery = discovery;
  else delete next.discovery;
  if (fields.disableStrictTools) next.disableStrictTools = true;
  else delete next.disableStrictTools;
  if (fields.transport) next.transport = fields.transport;
  else delete next.transport;
  next.models = fields.models.filter((m) => m.id.trim().length > 0).map(serializeOmpModel);
  return next;
}

export function addOmpModel(models: OmpModelFields[]): OmpModelFields[] {
  return [...models, emptyOmpModel()];
}

export function updateOmpModel(
  models: OmpModelFields[],
  index: number,
  patch: Partial<OmpModelFields>,
): OmpModelFields[] {
  return models.map((model, modelIndex) => (modelIndex === index ? { ...model, ...patch } : model));
}

export function removeOmpModel(models: OmpModelFields[], index: number): OmpModelFields[] {
  return models.filter((_, modelIndex) => modelIndex !== index);
}

export function toggleOmpModelInput(
  models: OmpModelFields[],
  index: number,
  inputType: PiOmpInputType,
  checked: boolean,
): OmpModelFields[] {
  return models.map((model, modelIndex) => {
    if (modelIndex !== index) return model;
    const set = new Set(model.input);
    set.add("text");
    if (checked) set.add(inputType);
    else if (inputType !== "text") set.delete(inputType);
    const nextInput = PI_OMP_INPUT_TYPES.filter((item) => set.has(item));
    return { ...model, input: nextInput };
  });
}

export function formatOmpProviderJson(providerJson: unknown): string {
  return formatProviderJson(providerJson);
}

export { parseProviderJsonText, formatProviderJson } from "@/lib/piOmpCommon";
