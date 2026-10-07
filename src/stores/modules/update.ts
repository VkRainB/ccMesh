import { create } from "zustand";

import type { DownloadProgress, UpdateInfo, VersionJumpInfo } from "@/services/modules/update";

/** 总长未知时返回 -1，作为一个稳定值参与去重。 */
const percentOf = (p: DownloadProgress) =>
  p.total ? Math.round((p.downloaded / p.total) * 100) : -1;

export type UpdateDialog =
  | { kind: "available"; info: UpdateInfo; preview: boolean }
  | { kind: "completed"; info: VersionJumpInfo; preview: boolean };

interface UpdateState {
  available: boolean;
  version: string;
  /** 下载进度；null 表示当前没有下载在进行。 */
  progress: DownloadProgress | null;
  info: UpdateInfo | null;
  dialog: UpdateDialog | null;
  /** 预览期间保留的真实提醒；预览关闭后恢复。 */
  deferredDialog: UpdateDialog | null;
  error: string | null;
  openAvailable: (info: UpdateInfo, preview?: boolean) => void;
  openCompleted: (info: VersionJumpInfo, preview?: boolean) => void;
  closeDialog: () => void;
  setError: (error: string | null) => void;
  set: (available: boolean, version: string) => void;
  setFromInfo: (info: UpdateInfo, skippedVersion?: string) => void;
  setProgress: (progress: DownloadProgress | null) => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
  available: false,
  version: "",
  progress: null,
  info: null,
  dialog: null,
  deferredDialog: null,
  error: null,
  set: (available, version) => set((s) => ({
    available,
    version,
    ...(!available ? {
      info: null,
      dialog: s.dialog?.kind === "available" && !s.dialog.preview ? null : s.dialog,
      deferredDialog: s.deferredDialog?.kind === "available" ? null : s.deferredDialog,
    } : {}),
  })),
  setFromInfo: (info, skippedVersion = "") => {
    const available = info.available && info.version !== skippedVersion;
    set((s) => ({
      available,
      version: available ? info.version : "",
      info: available ? info : null,
      error: null,
      // 更新完成说明优先；关闭后再展示这次检查发现的下一版本。
      dialog: s.dialog?.kind === "completed" || s.dialog?.preview
        ? s.dialog
        : available ? { kind: "available", info, preview: false } : null,
      deferredDialog: s.dialog?.preview && s.deferredDialog?.kind !== "completed"
        ? available ? { kind: "available", info, preview: false } : null
        : s.deferredDialog,
    }));
  },
  openAvailable: (info, preview = false) => set((s) => ({
    dialog: preview || !s.dialog?.preview && s.dialog?.kind !== "completed"
      ? { kind: "available", info, preview } : s.dialog,
    deferredDialog: preview
      ? s.dialog?.preview ? s.deferredDialog : s.dialog
      : s.dialog?.preview && s.deferredDialog?.kind !== "completed"
        ? { kind: "available", info, preview: false } : s.deferredDialog,
  })),
  openCompleted: (info, preview = false) => set((s) => ({
    dialog: !preview && s.dialog?.preview ? s.dialog : { kind: "completed", info, preview },
    deferredDialog: preview
      ? s.dialog?.preview ? s.deferredDialog : s.dialog
      : s.dialog?.preview ? { kind: "completed", info, preview: false } : s.deferredDialog,
  })),
  closeDialog: () => set((s) => ({
    dialog: s.dialog?.preview ? s.deferredDialog
      : s.dialog?.kind === "completed" && s.available && s.info
        ? { kind: "available", info: s.info, preview: false } : null,
    deferredDialog: null,
  })),
  setError: (error) => set({ error }),
  setProgress: (progress) =>
    set((s) =>
      // 后端按 chunk 回调，整数百分比不变时避免重渲染风暴。
      progress && s.progress && percentOf(progress) === percentOf(s.progress)
        ? s
        : { progress },
    ),
}));
