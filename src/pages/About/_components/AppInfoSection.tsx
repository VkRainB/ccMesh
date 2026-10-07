import { useEffect, useState } from "react";
import { ExternalLinkIcon, BookOpenIcon, RefreshCwIcon } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";

import { Logo } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  getAppVersion,
  openGitHubRepo,
  openReleases,
  updateApi,
  type UpdateInfo,
} from "@/services/modules/update";
import { useUpdateStore } from "@/stores/modules/update";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const GUIDE_URL = "https://vkrainb.github.io/ccMesh/guide/quickstart.html";

export function AppInfoSection() {
  const [version, setVersion] = useState("");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const updateInfo = useUpdateStore((s) => s.info);
  const openAvailable = useUpdateStore((s) => s.openAvailable);
  const setUpdateFromInfo = useUpdateStore((s) => s.setFromInfo);

  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const check = async () => {
    setChecking(true);
    try {
      const i = await updateApi.check();
      setInfo(i);
      setUpdateFromInfo(i);
      if (!i.available) toast.success("已是最新版本");
    } catch (e) {
      toast.error(`检查失败：${errMsg(e)}`);
    } finally {
      setChecking(false);
    }
  };


  return (
    <section className="rounded-lg border border-edge-subtle bg-surface-card p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Logo
            extra={
              version ? (
                <span className="inline-flex rounded-full border border-edge bg-surface-raised px-2 py-0.5 font-mono text-xs tabular-nums text-ink-secondary">
                  v{version}
                </span>
              ) : undefined
            }
          />
          <Button size="sm" variant="outline" onClick={check} disabled={checking}>
            <RefreshCwIcon className={checking ? "animate-spin" : undefined} />
            {checking ? "检查中…" : "检查更新"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => openGitHubRepo()}>
            <ExternalLinkIcon className="size-3.5" />
            GitHub
          </Button>
          <Button size="sm" variant="outline" onClick={() => openReleases()}>
            更新日志
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => openUrl(GUIDE_URL).catch((e) => toast.error(errMsg(e)))}
          >
            <BookOpenIcon className="size-3.5" />
            软件说明手册
          </Button>
        </div>
      </div>

      {updateInfo ? (
        <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
          <p className="text-ink-primary">
            检测到新版本 <span className="font-mono tabular-nums">{updateInfo.version}</span>
          </p>
          <Button size="sm" onClick={() => openAvailable(updateInfo)}>查看更新</Button>
        </div>
      ) : info && !info.available ? (
        <p className="mt-4 text-sm text-ink-mute">已是最新版本</p>
      ) : null}
    </section>
  );
}
