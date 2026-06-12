import { request } from "../request";

/** 受支持的工具类型。 */
export type AppType = "claude" | "codex";

/** 渠道列表项 / 元数据。 */
export interface ChannelMeta {
  id: string;
  name: string;
  appType: AppType;
  updatedAt: string;
}

/** 抽取源配置（live）结果。 */
export interface ExtractResult {
  exists: boolean;
  /** Claude=settings.json JSON；Codex={ auth, configToml, config }。 */
  snapshot: unknown;
}

/** 渠道完整数据。 */
export interface ChannelData {
  id: string;
  name: string;
  appType: AppType;
  snapshot: unknown;
  updatedAt: string;
}

/** Claude 操作字段。 */
export interface ClaudeOperationFields {
  baseUrl: string;
  apiKey: string;
  sonnetModel: string;
  opusModel: string;
  haikuModel: string;
  defaultModel: string;
}

/** Codex 操作字段。 */
export interface CodexOperationFields {
  apiKey: string;
  baseUrl: string;
  model: string;
  reviewModel: string;
}

/** Codex 渠道快照结构。 */
export interface CodexSnapshot {
  auth: Record<string, unknown>;
  configToml: string;
  config?: unknown;
}

export interface SaveChannelRequest {
  id?: string | null;
  name: string;
  snapshot: unknown;
}

export const toolConfigApi = {
  list: (appType: AppType) =>
    request<ChannelMeta[]>("list_profile_channels", { appType }),
  get: (appType: AppType, id: string) =>
    request<ChannelData>("get_profile_channel", { appType, id }),
  save: (appType: AppType, req: SaveChannelRequest) =>
    request<ChannelMeta>("save_profile_channel", { appType, req }),
  remove: (appType: AppType, id: string) =>
    request<void>("delete_profile_channel", { appType, id }),
  /** 读取本机真实配置 → 写 *.record.json → 返回快照。 */
  extract: (appType: AppType) =>
    request<ExtractResult>("extract_source_record", { appType }),
  /** 备份原文件 → 原子覆写真实配置。 */
  apply: (appType: AppType, snapshot: unknown) =>
    request<void>("apply_profile_config", { appType, snapshot }),
  previewClaude: (base: unknown, fields: ClaudeOperationFields) =>
    request<unknown>("preview_claude_settings", { base, fields }),
  parseClaude: (snapshot: unknown) =>
    request<ClaudeOperationFields>("parse_claude_fields", { snapshot }),
  previewCodex: (
    configToml: string,
    fields: CodexOperationFields,
    goalMode?: boolean,
  ) => request<string>("preview_codex_config", { configToml, fields, goalMode }),
  parseCodex: (auth: unknown, configToml: string) =>
    request<CodexOperationFields>("parse_codex_fields", { auth, configToml }),
};
