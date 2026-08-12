// pi / omp 共享的前端纯函数：provider id 校验、JSON 解析、apply items 构造、排序、selector 格式化等。
// piConfig.ts / ompConfig.ts 各自实现字段解析/合并，通过本文件复用底层工具。

export type PiOmpAppType = "pi" | "omp";

export const PI_OMP_INPUT_TYPES = ["text", "image"] as const;
export type PiOmpInputType = (typeof PI_OMP_INPUT_TYPES)[number];

export interface PiOmpProviderMeta {
  id: string;
  name: string;
  enabled: boolean;
  order: number;
  modelCount: number;
  isDefault: boolean;
  updatedAt: string;
  configuredAt: string;
  appliedAt?: string | null;
}

export interface PiOmpApplyItem {
  id: string;
  enabled: boolean;
  order: number;
}

export type JsonObject = Record<string, unknown>;

export function isSafePiOmpProviderId(providerId: string): boolean {
  const normalizedProviderId = providerId.trim();
  return (
    normalizedProviderId.length > 0 &&
    normalizedProviderId.length <= 128 &&
    normalizedProviderId !== "." &&
    normalizedProviderId !== ".." &&
    /^[A-Za-z0-9._-]+$/.test(normalizedProviderId)
  );
}

export function normalizePiOmpProviderId(providerId: string): string {
  return providerId.trim();
}

export function parseProviderJsonText(providerText: string): JsonObject {
  const parsedProvider = JSON.parse(providerText) as unknown;
  if (!parsedProvider || typeof parsedProvider !== "object" || Array.isArray(parsedProvider)) {
    throw new Error("provider 必须是 JSON 对象");
  }
  return parsedProvider as JsonObject;
}

export function formatProviderJson(providerJson: unknown): string {
  return JSON.stringify(providerJson ?? {}, null, 2);
}

export function getProviderModelIds(providerJson: unknown): string[] {
  if (!providerJson || typeof providerJson !== "object" || Array.isArray(providerJson)) {
    return [];
  }
  const providerObject = providerJson as JsonObject;
  if (!Array.isArray(providerObject.models)) {
    return [];
  }
  return providerObject.models
    .map((model) => {
      if (!model || typeof model !== "object" || Array.isArray(model)) return "";
      const modelId = (model as JsonObject).id;
      return typeof modelId === "string" ? modelId : "";
    })
    .filter((modelId) => modelId.length > 0);
}

export function canProviderBeDefault(provider: PiOmpProviderMeta | null | undefined): boolean {
  return Boolean(provider?.enabled && provider.modelCount > 0);
}

export function buildPiOmpApplyItems(providers: PiOmpProviderMeta[]): PiOmpApplyItem[] {
  return providers.map((provider, providerIndex) => ({
    id: provider.id,
    enabled: provider.enabled,
    order: providerIndex,
  }));
}

export function reorderPiOmpProviders(
  providers: PiOmpProviderMeta[],
  activeProviderId: string,
  targetProviderId: string,
): PiOmpProviderMeta[] {
  if (activeProviderId === targetProviderId) return providers;
  const activeIndex = providers.findIndex((provider) => provider.id === activeProviderId);
  const targetIndex = providers.findIndex((provider) => provider.id === targetProviderId);
  if (activeIndex < 0 || targetIndex < 0) return providers;
  const nextProviders = [...providers];
  const [activeProvider] = nextProviders.splice(activeIndex, 1);
  nextProviders.splice(targetIndex, 0, activeProvider);
  return nextProviders.map((provider, providerIndex) => ({ ...provider, order: providerIndex }));
}

export function formatOmpDefaultSelector(
  providerId: string,
  modelId: string,
  thinkingLevel: string | null | undefined,
): string {
  const normalizedThinkingLevel = (thinkingLevel ?? "").trim();
  const baseSelector = `${providerId}/${modelId}`;
  return normalizedThinkingLevel ? `${baseSelector}:${normalizedThinkingLevel}` : baseSelector;
}

export function summarizeEnabledProviderNames(providers: PiOmpProviderMeta[]): string {
  const enabledNames = providers
    .filter((provider) => provider.enabled)
    .map((provider) => provider.name || provider.id);
  return enabledNames.length > 0 ? enabledNames.join("、") : "暂无启用渠道";
}

export function detectSubTab(baseUrl: string, gatewayUrl: string): "endpoint" | "custom" {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  const gateway = gatewayUrl.trim().replace(/\/+$/, "");
  return normalized === gateway ? "endpoint" : "custom";
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return fallback;
}

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
