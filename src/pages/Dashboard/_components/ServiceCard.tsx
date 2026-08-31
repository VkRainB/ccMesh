import { CopyIcon, HelpCircleIcon, XIcon, ZapIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

import { StatusDot, TabularText } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEndpoints } from "@/hooks/useEndpoints";
import { useEndpointHealth, useEndpointHealthEvents } from "@/hooks/useEndpointHealth";
import { useProxyStatus } from "@/hooks/useProxyStatus";
import { cn } from "@/lib/utils";
import { endpointApi, type Endpoint } from "@/services/modules/endpoint";
import { circuitBadgeLabel, circuitDot, type EndpointHealth } from "@/services/modules/health";
import { proxyApi } from "@/services/modules/proxy";
import { statsApi } from "@/services/modules/stats";
import { useLayoutStore } from "@/stores";
import { ProxyScene } from "./ProxyScene";
import { appendFastId, removeFastId, reorderFastIds, splitEndpointQueues } from "./fastQueue";

type QueueStatus = "success" | "danger" | "warning" | "info" | "idle";

const statusText: Record<QueueStatus, string> = {
  success: "text-success",
  danger: "text-destructive",
  warning: "text-warning",
  info: "text-info",
  idle: "text-ink-mute",
};

function endpointStatus(
  endpoint: Endpoint,
  current: string | null,
  running: boolean,
  healthByName: Map<string, EndpointHealth>,
  receivedAt: number,
): { status: QueueStatus; active: boolean; title?: string } {
  const active = endpoint.name === current;
  const health = healthByName.get(endpoint.name);
  if (health && health.circuit !== "closed") {
    const label = circuitBadgeLabel(
      health.circuit,
      health.cooldownRemainingMs,
      receivedAt,
    );
    return {
      active,
      status: circuitDot(health.circuit),
      title: `${label}${health.lastError ? ` · ${health.lastError}` : ""}`,
    };
  }
  return { active, status: active && running ? "info" : "success" };
}

function FastMark({ status, pulse }: { status: QueueStatus; pulse?: boolean }) {
  // 快速队列专属色：成功态用金色（VIP 感），其他状态保持原色
  const fastColor = status === "success" ? "text-amber-500" : statusText[status];
  return (
    <span
      className={cn(
        "inline-flex items-center",
        fastColor,
        pulse && "animate-pulse"
      )}
      aria-label="快速队列"
    >
      <ZapIcon className="size-3" fill="currentColor" />
    </span>
  );
}

function QueueItem({
  endpoint,
  current,
  running,
  healthByName,
  receivedAt,
  fast,
}: {
  endpoint: Endpoint;
  current: string | null;
  running: boolean;
  healthByName: Map<string, EndpointHealth>;
  receivedAt: number;
  fast?: boolean;
}) {
  const { status, active, title } = endpointStatus(
    endpoint,
    current,
    running,
    healthByName,
    receivedAt,
  );
  return (
    <li title={title} className="inline-flex items-center gap-1.5">
      {fast ? (
        <FastMark status={status} pulse={active && running} />
      ) : (
        <StatusDot status={status} pulse={active && running} />
      )}
      <span
        className={cn(
          "rounded-full px-2.5 py-0.5 text-sm transition-all",
          active ? "font-medium" : "text-ink-primary",
        )}
        style={active ? { backgroundColor: '#E3E9FA', color: '#2756D9' } : undefined}
      >
        {endpoint.name}
      </span>
    </li>
  );
}

function QueueSection({
  endpoints,
  empty,
  current,
  running,
  healthByName,
  receivedAt,
}: {
  endpoints: Endpoint[];
  empty: string;
  current: string | null;
  running: boolean;
  healthByName: Map<string, EndpointHealth>;
  receivedAt: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      {endpoints.length === 0 ? (
        <p className="text-sm text-ink-mute">{empty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {endpoints.map((endpoint) => (
            <QueueItem
              key={endpoint.id}
              endpoint={endpoint}
              current={current}
              running={running}
              healthByName={healthByName}
              receivedAt={receivedAt}
              fast={endpoint.fast}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

const FAST_QUEUE_DROP_ID = "fast-queue-drop";
const ENABLED_QUEUE_DROP_ID = "enabled-queue-drop";

function DraggableEndpointCard({
  endpoint,
  fast,
  onDoubleClick,
  onRemove,
}: {
  endpoint: Endpoint;
  fast?: boolean;
  onDoubleClick: () => void;
  onRemove?: () => void;
}) {
  const { ref, isDragging } = useDraggable({ id: endpoint.id });

  return (
    <div
      ref={ref}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex cursor-grab select-none items-center gap-2.5 rounded-lg border border-edge bg-card px-3 py-2.5 text-sm shadow-sm transition-all active:cursor-grabbing",
        isDragging ? "opacity-40 shadow-lg" : "hover:border-edge-strong hover:shadow-md",
      )}
      title={
        fast
          ? "拖动整个端点卡片移出快速队列；双击移出快速队列"
          : "拖动整个端点卡片加入快速队列；双击加入快速队列"
      }
    >
      {fast ? <FastMark status="success" /> : null}
      <span className="min-w-0 flex-1 truncate font-medium">{endpoint.name}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          onDoubleClick={(event) => event.stopPropagation()}
          className="rounded p-1 text-ink-mute transition-colors hover:bg-destructive/10 hover:text-destructive"
          aria-label={`移出快速队列 ${endpoint.name}`}
        >
          <XIcon className="size-4" />
        </button>
      ) : null}
    </div>
  );
}

function FastSortableEndpointCard({
  endpoint,
  index,
  onDoubleClick,
  onRemove,
}: {
  endpoint: Endpoint;
  index: number;
  onDoubleClick: () => void;
  onRemove: () => void;
}) {
  const { ref, isDragging, isDropTarget } = useSortable({ id: endpoint.id, index });

  return (
    <div
      ref={ref}
      onDoubleClick={onDoubleClick}
      className={cn(
        "flex cursor-grab select-none items-center gap-2.5 rounded-lg border border-edge bg-card px-3 py-2.5 text-sm shadow-sm transition-all active:cursor-grabbing",
        isDragging && "opacity-40 shadow-lg",
        isDropTarget && "ring-2 ring-primary/50",
        !isDragging && "hover:border-edge-strong hover:shadow-md",
      )}
      title="拖动排序或拖到启用队列；双击移出快速队列"
    >
      <FastMark status="success" />
      <span className="min-w-0 flex-1 truncate font-medium">{endpoint.name}</span>
      <button
        type="button"
        onClick={onRemove}
        onDoubleClick={(event) => event.stopPropagation()}
        className="rounded p-1 text-ink-mute transition-colors hover:bg-destructive/10 hover:text-destructive"
        aria-label={`移出快速队列 ${endpoint.name}`}
      >
        <XIcon className="size-4" />
      </button>
    </div>
  );
}

function FastQueueTransfer({
  fastQueue,
  enabledQueue,
  moveIntoFast,
  remove,
}: {
  fastQueue: Endpoint[];
  enabledQueue: Endpoint[];
  moveIntoFast: (id: number) => void;
  remove: (id: number) => void;
}) {
  const fastDrop = useDroppable({ id: FAST_QUEUE_DROP_ID });
  const enabledDrop = useDroppable({ id: ENABLED_QUEUE_DROP_ID });

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section
        ref={fastDrop.ref}
        className={cn(
          "flex h-[45vh] flex-col rounded-lg border bg-surface-card transition-all",
          fastDrop.isDropTarget
            ? "border-primary/50 bg-primary-glow ring-2 ring-primary/30"
            : "border-edge",
        )}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-lg border-b border-edge-subtle bg-surface-card px-4 py-3">
          <h3 className="text-sm font-medium text-ink-primary">快速队列</h3>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex text-ink-mute transition-colors hover:text-ink-secondary"
                aria-label="快速队列用法说明"
              >
                <HelpCircleIcon className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="right" className="w-80">
              <div className="flex flex-col gap-1.5 text-xs">
                <p className="font-medium">快速队列用法</p>
                <p>• 快速队列中的端点会优先轮询</p>
                <p>• 双击端点卡片可快速切换队列</p>
                <p>• 在快速队列内拖动可调整优先级顺序</p>
              </div>
            </PopoverContent>
          </Popover>
          <span className="ml-auto rounded-md bg-surface-raised px-2 py-0.5 text-xs">
            <TabularText>{fastQueue.length}</TabularText>
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 scrollbar-none">
          {fastQueue.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-edge-subtle bg-surface/40 p-6">
              <p className="text-center text-sm text-ink-mute">
                从右侧拖入启用端点
                <br />
                或双击右侧端点加入快速队列
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {fastQueue.map((endpoint, index) => (
                <FastSortableEndpointCard
                  key={endpoint.id}
                  endpoint={endpoint}
                  index={index}
                  onDoubleClick={() => remove(endpoint.id)}
                  onRemove={() => remove(endpoint.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section
        ref={enabledDrop.ref}
        className={cn(
          "flex h-[45vh] flex-col rounded-lg border bg-surface-card transition-all",
          enabledDrop.isDropTarget
            ? "border-primary/50 bg-primary-glow ring-2 ring-primary/30"
            : "border-edge",
        )}
      >
        <div className="sticky top-0 z-10 flex items-center gap-2 rounded-t-lg border-b border-edge-subtle bg-surface-card px-4 py-3">
          <h3 className="text-sm font-medium text-ink-primary">启用队列</h3>
          <span className="ml-auto rounded-md bg-surface-raised px-2 py-0.5 text-xs">
            <TabularText>{enabledQueue.length}</TabularText>
          </span>
        </div>
        <div className="flex-1 overflow-y-auto p-4 scrollbar-none">
          {enabledQueue.length === 0 ? (
            <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-edge-subtle bg-surface/40 p-6">
              <p className="text-center text-sm text-ink-mute">
                启用队列暂无可加入
                <br />
                快速队列的端点
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {enabledQueue.map((endpoint) => (
                <DraggableEndpointCard
                  key={endpoint.id}
                  endpoint={endpoint}
                  onDoubleClick={() => moveIntoFast(endpoint.id)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function FastQueueDialog({
  open,
  onOpenChange,
  fastQueue,
  enabledQueue,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fastQueue: Endpoint[];
  enabledQueue: Endpoint[];
}) {
  const qc = useQueryClient();
  const fastIds = fastQueue.map((e) => e.id);

  const save = useMutation({
    mutationFn: async (nextIds: number[]) => endpointApi.reorderFast(nextIds),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["endpoints"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const setFast = useMutation({
    mutationFn: async ({ id, fast, order }: { id: number; fast: boolean; order?: number[] }) => {
      await endpointApi.update(id, { fast });
      if (order) await endpointApi.reorderFast(order);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["endpoints"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const moveIntoFast = (id: number) => {
    setFast.mutate({ id, fast: true, order: appendFastId(fastIds, id) });
  };
  const remove = (id: number) => {
    setFast.mutate({ id, fast: false, order: removeFastId(fastIds, id) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>编辑快速队列</DialogTitle>
        </DialogHeader>
        <div className="overflow-y-auto">
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled) return;
              const sourceId = event.operation.source?.id;
              const targetId = event.operation.target?.id;
              if (typeof sourceId !== "number") return;
              if (targetId === ENABLED_QUEUE_DROP_ID && fastIds.includes(sourceId)) {
                remove(sourceId);
                return;
              }
              const sourceIsFast = fastIds.includes(sourceId);
              const targetFastId =
                typeof targetId === "number" && fastIds.includes(targetId) ? targetId : undefined;
              if (sourceIsFast && targetFastId !== undefined) {
                const next = move(fastQueue, event).map((endpoint) => endpoint.id);
                if (next.some((id, index) => id !== fastIds[index])) save.mutate(next);
                return;
              }
              if (targetId === FAST_QUEUE_DROP_ID || targetFastId !== undefined) {
                const withSource = appendFastId(fastIds, sourceId);
                const next = targetFastId
                  ? reorderFastIds(withSource, sourceId, targetFastId)
                  : withSource;
                setFast.mutate({ id: sourceId, fast: true, order: next });
              }
            }}
          >
            <FastQueueTransfer
              fastQueue={fastQueue}
              enabledQueue={enabledQueue}
              moveIntoFast={moveIntoFast}
              remove={remove}
            />
          </DragDropProvider>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 仪表盘首卡（左 2/3 / 右 1/3 双卡片）：
 * 左卡=端点队列（快速队列优先显示）；
 * 右卡=本地代理信息 + 开关 + 端口跳设置，叠加雪山日落场景（开启太阳升起、关闭落下）。
 */
export function ServiceCard() {
  const qc = useQueryClient();
  const { data: status } = useProxyStatus();
  const { data: endpointList } = useEndpoints();
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [fastEditorOpen, setFastEditorOpen] = useState(false);
  // 最近一条请求明细对应的端点（与实时监控同源，第一时间反映轮换/故障转移）。
  const [liveEndpoint, setLiveEndpoint] = useState<string | null>(null);
  // 端点实时健康/熔断态；健康/端点变更事件到达即刷新（共享 hook 统一订阅）。
  useEndpointHealthEvents();
  const { data: epHealth, dataUpdatedAt } = useEndpointHealth();
  const healthByName = useMemo(() => {
    const byName = new Map<string, EndpointHealth>();
    for (const health of epHealth ?? []) byName.set(health.name, health);
    return byName;
  }, [epHealth]);
  const { fastQueue, enabledQueue } = useMemo(
    () => splitEndpointQueues(endpointList ?? []),
    [endpointList],
  );
  const allQueueEndpoints = useMemo(
    () => [...fastQueue, ...enabledQueue],
    [fastQueue, enabledQueue],
  );

  // 实时高亮：新请求明细到达即更新当前工作端点（与下方实时监控同一事件源）。
  useEffect(() => {
    let un: (() => void) | undefined;
    let cancelled = false;
    statsApi.onRequestLogged((log) => setLiveEndpoint(log.endpointName)).then((u) => {
      if (cancelled) u();
      else un = u;
    });
    return () => {
      cancelled = true;
      un?.();
    };
  }, []);

  const running = status?.running ?? false;
  // 停机后清空实时端点，避免重启后短暂高亮上次的陈旧端点。
  useEffect(() => {
    if (!running) setLiveEndpoint(null);
  }, [running]);

  // 优先用最近请求明细的端点；回退代理状态；停机不高亮。
  const current = running ? liveEndpoint ?? status?.currentEndpoint ?? null : null;
  const gatewayUrl =
    status?.port != null ? `http://127.0.0.1:${status.port}` : null;

  const copyGateway = async () => {
    if (!gatewayUrl) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(gatewayUrl);
      } else {
        const ta = document.createElement("textarea");
        ta.value = gatewayUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      toast.success("已复制代理信息");
    } catch {
      toast.error("复制失败");
    }
  };

  const toggle = async (next: boolean) => {
    try {
      const s = next ? await proxyApi.start() : await proxyApi.stop();
      qc.invalidateQueries({ queryKey: ["proxy-status"] });
      toast.success(next ? `代理已启动 · 端口 ${s.port}` : "代理已停止");
    } catch (e) {
      toast.error(`操作失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 md:items-stretch">
        {/* 左 2/3：端点队列 */}
        <Card className="md:col-span-2 md:min-h-full">
          <CardContent className="flex flex-col gap-3 px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-ink-primary">端点队列</h3>
                <span className="text-xs text-ink-mute">
                  <TabularText>{allQueueEndpoints.length}</TabularText>
                </span>
              </div>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setFastEditorOpen(true)}
                className="h-auto p-1"
                aria-label="编辑快速队列"
              >
                <ZapIcon className="size-4" />
              </Button>
            </div>

            <QueueSection
              endpoints={allQueueEndpoints}
              empty="暂无启用端点"
              current={current}
              running={running}
              healthByName={healthByName}
              receivedAt={dataUpdatedAt}
            />
          </CardContent>
        </Card>

        {/* 右 1/3：本地代理信息 + 开关 + 端口跳设置 + 雪山日落场景 */}
        <Card className="relative overflow-hidden md:col-span-1">
          <ProxyScene running={running} dark={dark} />
          {/* 文字可读性遮罩：亮色用白雾托底、暗色用深色压底 */}
          <div
            aria-hidden
            className={cn(
              "pointer-events-none absolute inset-0 z-[5]",
              dark
                ? "bg-gradient-to-t from-black/45 via-black/5 to-black/15"
                : "bg-gradient-to-t from-white/60 via-white/5 to-white/40",
            )}
          />
          <CardContent
            className={cn(
              "relative z-10 flex h-full flex-col justify-between gap-3 px-5 py-4",
              dark
                ? "text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.55)]"
                : "text-slate-800 [text-shadow:0_1px_2px_rgba(255,255,255,0.7)]",
            )}
          >
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">本地代理</span>
              <div className="flex items-center gap-1.5 self-start">
                <button
                  type="button"
                  onClick={() => setActiveView("settings")}
                  className={cn(
                    "cursor-pointer text-xs transition-colors hover:opacity-90",
                    dark
                      ? "text-white/85 hover:text-white"
                      : "text-slate-600 hover:text-slate-900",
                  )}
                  title="前往设置修改端口"
                >
                  端口 <TabularText>{status?.port ?? "—"}</TabularText>
                </button>
                {gatewayUrl ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={copyGateway}
                        className={cn(
                          "inline-flex shrink-0 transition-colors",
                          dark
                            ? "text-white/85 hover:text-white"
                            : "text-slate-600 hover:text-slate-900",
                        )}
                        aria-label="复制代理信息"
                      >
                        <CopyIcon className="size-3" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>点击复制代理信息</TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className={cn("text-xs", dark ? "text-white/85" : "text-slate-600")}>
                {running ? "运行中" : "已停止"}
              </span>
              <Switch
                checked={running}
                onCheckedChange={toggle}
                aria-label="代理开关"
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <FastQueueDialog
        open={fastEditorOpen}
        onOpenChange={setFastEditorOpen}
        fastQueue={fastQueue}
        enabledQueue={enabledQueue}
      />
    </>
  );
}
