import { useEffect, useState } from "react";
import {
  CheckCircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  StarIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getAppVersion,
  openReleases,
  updateApi,
  type UpdateInfo,
} from "@/services/modules/update";
import { useUpdateStore } from "@/stores/modules/update";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function VersionPopover() {
  const [version, setVersion] = useState("");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  const updateAvailable = useUpdateStore((s) => s.available);
  const updateVersion = useUpdateStore((s) => s.version);

  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

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

  const handleCheck = async () => {
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

  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      toast.info("开始下载更新…");
      await updateApi.downloadAndInstall();
    } catch (err) {
      toast.error(`下载失败：${errMsg(err)}`);
    }
  };

  if (!version) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-accent-foreground/70 hover:text-accent-foreground transition-colors"
        >
          <span>v{version}</span>
          {updateAvailable && (
            <DownloadIcon
              className="size-3.5 text-primary animate-pulse cursor-pointer"
              aria-label="下载更新"
              onClick={handleDownload}
            />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="start" side="bottom" className="w-72">
        {/* 标题行 */}
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium">版本信息</h3>
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={handleCheck}
            disabled={checking}
            aria-label="手动检查更新"
          >
            <RefreshCwIcon
              className={checking ? "animate-spin" : undefined}
            />
          </Button>
        </div>

        {/* 版本号 + 状态 */}
        <div className="mb-3">
          <p className="text-lg font-semibold tracking-tight">v{version}</p>
          {info ? (
            info.available ? (
              <span className="text-xs text-primary">
                发现新版本 v{info.version}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                <CheckCircleIcon className="size-3" />
                已是最新版本
              </span>
            )
          ) : updateAvailable ? (
            <span className="text-xs text-primary">
              发现新版本 v{updateVersion}
            </span>
          ) : (
            <span className="text-xs text-ink-mute">点击上方按钮检查更新</span>
          )}
        </div>

        {/* 下载进度 */}
        {progress !== null && (
          <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        )}

        {/* 更新日志 */}
        {info?.notes && (
          <p className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-ink-mute">
            {info.notes}
          </p>
        )}

        {/* 下载安装按钮 */}
        {(info?.available || updateAvailable) && progress === null && (
          <Button
            size="sm"
            className="mb-3 w-full"
            onClick={handleDownload}
          >
            <DownloadIcon />
            下载并安装
          </Button>
        )}

        {/* 底部链接 */}
        <div className="flex items-center justify-between border-t border-edge pt-3">
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs text-ink-secondary hover:text-ink-primary transition-colors"
            onClick={() => openReleases()}
          >
            <ExternalLinkIcon className="size-3" />
            查看发布
          </button>
          <button
            type="button"
            className="text-amber-500 hover:text-amber-400 transition-colors"
            onClick={() => openReleases()}
            aria-label="Star"
          >
            <StarIcon className="size-4 fill-current" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
