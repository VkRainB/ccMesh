import { useMemo, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, Download, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useStartUpdate } from "@/hooks/useUpdate";
import { renderReleaseNotes } from "@/lib/releaseNotes";
import { cn } from "@/lib/utils";
import { updateApi } from "@/services/modules/update";
import { useUpdateStore, type UpdateDialog } from "@/stores/modules/update";

type PendingAction = "ack" | "skip" | "install" | null;
const errMsg = (error: unknown) => error instanceof Error ? error.message : String(error);

export function UpdateDialogs() {
  const dialog = useUpdateStore((state) => state.dialog);
  if (!dialog) return null;
  const version = dialog.kind === "available" ? dialog.info.version : dialog.info.currentVersion;
  return <UpdateDialogContent key={`${dialog.kind}:${dialog.preview}:${version}`} dialog={dialog} />;
}

function UpdateDialogContent({ dialog }: { dialog: UpdateDialog }) {
  const progress = useUpdateStore((state) => state.progress);
  const updateError = useUpdateStore((state) => state.error);
  const startUpdate = useStartUpdate();
  const pendingRef = useRef<PendingAction>(null);
  const [pending, setPending] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const notes = useMemo(() => renderReleaseNotes(dialog.info.notes), [dialog.info.notes]);
  const completed = dialog.kind === "completed";
  const downloading = !dialog.preview && !completed && progress !== null;
  const previousVersion = dialog.kind === "completed" ? dialog.info.previousVersion : dialog.info.currentVersion;
  const nextVersion = dialog.kind === "completed" ? dialog.info.currentVersion : dialog.info.version;
  const percent = progress?.total
    ? Math.max(0, Math.min(100, Math.round(progress.downloaded / progress.total * 100)))
    : null;
  const error = actionError ?? (!dialog.preview && !completed ? updateError : null);

  const setPendingAction = (action: PendingAction) => {
    pendingRef.current = action;
    setPending(action);
  };

  const close = async () => {
    if (useUpdateStore.getState().dialog !== dialog) return;
    if (dialog.preview || dialog.kind === "available") {
      if (pendingRef.current === "skip") return;
      // Download/install belongs to the global updater, not this window.
      useUpdateStore.getState().closeDialog();
      return;
    }
    if (pendingRef.current) return;
    setPendingAction("ack");
    setActionError(null);
    try {
      await updateApi.acknowledgeVersionJump(dialog.info.currentVersion);
      if (useUpdateStore.getState().dialog === dialog) useUpdateStore.getState().closeDialog();
    } catch (error) {
      const message = `确认更新说明失败：${errMsg(error)}`;
      setActionError(message);
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const skip = async () => {
    const state = useUpdateStore.getState();
    if (dialog.preview || dialog.kind !== "available" || pendingRef.current || state.progress || state.dialog !== dialog) return;
    setPendingAction("skip");
    setActionError(null);
    try {
      await updateApi.skipVersion(dialog.info.version);
      // Do not consume a different dialog that arrived while the request was pending.
      if (useUpdateStore.getState().dialog === dialog) {
        useUpdateStore.getState().set(false, "");
        useUpdateStore.getState().closeDialog();
      }
    } catch (error) {
      const message = `跳过版本失败：${errMsg(error)}`;
      setActionError(message);
      toast.error(message);
    } finally {
      setPendingAction(null);
    }
  };

  const install = async () => {
    const state = useUpdateStore.getState();
    if (dialog.preview || dialog.kind !== "available" || pendingRef.current || state.progress || state.dialog !== dialog) return;
    setPendingAction("install");
    setActionError(null);
    try {
      await startUpdate();
    } finally {
      setPendingAction(null);
    }
  };

  const Icon = completed ? CheckCircle2 : Sparkles;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) void close(); }}>
      <DialogContent
        className="flex flex-col gap-5 border-edge-subtle bg-surface-card text-ink-primary sm:max-w-xl"
        showCloseButton={pending !== "ack" && pending !== "skip"}
      >
        <DialogHeader className="text-left">
          <div className="mb-1 flex items-center gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-edge-subtle bg-surface-hover text-primary">
              <Icon className="size-5" aria-hidden />
            </div>
            <DialogTitle className="flex flex-wrap items-center gap-2 leading-normal">
              {completed ? "更新完成" : "发现新版本"}
              {dialog.preview && <Badge variant="muted">仅预览</Badge>}
            </DialogTitle>
          </div>
          <DialogDescription className="text-ink-secondary">
            {dialog.preview
              ? "临时样式预览，使用当前已安装版本与内置说明；不会下载、安装或修改更新记录。"
              : completed
                ? "ccMesh 已升级，看看这个版本带来了哪些变化。"
                : "查看更新内容后，可立即更新或稍后再处理。"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-edge-subtle bg-surface-hover px-4 py-3">
          <div>
            <p className="mb-1 text-xs text-ink-mute">{completed ? "升级前" : "当前版本"}</p>
            <p className="font-mono text-sm tabular-nums">v{previousVersion}</p>
          </div>
          <ArrowRight className="mx-1 size-4 text-ink-mute" aria-hidden />
          <div>
            <p className="mb-1 text-xs text-ink-mute">{dialog.preview ? "预览版本（同当前版本）" : completed ? "当前版本" : "新版本"}</p>
            <p className="font-mono text-sm tabular-nums text-primary">v{nextVersion}</p>
          </div>
        </div>

        <section className="min-h-0" aria-label="更新内容">
          <h2 className="mb-3 text-sm font-medium">更新内容</h2>
          <ScrollArea className="h-[min(40dvh,20rem)] rounded-lg border border-edge-subtle">
            <div className="space-y-3 break-words p-4 pr-5 text-sm leading-relaxed text-ink-secondary [overflow-wrap:anywhere]">
              {notes.length ? notes : <p className="text-ink-mute">此版本暂无更新说明。</p>}
            </div>
          </ScrollArea>
        </section>

        {downloading && progress && (
          <div role="status" aria-live="polite" className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                {percent === 100 ? "下载完成，正在安装…" : "正在下载更新…"}
              </span>
              <span className="font-mono tabular-nums">
                {percent === null ? `${(progress.downloaded / 1024 / 1024).toFixed(1)} MB` : `${percent}%`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="更新下载进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent ?? undefined}
              className="h-1.5 overflow-hidden rounded-full bg-surface-hover"
            >
              <div
                className={cn("h-full rounded-full bg-primary", percent === null ? "w-1/3 animate-pulse" : "transition-all")}
                style={percent === null ? undefined : { width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-ink-mute">关闭窗口不会中断更新；下载完成后将自动安装并重启。</p>
          </div>
        )}
        {error && <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}

        <DialogFooter className="gap-2 border-t border-edge-subtle pt-4">
          {completed ? (
            <Button disabled={pending === "ack"} onClick={() => void close()}>
              {pending === "ack" && <Loader2 className="animate-spin" aria-hidden />}
              {pending === "ack" ? "正在确认…" : "我知道了"}
            </Button>
          ) : (
            <>
              <Button variant="ghost" disabled={pending === "skip"} onClick={() => void close()}>
                {downloading ? "后台继续更新" : "稍后"}
              </Button>
              <Button variant="outline" disabled={dialog.preview || downloading || pending !== null} onClick={() => void skip()}>
                {pending === "skip" && <Loader2 className="animate-spin" aria-hidden />}
                跳过此版本
              </Button>
              <Button disabled={dialog.preview || downloading || pending !== null} onClick={() => void install()}>
                {downloading || pending === "install" ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                {downloading || pending === "install" ? "正在更新…" : "立即更新"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
