import { useEffect, useState } from "react";
import {
  CheckCircleIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  StarIcon,
  TagIcon,
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
import { useLayoutStore } from "@/stores";
import { useStartUpdate } from "@/hooks/useUpdate";
import { cn } from "@/lib/utils";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function VersionPopover({ compact = false }: { compact?: boolean }) {
  const [version, setVersion] = useState("");
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);

  const updateAvailable = useUpdateStore((s) => s.available);
  const updateVersion = useUpdateStore((s) => s.version);
  const setUpdateFromInfo = useUpdateStore((s) => s.setFromInfo);
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const startUpdate = useStartUpdate();
  const available = info?.available ?? updateAvailable;
  const availableVersion = info?.available ? info.version : updateVersion;

  useEffect(() => {
    getAppVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  const handleCheck = async () => {
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

  const handleDownload = (e: React.MouseEvent) => {
    e.stopPropagation();
    void startUpdate();
  };

  if (!version) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 text-xs text-accent-foreground/70 transition-colors hover:text-accent-foreground",
            compact && "relative size-7 justify-center rounded-md hover:bg-surface-hover"
          )}
          aria-label={compact ? `版本 v${version}` : undefined}
        >
          {/* 折叠侧栏里没有版本号文本可点，用一个图标兜住触发区 */}
          {compact && <TagIcon className="size-4" />}
          <span className={compact ? "sr-only" : undefined}>v{version}</span>
          {available && (
            <DownloadIcon
              className={cn(
                "size-3.5 cursor-pointer text-primary animate-pulse",
                compact &&
                  "absolute -right-0.5 -top-0.5 rounded-full bg-surface p-0.5 ring-1 ring-edge"
              )}
              aria-label={
                availableVersion ? `下载更新 v${availableVersion}` : "下载更新"
              }
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

        {/* 更新日志 */}
        {info?.notes && (
          <p className="mb-3 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs text-ink-mute">
            {info.notes}
          </p>
        )}

        {/* 下载安装按钮 */}
        {available && (
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
          <div className="flex items-center gap-3">
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
              className="text-xs text-primary-soft hover:text-primary transition-colors"
              onClick={() => setActiveView("about")}
            >
              关于
            </button>
          </div>
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
