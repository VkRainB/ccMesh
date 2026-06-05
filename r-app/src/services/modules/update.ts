import type { UnlistenFn } from "@tauri-apps/api/event";

import { Events, request, subscribe } from "../request";

export interface UpdateInfo {
  available: boolean;
  version: string;
  currentVersion: string;
  notes: string;
}

export interface UpdateSettings {
  autoCheck: boolean;
  checkInterval: number;
  skippedVersion: string;
}

export interface DownloadProgress {
  downloaded: number;
  total: number | null;
}

export const updateApi = {
  check: () => request<UpdateInfo>("check_for_updates"),
  downloadAndInstall: () => request<void>("download_and_install"),
  getSettings: () => request<UpdateSettings>("get_update_settings"),
  setSettings: (autoCheck: boolean, checkInterval: number) =>
    request<void>("set_update_settings", { autoCheck, checkInterval }),
  skipVersion: (version: string) => request<void>("skip_version", { version }),
  onProgress: (cb: (p: DownloadProgress) => void): Promise<UnlistenFn> =>
    subscribe<DownloadProgress>(Events.updateProgress, (e) => cb(e.payload)),
};
