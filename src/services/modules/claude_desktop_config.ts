import { request } from "../request";

export interface ClaudeDesktopPathCandidate {
  path: string;
  source: string;
  score: number;
  exists: boolean;
  markers: string[];
}

export interface ClaudeDesktopPaths {
  supported: boolean;
  platform: string;
  threepRootLogical?: string | null;
  threepRootResolved?: string | null;
  configLibraryPath?: string | null;
  metaPath?: string | null;
  threepConfigPath?: string | null;
  developerSettingsPath?: string | null;
  normalConfigPath?: string | null;
  resolutionSource: string;
  packageFamilyName?: string | null;
  isMsixVirtualized: boolean;
  candidates: ClaudeDesktopPathCandidate[];
  warning?: string | null;
}

export interface ClaudeDesktopProfileMeta {
  id: string;
  name: string;
  fileName: string;
  path: string;
  registered: boolean;
  active: boolean;
  exists: boolean;
  validJson: boolean;
  updatedAt?: string | null;
  warning?: string | null;
}

export interface ClaudeDesktopProfileData {
  meta: ClaudeDesktopProfileMeta;
  profileJson: unknown;
  metaJson: unknown;
  developerSettingsJson: unknown;
  desktopConfigJson: unknown;
  paths: ClaudeDesktopPaths;
}

export interface SaveClaudeDesktopProfileRequest {
  id?: string | null;
  name: string;
  profileJson: unknown;
  registerInMeta?: boolean;
  makeActive?: boolean;
  metaJson?: unknown;
  developerSettingsJson?: unknown;
  desktopConfigJson?: unknown;
}

export interface ApplyClaudeDesktop3pRequest {
  activeProfileId: string;
  writeNormalConfig?: boolean;
  writeThreepConfig?: boolean;
  writeDeveloperSettings?: boolean;
}

export interface ApplyClaudeDesktop3pResult {
  writtenFiles: string[];
  backupFiles: string[];
  warnings: string[];
  restartRequired: boolean;
}

export const CLAUDE_DESKTOP_QUERY_KEYS = {
  paths: ["claude-desktop-config", "paths"] as const,
  profiles: ["claude-desktop-config", "profiles"] as const,
  profile: (id: string) => ["claude-desktop-config", "profile", id] as const,
};

/** Claude Desktop 真实文件接管 API（勿混入 toolConfigApi 快照语义）。 */
export const claudeDesktopConfigApi = {
  resolvePaths: () => request<ClaudeDesktopPaths>("resolve_claude_desktop_paths"),
  listProfiles: () => request<ClaudeDesktopProfileMeta[]>("list_claude_desktop_profiles"),
  getProfile: (id: string) =>
    request<ClaudeDesktopProfileData>("get_claude_desktop_profile", { id }),
  saveProfile: (req: SaveClaudeDesktopProfileRequest) =>
    request<ClaudeDesktopProfileMeta>("save_claude_desktop_profile", { req }),
  unregisterProfile: (id: string) =>
    request<void>("unregister_claude_desktop_profile", { id }),
  deleteProfileFile: (id: string) =>
    request<void>("delete_claude_desktop_profile_file", { id }),
  /** 默认删除：解除 _meta 注册并删除真实 profile 文件。 */
  deleteProfile: (id: string) => request<void>("delete_claude_desktop_profile", { id }),
  apply3pMode: (req: ApplyClaudeDesktop3pRequest) =>
    request<ApplyClaudeDesktop3pResult>("apply_claude_desktop_3p_mode", { req }),
};
