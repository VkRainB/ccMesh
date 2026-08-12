import { request } from "../request";
import type { PiOmpApplyItem, PiOmpProviderMeta } from "@/lib/piOmpCommon";

export type PiAppType = "pi";

export interface PiConfigPaths {
  appType: PiAppType;
  agentDir: string;
  modelsPath: string;
  settingsPath: string;
  profilesDir: string;
  modelsFormat: "json" | "yaml";
  settingsFormat: "json" | "yaml";
  modelsExists: boolean;
  settingsExists: boolean;
}

export interface PiDefaultSelection {
  provider?: string | null;
  model?: string | null;
  selector?: string | null;
}

export interface PiWorkspaceState {
  paths: PiConfigPaths;
  providers: PiOmpProviderMeta[];
  defaultSelection: PiDefaultSelection;
  modelsText: string;
  settingsText: string;
}

export interface PiProviderData {
  meta: PiOmpProviderMeta;
  providerJson: unknown;
  providerText: string;
  modelsText: string;
  settingsText: string;
  paths: PiConfigPaths;
  defaultSelection: PiDefaultSelection;
}

export interface SavePiProviderRequest {
  id: string;
  name?: string;
  enabled: boolean;
  order: number;
  providerJson: unknown;
}

export interface ApplyPiConfigRequest {
  items: PiOmpApplyItem[];
  defaultProvider?: string | null;
  defaultModel?: string | null;
}

export interface ApplyPiConfigResult {
  paths: PiConfigPaths;
  providers: PiOmpProviderMeta[];
  defaultSelection: PiDefaultSelection;
  enabledCount: number;
}

export const PI_QUERY_KEYS = {
  workspace: () => ["pi-config", "workspace"] as const,
  provider: (id: string | null) => ["pi-config", "provider", id] as const,
};

export const piConfigApi = {
  resolvePaths: () => request<PiConfigPaths>("resolve_pi_config_paths", {}),
  sync: () => request<PiWorkspaceState>("sync_pi_providers", {}),
  getProvider: (id: string) => request<PiProviderData>("get_pi_provider", { id }),
  saveProvider: (req: SavePiProviderRequest) =>
    request<PiOmpProviderMeta>("save_pi_provider", { req }),
  deleteProvider: (id: string) => request<PiWorkspaceState>("delete_pi_provider", { id }),
  renameProvider: (oldId: string, newId: string) =>
    request<PiWorkspaceState>("rename_pi_provider", { oldId, newId }),
  apply: (req: ApplyPiConfigRequest) => request<ApplyPiConfigResult>("apply_pi_config", { req }),
};
