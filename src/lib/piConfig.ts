// Pi 配置字段定义、解析、合并（表单 ↔ JSON 双向绑定）。
// Pi 文档字段：name/baseUrl/api/apiKey/oauth/headers/authHeader + models[]（id/name/api/baseUrl/reasoning/thinkingLevelMap/input/cost/cost.tiers/contextWindow/maxTokens/samplingParams/headers）。
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

/** Pi 支持的 api 类型（含 Pi 独有的 mistral-conversations / pi-messages）。 */
export const PI_API_TYPES = [
  "openai-completions",
  "openai-responses",
  "openai-codex-responses",
  "azure-openai-responses",
  "anthropic-messages",
  "mistral-conversations",
  "google-generative-ai",
  "google-vertex",
  "bedrock-converse-stream",
  "pi-messages",
] as const;

export type PiApiType = (typeof PI_API_TYPES)[number];

/** Pi 思考档位：off/minimal/low/medium/high/xhigh/max，值为 string 或 null（null=隐藏该档）。 */
export const PI_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type PiThinkingLevel = (typeof PI_THINKING_LEVELS)[number];

const DEFAULT_CONTEXT_WINDOW = 128000;
const DEFAULT_MAX_TOKENS = 16384;

/** Pi cost.tiers 单条分层价格。 */
export interface PiCostTier {
  inputTokensAbove: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Pi 单个模型的表单视图。 */
export interface PiModelFields {
  id: string;
  name: string;
  api: string;
  baseUrl: string;
  reasoning: boolean;
  thinkingLevelMap: Record<string, string | null>;
  input: PiOmpInputType[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costTiers: PiCostTier[];
  contextWindow: number;
  maxTokens: number;
  samplingParams: Record<string, unknown>;
  headers: Record<string, string>;
}

/** Pi provider JSON 中表单可编辑的字段视图。 */
export interface PiProviderFields {
  name: string;
  api: string;
  baseUrl: string;
  apiKey: string;
  oauth: string;
  headers: Record<string, string>;
  authHeader: boolean;
  models: PiModelFields[];
  subTab: "endpoint" | "custom";
}

export function emptyPiModel(): PiModelFields {
  return {
    id: "",
    name: "",
    api: "",
    baseUrl: "",
    reasoning: false,
    thinkingLevelMap: {},
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    costTiers: [],
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_TOKENS,
    samplingParams: {},
    headers: {},
  };
}

function parseThinkingLevelMap(raw: unknown): Record<string, string | null> {
  const obj = asObject(raw);
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out[key] = value;
    else if (value === null) out[key] = null;
  }
  return out;
}

function parseHeaders(raw: unknown): Record<string, string> {
  const obj = asObject(raw);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

function parseSamplingParams(raw: unknown): Record<string, unknown> {
  const obj = asObject(raw);
  return { ...obj };
}

function parseCostTiers(raw: unknown): PiCostTier[] {
  return asArray(raw)
    .map((item) => {
      const obj = asObject(item);
      return {
        inputTokensAbove: asNumber(obj.inputTokensAbove, 0),
        input: asNumber(obj.input, 0),
        output: asNumber(obj.output, 0),
        cacheRead: asNumber(obj.cacheRead, 0),
        cacheWrite: asNumber(obj.cacheWrite, 0),
      };
    })
    .filter((tier) => tier.inputTokensAbove > 0 || tier.input || tier.output);
}

function parseInput(raw: unknown): PiOmpInputType[] {
  const arr = asArray(raw).filter((item): item is PiOmpInputType =>
    PI_OMP_INPUT_TYPES.includes(item as PiOmpInputType),
  );
  return arr.length > 0 ? arr : ["text"];
}

/** 把 provider JSON 中的单个 model 规整成表单视图；缺字段补默认。 */
export function normalizePiModel(raw: unknown): PiModelFields {
  const model = asObject(raw);
  const costSource = asObject(model.cost);
  return {
    id: asString(model.id),
    name: asString(model.name) || asString(model.id),
    api: asString(model.api),
    baseUrl: asString(model.baseUrl),
    reasoning: Boolean(model.reasoning),
    thinkingLevelMap: parseThinkingLevelMap(model.thinkingLevelMap),
    input: parseInput(model.input),
    cost: {
      input: asNumber(costSource.input, 0),
      output: asNumber(costSource.output, 0),
      cacheRead: asNumber(costSource.cacheRead, 0),
      cacheWrite: asNumber(costSource.cacheWrite, 0),
    },
    costTiers: parseCostTiers(costSource.tiers),
    contextWindow: asNumber(model.contextWindow, DEFAULT_CONTEXT_WINDOW),
    maxTokens: asNumber(model.maxTokens, DEFAULT_MAX_TOKENS),
    samplingParams: parseSamplingParams(model.samplingParams),
    headers: parseHeaders(model.headers),
  };
}

/** 从 provider JSON 解析出表单字段视图。 */
export function parsePiProviderFields(providerJson: unknown, gatewayUrl: string): PiProviderFields {
  const provider = asObject(providerJson);
  const modelsRaw = asArray(provider.models);
  const baseUrl = asString(provider.baseUrl);
  return {
    name: asString(provider.name),
    api: asString(provider.api),
    baseUrl,
    apiKey: asString(provider.apiKey),
    oauth: asString(provider.oauth),
    headers: parseHeaders(provider.headers),
    authHeader: Boolean(provider.authHeader),
    models: modelsRaw.map(normalizePiModel),
    subTab: detectSubTab(baseUrl, gatewayUrl),
  };
}

function serializeThinkingLevelMap(map: Record<string, string | null>): JsonObject | undefined {
  const keys = Object.keys(map);
  if (keys.length === 0) return undefined;
  const out: JsonObject = {};
  for (const [key, value] of Object.entries(map)) {
    if (value === null) out[key] = null;
    else if (typeof value === "string" && value.length > 0) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

function serializeSamplingParams(params: Record<string, unknown>): JsonObject | undefined {
  const keys = Object.keys(params);
  if (keys.length === 0) return undefined;
  return { ...params };
}

function serializeCostTiers(tiers: PiCostTier[]): unknown[] | undefined {
  if (tiers.length === 0) return undefined;
  return tiers;
}

function serializePiModel(model: PiModelFields): JsonObject {
  const out: JsonObject = { id: model.id };
  if (model.name && model.name !== model.id) out.name = model.name;
  if (model.api) out.api = model.api;
  if (model.baseUrl) out.baseUrl = model.baseUrl;
  if (model.reasoning) out.reasoning = true;
  const thinkingLevelMap = serializeThinkingLevelMap(model.thinkingLevelMap);
  if (thinkingLevelMap) out.thinkingLevelMap = thinkingLevelMap;
  if (model.input.length !== 1 || model.input[0] !== "text") out.input = model.input;
  if (model.contextWindow !== DEFAULT_CONTEXT_WINDOW) out.contextWindow = model.contextWindow;
  if (model.maxTokens !== DEFAULT_MAX_TOKENS) out.maxTokens = model.maxTokens;
  const hasCost =
    model.cost.input || model.cost.output || model.cost.cacheRead || model.cost.cacheWrite;
  if (hasCost) {
    const cost: JsonObject = { ...model.cost };
    const tiers = serializeCostTiers(model.costTiers);
    if (tiers) cost.tiers = tiers;
    out.cost = cost;
  } else if (model.costTiers.length > 0) {
    out.cost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, tiers: model.costTiers };
  }
  const samplingParams = serializeSamplingParams(model.samplingParams);
  if (samplingParams) out.samplingParams = samplingParams;
  const headers = serializeHeaders(model.headers);
  if (headers) out.headers = headers;
  return out;
}

/**
 * 把表单字段合并回 provider JSON 对象，仅覆盖表单管理的键（name/api/baseUrl/apiKey/oauth/headers/authHeader/models），
 * 保留 compat/modelOverrides 等高级字段不动。
 */
export function applyFieldsToPiProvider(providerJson: unknown, fields: PiProviderFields): JsonObject {
  const base = asObject(providerJson);
  const next: JsonObject = { ...base };
  if (fields.name) next.name = fields.name;
  else delete next.name;
  if (fields.api) next.api = fields.api;
  else delete next.api;
  if (fields.baseUrl) next.baseUrl = fields.baseUrl;
  else delete next.baseUrl;
  if (fields.apiKey) next.apiKey = fields.apiKey;
  else delete next.apiKey;
  if (fields.oauth) next.oauth = fields.oauth;
  else delete next.oauth;
  const headers = serializeHeaders(fields.headers);
  if (headers) next.headers = headers;
  else delete next.headers;
  if (fields.authHeader) next.authHeader = true;
  else delete next.authHeader;
  next.models = fields.models.filter((m) => m.id.trim().length > 0).map(serializePiModel);
  return next;
}

export function addPiModel(models: PiModelFields[]): PiModelFields[] {
  return [...models, emptyPiModel()];
}

export function updatePiModel(
  models: PiModelFields[],
  index: number,
  patch: Partial<PiModelFields>,
): PiModelFields[] {
  return models.map((model, modelIndex) => (modelIndex === index ? { ...model, ...patch } : model));
}

export function removePiModel(models: PiModelFields[], index: number): PiModelFields[] {
  return models.filter((_, modelIndex) => modelIndex !== index);
}

export function togglePiModelInput(
  models: PiModelFields[],
  index: number,
  inputType: PiOmpInputType,
  checked: boolean,
): PiModelFields[] {
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

export function formatPiProviderJson(providerJson: unknown): string {
  return formatProviderJson(providerJson);
}

export { parseProviderJsonText, formatProviderJson } from "@/lib/piOmpCommon";
