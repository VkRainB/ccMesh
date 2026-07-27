import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { updateApi } from "@/services/modules/update";
import { useUpdateStore } from "@/stores/modules/update";

/** 启动时按设置检查更新（有新版本且未跳过则置红点），并订阅下载进度供全局进度卡使用。 */
export function useUpdate() {
  const setFromInfo = useUpdateStore((s) => s.setFromInfo);
  const setProgress = useUpdateStore((s) => s.setProgress);

  useEffect(() => {
    updateApi
      .getSettings()
      .then((settings) => {
        if (!settings.autoCheck) return;
        updateApi
          .check()
          .then((info) => {
            setFromInfo(info, settings.skippedVersion);
          })
          .catch(() => undefined);
      })
      .catch(() => undefined);
  }, [setFromInfo]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    updateApi.onProgress(setProgress).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, [setProgress]);
}

/**
 * 触发「下载 → 安装 → 重启」。成功时后端会重启进程，调用不会返回；
 * 失败时清掉进度并提示，否则右下角进度卡会永远停在中途。
 */
export function useStartUpdate() {
  const setProgress = useUpdateStore((s) => s.setProgress);

  return useCallback(async () => {
    // 先占位，让进度卡立刻出现，不必等第一个 chunk 回调
    setProgress({ downloaded: 0, total: null });
    try {
      await updateApi.installUpdateAndRestart();
    } catch (e) {
      setProgress(null);
      toast.error(`更新失败：${e instanceof Error ? e.message : String(e)}`);
    }
  }, [setProgress]);
}
