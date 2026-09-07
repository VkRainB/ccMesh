import type { UnlistenFn } from "@tauri-apps/api/event";

import { Events, request, subscribe } from "../request";

/** 单条模型映射：入站模型名 from → 出站（上游真实）模型名 to。 */
export interface ModelMapping {
  from: string;
  to: string;
}

export interface Endpoint {
  id: number;
  name: string;
  apiUrl: string;
  apiKey: string;
  authMode: string;
  enabled: boolean;
  useProxy: boolean;
  transformer: string;
  model: string;
  models: string[];
  /** 点亮（对外公布）的模型子集：`models` 的子集。空数组=全部公布（向后兼容旧端点）。 */
  activeModels: string[];
  modelMappings: ModelMapping[];
  /** 是否启用模型映射；关闭时保留配置但不公布入站别名、不改写出站。 */
  modelMappingsEnabled: boolean;
  remark: string;
  sortOrder: number;
  fast: boolean;
  fastSortOrder: number;
  testStatus: string;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
}

export interface CreateEndpointRequest {
  name: string;
  apiUrl: string;
  apiKey?: string;
  authMode?: string;
  enabled?: boolean;
  useProxy?: boolean;
  transformer?: string;
  model?: string;
  models?: string[];
  activeModels?: string[];
  modelMappings?: ModelMapping[];
  modelMappingsEnabled?: boolean;
  remark?: string;
  fast?: boolean;
}

export type UpdateEndpointRequest = Partial<CreateEndpointRequest>;

/** 出站（真实）模型：锁定 model 优先，否则 models 清单。用于测试连通性。 */
export function outboundModels(
  ep: Pick<Endpoint, "model" | "models">,
): string[] {
  return ep.model ? [ep.model] : ep.models ?? [];
}

/**
 * 点亮过滤后的出站（真实）模型：用于模型映射出站下拉，受点亮模型行为影响。
 * 锁定 model→[model]；否则 activeModels 非空→按 models 顺序取其点亮子集；空→全部 models（兼容旧端点）。
 */
export function litOutboundModels(
  ep: Pick<Endpoint, "model" | "models" | "activeModels">,
): string[] {
  if (ep.model) return [ep.model];
  const models = ep.models ?? [];
  const active = ep.activeModels ?? [];
  if (active.length === 0) return models;
  const activeSet = new Set(active);
  return models.filter((m) => activeSet.has(m));
}

/**
 * 对外公布的可用模型：基础集（锁定 model 优先；否则点亮子集 activeModels 非空则取它，
 * 空则回退全量 models）并入映射入站名（仅 modelMappingsEnabled 时），大小写去重（保留首次出现）。
 * 与后端 resolver 一致。缺省/旧数据未带开关时按开启处理。
 */
export function advertisedModels(
  ep: Pick<
    Endpoint,
    "model" | "models" | "activeModels" | "modelMappings" | "modelMappingsEnabled"
  >,
): string[] {
  const base = ep.model
    ? [ep.model]
    : ep.activeModels && ep.activeModels.length > 0
      ? ep.activeModels
      : ep.models ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (m: string) => {
    const key = m.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };
  for (const m of base) add(m);
  if (ep.modelMappingsEnabled !== false) {
    for (const { from } of ep.modelMappings ?? []) add(from);
  }
  return out;
}

export interface EndpointTestResult {
  success: boolean;
  status: string;
  latencyMs: number;
  message: string;
  httpStatus?: number | null;
  detail?: string;
}

/** 探测请求固定文案，与后端 test_endpoint payload 一致。 */
export const ENDPOINT_TEST_MESSAGE = "hi";

function nonempty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function joinTextParts(parts: unknown): string | undefined {
  if (!Array.isArray(parts)) return undefined;
  const t = parts
    .map((p) => {
      if (typeof p === "string") return nonempty(p);
      if (p && typeof p === "object" && "text" in p) {
        return nonempty((p as { text: unknown }).text);
      }
      return undefined;
    })
    .filter((s): s is string => !!s)
    .join("");
  return t || undefined;
}

function extractFromJson(v: Record<string, unknown>): string | undefined {
  const choice = Array.isArray(v.choices) ? v.choices[0] : undefined;
  if (choice && typeof choice === "object") {
    const c = choice as {
      message?: { content?: unknown; reasoning_content?: unknown };
      text?: unknown;
      delta?: { content?: unknown };
    };
    const s =
      nonempty(c.message?.content) ??
      joinTextParts(c.message?.content) ??
      nonempty(c.text) ??
      nonempty(c.delta?.content) ??
      nonempty(c.message?.reasoning_content);
    if (s) return s;
  }
  const claude = joinTextParts(v.content);
  if (claude) return claude;
  const outputText = nonempty(v.output_text);
  if (outputText) return outputText;
  if (Array.isArray(v.output)) {
    const chunks: string[] = [];
    for (const item of v.output) {
      if (!item || typeof item !== "object") continue;
      const content = (item as { content?: unknown }).content;
      const s = nonempty(content) ?? joinTextParts(content);
      if (s) chunks.push(s);
    }
    if (chunks.length) return chunks.join("");
  }
  return undefined;
}

function extractFromSse(detail: string): string | undefined {
  const chunks: string[] = [];
  for (const line of detail.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    try {
      const v = JSON.parse(data) as Record<string, unknown>;
      const s = extractFromJson(v);
      if (s) chunks.push(s);
    } catch {
      /* 单行坏 JSON 跳过 */
    }
  }
  return chunks.length ? chunks.join("") : undefined;
}

/** 从探测正文抽出助手回复文本，不保留 JSON 结构。 */
export function extractTestReply(detail?: string | null): string | undefined {
  if (!detail?.trim()) return undefined;
  const trimmed = detail.trim();
  if (/(?:^|\n)data:/.test(trimmed)) {
    const sse = extractFromSse(trimmed);
    if (sse) return sse;
  }
  try {
    return extractFromJson(JSON.parse(trimmed) as Record<string, unknown>);
  } catch {
    return trimmed.length <= 400 ? trimmed : undefined;
  }
}

/** 从探测正文抽出上游报错文案。 */
export function extractTestError(detail?: string | null): string | undefined {
  if (!detail?.trim()) return undefined;
  try {
    const v = JSON.parse(detail) as Record<string, unknown>;
    const err = v.error;
    if (err && typeof err === "object") {
      const o = err as Record<string, unknown>;
      const m = nonempty(o.message);
      if (m) return m;
      if (o.error && typeof o.error === "object") {
        const nested = nonempty((o.error as { message?: unknown }).message);
        if (nested) return nested;
      }
    }
    if (typeof err === "string" && err.trim()) return err;
    return nonempty(v.message);
  } catch {
    return detail.length <= 400 ? detail : undefined;
  }
}

export const endpointApi = {
  list: () => request<Endpoint[]>("list_endpoints"),
  create: (req: CreateEndpointRequest) =>
    request<Endpoint>("create_endpoint", { req }),
  update: (id: number, req: UpdateEndpointRequest) =>
    request<Endpoint>("update_endpoint", { id, req }),
  remove: (id: number) => request<void>("delete_endpoint", { id }),
  archive: (id: number) => request<void>("archive_endpoint", { id }),
  unarchive: (id: number) => request<void>("unarchive_endpoint", { id }),
  listArchived: () => request<Endpoint[]>("list_archived_endpoints"),
  reorder: (orderedIds: number[]) =>
    request<void>("reorder_endpoints", { orderedIds }),
  reorderFast: (orderedIds: number[]) =>
    request<void>("reorder_fast_endpoints", { orderedIds }),
  clone: (id: number) => request<Endpoint>("clone_endpoint", { id }),
  test: (id: number, model?: string) =>
    request<EndpointTestResult>("test_endpoint", { id, model }),
  fetchModels: (
    apiUrl: string,
    apiKey: string,
    transformer: string,
    useProxy?: boolean,
  ) =>
    request<string[]>("fetch_endpoint_models", {
      apiUrl,
      apiKey,
      transformer,
      useProxy,
    }),
  /** 订阅端点配置/测试状态变更事件（启停、编辑、手动测试后触发）。 */
  onChanged: (cb: () => void): Promise<UnlistenFn> =>
    subscribe(Events.endpointsChanged, () => cb()),
};
