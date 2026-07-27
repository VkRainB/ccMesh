import { create } from "zustand";

import type { DownloadProgress, UpdateInfo } from "@/services/modules/update";

/** 总长未知时返回 -1，作为一个稳定值参与去重。 */
const percentOf = (p: DownloadProgress) =>
  p.total ? Math.round((p.downloaded / p.total) * 100) : -1;

interface UpdateState {
  available: boolean;
  version: string;
  /** 下载进度；null 表示当前没有下载在进行。 */
  progress: DownloadProgress | null;
  set: (available: boolean, version: string) => void;
  setFromInfo: (info: UpdateInfo, skippedVersion?: string) => void;
  setProgress: (progress: DownloadProgress | null) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  available: false,
  version: "",
  progress: null,
  set: (available, version) => set({ available, version }),
  setFromInfo: (info, skippedVersion = "") => {
    const available = info.available && info.version !== skippedVersion;
    set({
      available,
      version: available ? info.version : "",
    });
  },
  setProgress: (progress) =>
    set((s) =>
      // 后端按 chunk 回调，一次下载能打上千次事件，而整数百分比只会变 100 次。
      // 百分比没变就原样返回 state，zustand 比到引用未变会跳过通知，避免重渲染风暴。
      progress && s.progress && percentOf(progress) === percentOf(s.progress)
        ? s
        : { progress },
    ),
}));
