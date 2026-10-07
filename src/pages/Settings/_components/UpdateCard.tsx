import { useEffect, useRef, useState } from "react";
// 临时弹层预览：下次调试时恢复 useMemo、Badge、getBundledReleaseNotes、notes 和下方 JSX。
// import { useMemo } from "react";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { SettingCard, SettingRow } from "@/components/settings";
// import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
// import { getBundledReleaseNotes } from "@/lib/releaseNotes";
import type { AppConfig } from "@/services/modules/config";
import { getAppVersion, updateApi } from "@/services/modules/update";
import { useUpdateStore } from "@/stores/modules/update";
import { version as packageVersion } from "../../../../package.json";

export function UpdateCard({
  cfg,
  save,
}: {
  cfg: AppConfig;
  save: (patch: Record<string, string>) => Promise<void>;
}) {
  const [version, setVersion] = useState(packageVersion);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const checkingRef = useRef(false);
  const downloading = useUpdateStore((state) => state.progress !== null);
  // const notes = useMemo(
  //   () => getBundledReleaseNotes(version) || "当前版本暂无内置更新说明。此窗口仅用于预览提示样式。",
  //   [version],
  // );

  useEffect(() => {
    let cancelled = false;
    getAppVersion().then((currentVersion) => {
      if (!cancelled) setVersion(currentVersion);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const check = async () => {
    if (checkingRef.current || useUpdateStore.getState().progress) return;
    checkingRef.current = true;
    setChecking(true);
    setCheckError(null);
    try {
      const info = await updateApi.check();
      useUpdateStore.getState().setFromInfo(info);
      if (!info.available) toast.success("已是最新版本");
    } catch (error) {
      const message = `检查更新失败：${error instanceof Error ? error.message : String(error)}`;
      setCheckError(message);
      toast.error(message);
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  };

  return (
    <SettingCard icon={Download} title="应用更新">
      <SettingRow label="启动时自动检查更新">
        <Switch
          checked={cfg.update.autoCheck}
          aria-label="启动时自动检查更新"
          onCheckedChange={(enabled) => void save({ update_autoCheck: String(enabled) })}
        />
      </SettingRow>
      <SettingRow label={`当前版本 v${version}`}>
        <Button size="sm" variant="outline" disabled={checking || downloading} onClick={() => void check()}>
          {checking ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          {checking ? "检查中…" : "检查更新"}
        </Button>
      </SettingRow>
      <p className="text-xs leading-relaxed text-ink-mute">
        {downloading ? "更新正在后台进行，下载完成后将自动安装并重启。" : "发现新版本后，可查看更新说明并选择下载安装。"}
      </p>
      {checkError && <p role="alert" className="text-xs text-destructive">{checkError}</p>}
      {/* 临时弹层预览入口，保留供下次调试。
      <div className="space-y-3 border-t border-edge-subtle pt-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-primary">弹层预览</span>
          <Badge variant="muted">临时 · 仅预览</Badge>
        </div>
        <p className="text-xs leading-relaxed text-ink-mute">
          使用当前版本的内置更新说明预览两种提示，不代表存在新发布；不会下载安装、跳过版本或清除升级提醒。
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => useUpdateStore.getState().openAvailable({
              available: true,
              currentVersion: version,
              version,
              notes,
            }, true)}
          >
            预览新版本提示
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => useUpdateStore.getState().openCompleted({
              previousVersion: version,
              currentVersion: version,
              notes,
            }, true)}
          >
            预览更新完成
          </Button>
        </div>
      </div>
      */}
    </SettingCard>
  );
}
