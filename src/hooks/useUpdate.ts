import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { updateApi } from "@/services/modules/update";
import { useUpdateStore } from "@/stores/modules/update";

/** 启动时检测升级记录并按设置检查新版本；全局订阅下载进度。 */
export function useUpdate() {
  const setFromInfo = useUpdateStore((s) => s.setFromInfo);
  const setProgress = useUpdateStore((s) => s.setProgress);
  const openCompleted = useUpdateStore((s) => s.openCompleted);

  useEffect(() => {
    let cancelled = false;
    const checkOnStartup = async () => {
      try {
        const jump = await updateApi.checkVersionJump();
        if (!cancelled && jump) openCompleted(jump);
      } catch (e) {
        console.warn("读取更新完成记录失败", e);
      }
      if (cancelled) return;
      try {
        const settings = await updateApi.getSettings();
        if (cancelled || !settings.autoCheck || settings.checkInterval <= 0) return;
        const info = await updateApi.check();
        if (!cancelled) setFromInfo(info, settings.skippedVersion);
      } catch {
        // 启动检查不打断使用；手动检查入口会报告网络错误。
      }
    };
    void checkOnStartup();
    return () => { cancelled = true; };
  }, [setFromInfo, openCompleted]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    updateApi.onProgress(setProgress).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    }).catch((e) => console.warn("订阅更新进度失败", e));
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [setProgress]);
}

/** 与后端 `UPDATE_IN_PROGRESS` 对齐；二次 invoke 被拒时不能清掉第一次的进度卡。 */
const ALREADY_UPDATING = "更新正在进行中";

/**
 * 触发「下载 → 安装 → 重启」。成功时后端会重启进程，调用不会返回；
 * 失败时清掉进度并提示，否则右下角进度卡会永远停在中途。
 */
export function useStartUpdate() {
  const setProgress = useUpdateStore((s) => s.setProgress);
  const setError = useUpdateStore((s) => s.setError);

  return useCallback(async () => {
    if (useUpdateStore.getState().progress) return;
    setError(null);
    // 先占位，让进度卡立刻出现，不必等第一个 chunk 回调。
    setProgress({ downloaded: 0, total: null });
    try {
      await updateApi.installUpdateAndRestart();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes(ALREADY_UPDATING)) return;
      setProgress(null);
      setError(msg);
      toast.error(`更新失败：${msg}`);
    }
  }, [setProgress, setError]);
}
