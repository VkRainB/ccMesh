import type {
  ClaudeDesktopPaths,
  ClaudeDesktopProfileData,
} from "@/services/modules/claude_desktop_config";
import { splitOneM, withOneM } from "@/lib/toolConfig";

export type EditableClaudeDesktopFile =
  | "profile"
  | "meta"
  | "developerSettings"
  | "desktopConfig";

/** 表单操作字段（映射到 Claude Desktop profile JSON）。 */
export interface ClaudeDesktopOperationFields {
  baseUrl: string;
  apiKey: string;
  /** 默认 x-api-key */
  authScheme: string;
  sonnetModel: string;
  opusModel: string;
  haikuModel: string;
  modelDiscoveryEnabled: boolean;
}

export const EMPTY_CLAUDE_DESKTOP_FIELDS: ClaudeDesktopOperationFields = {
  baseUrl: "",
  apiKey: "",
  authScheme: "x-api-key",
  sonnetModel: "",
  opusModel: "",
  haikuModel: "",
  modelDiscoveryEnabled: true,
};

const ROUTE = {
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
  haiku: "claude-haiku-4-5",
} as const;

type JsonObject = Record<string, unknown>;

function asObject(v: unknown): JsonObject {
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as JsonObject) } : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? [...v] : [];
}

/** 新建默认 profile（端点模式：指向本机网关）。 */
export function buildDefaultClaudeDesktopProfile(baseUrl: string): Record<string, unknown> {
  return mergeClaudeDesktopOperationFields(
    {},
    {
      ...EMPTY_CLAUDE_DESKTOP_FIELDS,
      baseUrl,
      authScheme: "x-api-key",
      sonnetModel: ROUTE.sonnet,
      opusModel: ROUTE.opus,
      haikuModel: ROUTE.haiku,
      modelDiscoveryEnabled: true,
    },
  );
}

function tierFromRoute(name: string): string | null {
  const n = name.toLowerCase();
  if (n.includes("sonnet")) return "sonnet";
  if (n.includes("opus")) return "opus";
  if (n.includes("haiku")) return "haiku";
  return null;
}

function findModelEntry(
  models: unknown[],
  routeId: string,
): { name: string; labelOverride: string; supports1m: boolean } | null {
  for (const item of models) {
    const obj = asObject(item);
    const name = typeof obj.name === "string" ? obj.name : "";
    if (name === routeId || tierFromRoute(name) === tierFromRoute(routeId)) {
      const label =
        typeof obj.labelOverride === "string" && obj.labelOverride
          ? obj.labelOverride
          : name;
      const supports1m = obj.supports1m === true;
      return { name, labelOverride: label, supports1m };
    }
  }
  return null;
}

/** 从 profile JSON 解析表单字段。 */
export function parseClaudeDesktopOperationFields(
  profileJson: unknown,
): ClaudeDesktopOperationFields {
  const root = asObject(profileJson);
  const models = asArray(root.inferenceModels);
  const pick = (routeId: string) => {
    const entry = findModelEntry(models, routeId);
    if (!entry) return "";
    return withOneM(entry.labelOverride || entry.name, entry.supports1m);
  };
  return {
    baseUrl: typeof root.inferenceGatewayBaseUrl === "string" ? root.inferenceGatewayBaseUrl : "",
    apiKey: typeof root.inferenceGatewayApiKey === "string" ? root.inferenceGatewayApiKey : "",
    authScheme:
      typeof root.inferenceGatewayAuthScheme === "string" && root.inferenceGatewayAuthScheme
        ? root.inferenceGatewayAuthScheme
        : "x-api-key",
    sonnetModel: pick(ROUTE.sonnet),
    opusModel: pick(ROUTE.opus),
    haikuModel: pick(ROUTE.haiku),
    modelDiscoveryEnabled: root.modelDiscoveryEnabled !== false,
  };
}

function buildModelEntry(
  routeId: string,
  tier: string,
  modelField: string,
  isFamilyDefault: boolean,
): JsonObject | null {
  const trimmed = modelField.trim();
  if (!trimmed) return null;
  const { base, is1m } = splitOneM(trimmed);
  const entry: JsonObject = {
    name: routeId,
    labelOverride: base || routeId,
    supports1m: is1m,
    anthropicFamilyTier: tier,
  };
  if (is1m) entry.prefer1m = true;
  if (isFamilyDefault) entry.isFamilyDefault = true;
  return entry;
}

/**
 * 把操作字段合并进 profile JSON（保留未知字段）。
 * 模型行写入 inferenceModels；空模型行不生成对应条目。
 */
export function mergeClaudeDesktopOperationFields(
  base: unknown,
  fields: ClaudeDesktopOperationFields,
): Record<string, unknown> {
  const root = asObject(base);
  root.inferenceProvider = "gateway";
  if (fields.baseUrl) root.inferenceGatewayBaseUrl = fields.baseUrl;
  else delete root.inferenceGatewayBaseUrl;
  if (fields.apiKey) root.inferenceGatewayApiKey = fields.apiKey;
  else delete root.inferenceGatewayApiKey;
  if (fields.authScheme) root.inferenceGatewayAuthScheme = fields.authScheme;
  else delete root.inferenceGatewayAuthScheme;
  root.modelDiscoveryEnabled = fields.modelDiscoveryEnabled;

  const models: JsonObject[] = [];
  const sonnet = buildModelEntry(ROUTE.sonnet, "sonnet", fields.sonnetModel, true);
  const opus = buildModelEntry(ROUTE.opus, "opus", fields.opusModel, true);
  const haiku = buildModelEntry(ROUTE.haiku, "haiku", fields.haikuModel, false);
  if (sonnet) models.push(sonnet);
  if (opus) models.push(opus);
  if (haiku) models.push(haiku);

  if (models.length > 0) root.inferenceModels = models;
  else delete root.inferenceModels;

  return root;
}

export function formatPathSourceLabel(paths: ClaudeDesktopPaths): string {
  const src = paths.resolutionSource || "unknown";
  if (paths.isMsixVirtualized) return `${src}（MSIX 物理路径）`;
  return src;
}

export function getEditableFileText(
  data: ClaudeDesktopProfileData,
  fileKind: EditableClaudeDesktopFile,
): string {
  const value =
    fileKind === "profile"
      ? data.profileJson
      : fileKind === "meta"
        ? data.metaJson
        : fileKind === "developerSettings"
          ? data.developerSettingsJson
          : data.desktopConfigJson;
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

export function replaceEditableFileJson(
  data: ClaudeDesktopProfileData,
  fileKind: EditableClaudeDesktopFile,
  value: unknown,
): ClaudeDesktopProfileData {
  if (fileKind === "profile") return { ...data, profileJson: value };
  if (fileKind === "meta") return { ...data, metaJson: value };
  if (fileKind === "developerSettings") return { ...data, developerSettingsJson: value };
  return { ...data, desktopConfigJson: value };
}
