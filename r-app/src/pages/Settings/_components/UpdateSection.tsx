import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { updateApi, type UpdateInfo } from "@/services/modules/update";
import { useUpdateStore } from "@/stores/modules/update";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function UpdateSection() {
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const clearBadge = useUpdateStore((s) => s.set);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    updateApi
      .onProgress((p) => {
        setProgress(p.total ? Math.round((p.downloaded / p.total) * 100) : null);
      })
      .then((u) => {
        unlisten = u;
      });
    return () => unlisten?.();
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      const i = await updateApi.check();
      setInfo(i);
      if (!i.available) toast.success("已是最新版本");
    } catch (e) {
      toast.error(`检查失败：${errMsg(e)}`);
    } finally {
      setChecking(false);
    }
  };

  const download = async () => {
    try {
      await updateApi.downloadAndInstall();
    } catch (e) {
      toast.error(`下载失败：${errMsg(e)}`);
    }
  };

  const skip = async () => {
    if (!info) return;
    await updateApi.skipVersion(info.version).catch(() => undefined);
    clearBadge(false, "");
    setInfo(null);
    toast.success(`已跳过 ${info.version}`);
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-edge p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-secondary">应用更新</h2>
        <Button size="sm" variant="outline" onClick={check} disabled={checking}>
          {checking ? "检查中…" : "检查更新"}
        </Button>
      </div>
      {info &&
        (info.available ? (
          <div className="flex flex-col gap-2 text-sm">
            <span>
              发现新版本 <b>{info.version}</b>（当前 {info.currentVersion}）
            </span>
            {info.notes ? (
              <p className="whitespace-pre-wrap text-xs text-ink-mute">{info.notes}</p>
            ) : null}
            {progress !== null ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" onClick={download}>
                下载并安装
              </Button>
              <Button size="sm" variant="ghost" onClick={skip}>
                跳过此版本
              </Button>
            </div>
          </div>
        ) : (
          <span className="text-sm text-ink-mute">
            当前已是最新版本 {info.currentVersion}
          </span>
        ))}
    </section>
  );
}
