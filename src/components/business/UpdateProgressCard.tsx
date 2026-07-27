import { DownloadIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { useUpdateStore } from "@/stores/modules/update";

/**
 * 下载更新时固定在右下角的进度卡。全局只挂一次，与导航模式和当前页面无关 ——
 * 从导航栏触发下载后仍然可见，不像原先那样跟着 Popover 一起消失。
 */
export function UpdateProgressCard() {
  const progress = useUpdateStore((s) => s.progress);
  const version = useUpdateStore((s) => s.version);

  if (!progress) return null;

  // 服务端没给 Content-Length 时退化为不确定态动画
  const percent = progress.total
    ? Math.round((progress.downloaded / progress.total) * 100)
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-6 right-6 z-50 w-72 rounded-lg border border-edge-subtle bg-surface-card p-4 shadow-level-2"
    >
      <div className="flex items-center gap-2">
        <DownloadIcon className="size-4 shrink-0 animate-pulse text-primary" />
        <span className="flex-1 truncate text-sm text-ink-primary">
          {version ? `正在下载 v${version}` : "正在下载更新"}
        </span>
        {percent !== null && (
          <span className="font-mono text-xs tabular-nums text-ink-secondary">
            {percent}%
          </span>
        )}
      </div>
      <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
        <div
          className={cn(
            "h-full rounded-full bg-primary",
            percent === null ? "w-1/3 animate-pulse" : "transition-all",
          )}
          style={percent === null ? undefined : { width: `${percent}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-ink-mute">下载完成后将自动安装并重启</p>
    </div>
  );
}
