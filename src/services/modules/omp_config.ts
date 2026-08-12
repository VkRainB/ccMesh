import { request } from "../request";
import type { PiOmpApplyItem, PiOmpProviderMeta } from "@/lib/piOmpCommon";

export type OmpAppType = "omp";

export interface OmpConfigPaths {
  appType: OmpAppType;
  agentDir: string;
  modelsPath: string;
  settingsPath: string;
  profilesDir: string;
  modelsFormat: "json" | "yaml";
  settingsFormat: "json" | "yaml";
  modelsExists: boolean;
  settingsExists: boolean;
}

export interface OmpDefaultSelection {
  provider?: string | null;
  model?: string | null;
  thinkingLevel?: string | null;
  selector?: string | null;
}

export interface OmpWorkspaceState {
  paths: OmpConfigPaths;
  providers: PiOmpProviderMeta[];
  defaultSelection: OmpDefaultSelection;
  modelsText: string;
  settingsText: string;
}

export interface OmpProviderData {
  meta: PiOmpProviderMeta;
  providerJson: unknown;
  providerText: string;
  modelsText: string;
  settingsText: string;
  paths: OmpConfigPaths;
  defaultSelection: OmpDefaultSelection;
}

export interface SaveOmpProviderRequest {
  id: string;
  name?: string;
  enabled: boolean;
  order: number;
  providerJson: unknown;
}

export interface ApplyOmpConfigRequest {
  items: PiOmpApplyItem[];
  defaultProvider?: string | null;
  defaultModel?: string | null;
  thinkingLevel?: string | null;
}

export interface ApplyOmpConfigResult {
  paths: OmpConfigPaths;
  providers: PiOmpProviderMeta[];
  defaultSelection: OmpDefaultSelection;
  enabledCount: number;
}

export const OMP_QUERY_KEYS = {
  workspace: () => ["omp-config", "workspace"] as const,
  provider: (id: string | null) => ["omp-config", "provider", id] as const,
};

export const ompConfigApi = {
  resolvePaths: () => request<OmpConfigPaths>("resolve_omp_config_paths", {}),
  sync: () => request<OmpWorkspaceState>("sync_omp_providers", {}),
  getProvider: (id: string) => request<OmpProviderData>("get_omp_provider", { id }),
  saveProvider: (req: SaveOmpProviderRequest) =>
    request<PiOmpProviderMeta>("save_omp_provider", { req }),
  deleteProvider: (id: string) => request<OmpWorkspaceState>("delete_omp_provider", { id }),
  renameProvider: (oldId: string, newId: string) =>
    request<OmpWorkspaceState>("rename_omp_provider", { oldId, newId }),
  apply: (req: ApplyOmpConfigRequest) => request<ApplyOmpConfigResult>("apply_omp_config", { req }),
};
