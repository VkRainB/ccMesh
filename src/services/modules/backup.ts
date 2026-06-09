import { open, save } from "@tauri-apps/plugin-dialog";

import { request } from "../request";

export interface ImportSummary {
  endpointsAdded: number;
  endpointsUpdated: number;
  endpointsSkipped: number;
  credentials: number;
  configKeys: number;
}

export type ImportStrategy = "overwrite" | "skip";

const JSON_FILTER = [{ name: "ccmesh 配置", extensions: ["json"] }];

function defaultName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `ccmesh-config-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}.json`;
}

export const backupApi = {
  /** 选择保存路径并导出配置；用户取消返回 null，否则返回保存路径。 */
  exportConfig: async (): Promise<string | null> => {
    const path = await save({ defaultPath: defaultName(), filters: JSON_FILTER });
    if (!path) return null;
    await request<void>("export_config", { path });
    return path;
  },
  /** 选择文件并导入配置；用户取消返回 null，否则返回导入摘要。 */
  importConfig: async (
    strategy: ImportStrategy,
  ): Promise<ImportSummary | null> => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: JSON_FILTER,
    });
    if (!selected || typeof selected !== "string") return null;
    return request<ImportSummary>("import_config", { path: selected, strategy });
  },
};
