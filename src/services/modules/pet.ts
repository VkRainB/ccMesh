import { open } from "@tauri-apps/plugin-dialog";

import { request } from "../request";

/** 精灵图帧布局（pet.json 可选 frames）。 */
export interface PetFrames {
  /** 列数（每行最大帧数）。 */
  cols: number;
  /** 行数（动作数）。 */
  rows: number;
  /** 播放帧率（帧/秒）。 */
  fps: number;
  /** 每行实际帧数；缺省或不足时按 cols 计。 */
  counts?: number[];
}

/** 已安装宠物列表项（spritesheetPath 为绝对路径）。 */
export interface PetListItem {
  dirId: string;
  id: string;
  displayName: string;
  description: string;
  /** 绝对路径，仅供 convertFileSrc。 */
  spritesheetPath: string;
  /** 可选来源标签，如 "Codex"。 */
  tag?: string | null;
  /** 精灵图帧布局；缺省时前端回退整图展示。 */
  frames?: PetFrames | null;
}

const ZIP_FILTER = [{ name: "宠物压缩包", extensions: ["zip"] }];

export const petApi = {
  list: () => request<PetListItem[]>("list_pets"),
  getActive: () => request<string | null>("get_active_pet"),
  setActive: (dirId: string) => request<void>("set_active_pet", { dirId }),
  remove: (dirId: string) => request<void>("delete_pet", { dirId }),
  /** 从本地路径导入（文件夹或 zip）。 */
  import: (path: string) => request<PetListItem>("import_pet", { path }),
  /** 选择文件夹并导入；取消返回 null。 */
  pickAndImportFolder: async (): Promise<PetListItem | null> => {
    const selected = await open({ multiple: false, directory: true });
    if (!selected || typeof selected !== "string") return null;
    return petApi.import(selected);
  },
  /** 选择 zip 并导入；取消返回 null。 */
  pickAndImportZip: async (): Promise<PetListItem | null> => {
    const selected = await open({
      multiple: false,
      directory: false,
      filters: ZIP_FILTER,
    });
    if (!selected || typeof selected !== "string") return null;
    return petApi.import(selected);
  },
};
