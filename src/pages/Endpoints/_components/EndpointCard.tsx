import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ActivityIcon,
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisVerticalIcon,
  GripVerticalIcon,
  PencilIcon,
  SearchIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WaypointsIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Anthropic, Codex, OpenAI } from "@lobehub/icons";
import type { ComponentType } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { TabularText } from "@/components/ui";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEndpointHealth } from "@/hooks/useEndpointHealth";
import { getModelIcon } from "@/lib/model-icons";
import { cn } from "@/lib/utils";
import {
  advertisedModels,
  ENDPOINT_TEST_MESSAGE,
  endpointApi,
  extractTestError,
  extractTestReply,
  outboundModels,
  type Endpoint,
  type EndpointTestResult,
} from "@/services/modules/endpoint";
import { circuitBadgeLabel, type EndpointHealth } from "@/services/modules/health";
import type { EndpointView } from "@/stores";
import { ModelMappingDialog } from "./ModelMappingDialog";
import { TestBadge } from "./TestBadge";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

function testReplyText(result: EndpointTestResult): string {
  if (result.success) {
    return extractTestReply(result.detail) ?? "（无文本回复）";
  }
  const fallback =
    result.message.replace(
      /^(?:鉴权失败（HTTP \d+）|HTTP \d+|请求失败)[:：]?\s*/,
      "",
    ) || result.message;
  return extractTestError(result.detail) ?? fallback;
}

function testStatusCode(result: EndpointTestResult): string {
  return result.httpStatus != null ? `HTTP ${result.httpStatus}` : "";
}

function formatTestSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatTestLog(
  name: string,
  model: string,
  result: EndpointTestResult,
): string {
  return [
    `测试端点：${name}`,
    `使用模型：${model}`,
    `发送消息："${ENDPOINT_TEST_MESSAGE}"`,
    `响应码：${testStatusCode(result)}`,
    testReplyText(result),
    result.success ? "✓ 测试完成！" : "✗ 测试失败",
  ].join("\n");
}

function useTypedFill(full: string, token: string) {
  const [shown, setShown] = useState("");
  useEffect(() => {
    setShown("");
    if (!full) return;
    let i = 0;
    const step = Math.max(1, Math.ceil(full.length / 72));
    const id = window.setInterval(() => {
      i = Math.min(full.length, i + step);
      setShown(full.slice(0, i));
      if (i >= full.length) window.clearInterval(id);
    }, 20);
    return () => window.clearInterval(id);
  }, [full, token]);
  return shown;
}

function TestModelPicker({
  value,
  options,
  disabled,
  onChange,
}: {
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);
  const q = query.trim().toLowerCase();
  const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  return (
    <div ref={rootRef} className="relative">
      <p className="mb-1.5 text-sm text-ink-secondary">选择测试模型</p>
      <button
        type="button"
        disabled={disabled || options.length === 0}
        onClick={() => {
          setQuery("");
          setOpen((o) => !o);
        }}
        className="flex h-9 w-full items-center justify-between rounded-lg border border-primary/40 bg-background px-3 text-left text-sm text-ink-primary disabled:opacity-50"
      >
        <span className="truncate">{value || "选择模型"}</span>
        <ChevronDownIcon
          className={cn("size-4 shrink-0 text-ink-mute", open && "rotate-180")}
        />
      </button>
      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-edge bg-popover shadow-md">
          <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-1.5">
            <SearchIcon className="size-3.5 shrink-0 text-ink-mute" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索..."
              className="w-full bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-mute"
            />
          </div>
          <ul className="max-h-48 overflow-auto py-1">
            {list.length === 0 ? (
              <li className="px-3 py-2 text-center text-xs text-ink-mute">
                无匹配模型
              </li>
            ) : (
              list.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-hover",
                      opt === value
                        ? "bg-surface-hover text-ink-primary"
                        : "text-ink-secondary",
                    )}
                  >
                    <span className="truncate">{opt}</span>
                    {opt === value ? (
                      <CheckIcon className="size-3.5 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function TestResultDialog({
  open,
  name,
  model,
  models,
  result,
  pending,
  onSelectModel,
  onRetry,
  onClose,
}: {
  open: boolean;
  name: string;
  model: string;
  models: string[];
  result: EndpointTestResult | null;
  pending: boolean;
  onSelectModel: (model: string) => void;
  onRetry: () => void;
  onClose: () => void;
}) {
  const full = result && !pending ? testReplyText(result) : "";
  const token = result && !pending ? `${result.latencyMs}:${full}` : "pending";
  const typed = useTypedFill(full, token);

  const copy = () => {
    if (!result) return;
    const text = formatTestLog(name, model, result);
    (navigator.clipboard?.writeText(text) ?? Promise.reject())
      .then(() => toast.success("已复制"))
      .catch(() => toast.error("复制失败"));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>连通性测试</DialogTitle>
        </DialogHeader>
        <TestModelPicker
          value={model}
          options={models}
          onChange={(v) => {
            if (v !== model) onSelectModel(v);
          }}
        />
        <div className="relative rounded-lg border border-edge-subtle bg-surface-raised p-4 text-sm leading-6">
          <Button
            size="icon"
            variant="ghost"
            aria-label="复制摘要"
            className="absolute top-2 right-2 size-7 text-ink-mute"
            onClick={copy}
            disabled={!result}
          >
            <CopyIcon className="size-3.5" />
          </Button>
          <p>
            <span className="text-ink-secondary">测试端点：</span>
            <span className="text-ink-primary">{name}</span>
          </p>
          <p>
            <span className="text-ink-secondary">发送消息：</span>
            <span className="text-ink-primary">"{ENDPOINT_TEST_MESSAGE}"</span>
          </p>
          <p>
            <span className="text-ink-secondary">响应码：</span>
            <TabularText
              className={
                !pending && result && !result.success
                  ? "text-destructive"
                  : "text-primary"
              }
            >
              {!pending && result ? testStatusCode(result) : ""}
            </TabularText>
          </p>
          {!pending && result && !result.success ? (
            <div className="mt-1 rounded-sm border border-destructive/30 bg-destructive/12 px-3 py-2">
              <p className="mb-1 flex items-center gap-1.5 text-xs text-destructive">
                <TriangleAlertIcon className="size-3.5 shrink-0" />
                上游报错
              </p>
              <p className="scrollbar-none max-h-40 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-destructive">
                {testReplyText(result)}
              </p>
            </div>
          ) : (
            <textarea
              readOnly
              value={pending ? "" : typed}
              placeholder={pending ? "正在生成…" : "（无文本回复）"}
              className="scrollbar-none mt-1 min-h-20 w-full resize-y overflow-y-auto rounded-sm border border-edge bg-background px-3 py-2 text-sm leading-6 text-ink-primary outline-none placeholder:text-ink-mute"
            />
          )}
          <div className="mt-3 flex items-center gap-1.5 border-t border-edge pt-3">
            {pending ? (
              <span className="text-ink-secondary">测试中…</span>
            ) : result?.success ? (
              <>
                <CheckIcon className="size-3.5 text-ink-secondary" />
                <span className="text-ink-secondary">测试完成</span>
              </>
            ) : (
              <>
                <XIcon className="size-3.5 text-ink-secondary" />
                <span className="text-ink-secondary">测试失败</span>
              </>
            )}
            {!pending && result ? (
              <TabularText className="text-ink-mute">
                {formatTestSeconds(result.latencyMs)}
              </TabularText>
            ) : null}
          </div>
        </div>
        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button onClick={onRetry} disabled={pending}>
            重试
          </Button>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** 端点 transformer 类型 → 品牌图标（claude→Anthropic、openai→OpenAI、codex→Codex）。OpenAI 无 Color 用默认 Mono，其余用彩色。 */
const TRANSFORMER_ICON: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  claude: Anthropic,
  openai: OpenAI,
  codex: Codex.Color,
};
export const getTransformerIcon = (transformer: string) => TRANSFORMER_ICON[transformer] ?? OpenAI;

/** 熔断徽章：open 本地倒计时，到期显示「待探测」（惰性半开，无流量不会自动恢复）。 */
function CircuitBadge({
  health,
  receivedAt,
}: {
  health: EndpointHealth;
  receivedAt: number;
}) {
  const open = health.circuit === "open";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
  }, [receivedAt]);
  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open]);
  return (
    <Badge
      variant={health.circuit === "open" ? "danger" : "warning"}
      title={health.lastError ?? undefined}
      className="tabular-nums"
    >
      {circuitBadgeLabel(health.circuit, health.cooldownRemainingMs, receivedAt, now)}
    </Badge>
  );
}

function IconAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon"
          variant="ghost"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface Props {
  endpoint: Endpoint;
  onEdit: (e: Endpoint) => void;
  draggable: boolean;
  /** useSortable 的 handleRef；存在时 grip 图标作为拖拽手柄，筛选态下不传。 */
  dragHandleRef?: (element: Element | null) => void;
  /** 展示形态：list 横向行式（默认），grid 纵向小卡片。 */
  view?: EndpointView;
}

export function EndpointCard({
  endpoint,
  onEdit,
  draggable,
  dragHandleRef,
  view = "list",
}: Props) {
  const qc = useQueryClient();
  const invalidate = useCallback(
    () => qc.invalidateQueries({ queryKey: ["endpoints"] }),
    [qc],
  );
  const TransformerIcon = getTransformerIcon(endpoint.transformer);
  const [testOpen, setTestOpen] = useState(false);
  const [testDialogOpen, setTestDialogOpen] = useState(false);
  const [testResult, setTestResult] = useState<EndpointTestResult | null>(null);
  const [testModel, setTestModel] = useState<string>("");
  const [mapOpen, setMapOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // 布局切换后等一帧再启用 transition，避免切换瞬间因 group-hover 触发过渡动画。
  const [toolbarTransition, setToolbarTransition] = useState(false);
  useEffect(() => {
    setToolbarTransition(false);
    if (view !== "grid") return;
    const id = requestAnimationFrame(() => setToolbarTransition(true));
    return () => cancelAnimationFrame(id);
  }, [view]);

  const onMutateError = (e: unknown) => toast.error(errMsg(e));

  // 共享 ["endpoint-health"] 查询（多卡片去重）；展示运行期熔断态。
  const { data: epHealth, dataUpdatedAt } = useEndpointHealth();
  const health = epHealth?.find((h) => h.name === endpoint.name);
  const circuitBadge =
    health && health.circuit !== "closed" ? (
      <CircuitBadge health={health} receivedAt={dataUpdatedAt} />
    ) : null;

  const toggle = useMutation({
    mutationFn: (v: boolean) => endpointApi.update(endpoint.id, { enabled: v }),
    onSuccess: invalidate,
    onError: onMutateError,
  });
  const test = useMutation({
    mutationFn: (model?: string) => endpointApi.test(endpoint.id, model),
    onSuccess: (r, model) => {
      setTestResult(r);
      setTestModel(model || endpoint.model);
      if (r.success) {
        // 测试成功：主动失效健康态，让卡片即时显示可用、熔断 Badge 消失
        // （后端也会 emit endpoint-health-changed；此处覆盖代理未运行、靠 test_status 回退的场景）
        qc.invalidateQueries({ queryKey: ["endpoint-health"] });
      }
      invalidate();
    },
    onError: onMutateError,
  });
  const clone = useMutation({
    mutationFn: () => endpointApi.clone(endpoint.id),
    onSuccess: () => {
      toast.success("已克隆");
      invalidate();
    },
    onError: onMutateError,
  });
  const del = useMutation({
    mutationFn: () => endpointApi.remove(endpoint.id),
    onSuccess: () => {
      toast.success("已删除");
      invalidate();
    },
    onError: onMutateError,
  });
  const archive = useMutation({
    mutationFn: () => endpointApi.archive(endpoint.id),
    onSuccess: () => {
      toast.success("已归档");
      invalidate();
      qc.invalidateQueries({ queryKey: ["archived-endpoints"] });
    },
    onError: onMutateError,
  });

  const grip =
    draggable && dragHandleRef ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            ref={dragHandleRef}
            aria-label="拖动以排序"
            className="shrink-0 cursor-grab touch-none text-ink-mute"
          >
            <GripVerticalIcon className="size-4" />
          </span>
        </TooltipTrigger>
        <TooltipContent>拖动以排序</TooltipContent>
      </Tooltip>
    ) : (
      <GripVerticalIcon className="size-4 shrink-0 text-ink-disabled" />
    );

  const enableSwitch = (
    <span className="inline-flex items-center mt-1">
      <Switch
        checked={endpoint.enabled}
        onCheckedChange={(v) => toggle.mutate(v)}
        aria-label={endpoint.enabled ? "禁用端点" : "启用端点"}
      />
    </span>
  );

  const handleOpenUrl = () => {
    if (window.getSelection()?.isCollapsed === false) return;
    openUrl(endpoint.apiUrl).catch((err) => toast.error(errMsg(err)));
  };

  const startTest = (model?: string) => {
    setTestModel(model || endpoint.model);
    setTestResult(null);
    setTestDialogOpen(true);
    test.mutate(model);
  };

  // 测试连通性用出站(真实)模型：test 直连上游、不经网关，入站映射名上游不认。
  const testModels = outboundModels(endpoint);
  // 可用性展示用公布集合：出站模型并入映射入站名。
  const displayModels = advertisedModels(endpoint);

  // 测试连通性需指定模型：≥2 个模型时弹 Popover 选择，否则直接测（0/1 模型走回落）
  const testButton =
    testModels.length >= 2 ? (
      <Popover open={testOpen} onOpenChange={setTestOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label="测试连通性"
                disabled={test.isPending}
              >
                <ActivityIcon className="size-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>测试连通性</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-56 p-2">
          <p className="mb-1.5 px-1 text-xs text-ink-mute">选择测试模型</p>
          <div className="scrollbar-none flex max-h-60 flex-col gap-1 overflow-auto">
            {testModels.map((m) => {
              const ModelIcon = getModelIcon(m);
              return (
                <button
                  key={m}
                  type="button"
                  className="flex min-w-0 cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-left text-xs hover:bg-surface-hover"
                  onClick={() => {
                    setTestOpen(false);
                    startTest(m);
                  }}
                >
                  <ModelIcon size={14} className="shrink-0" />
                  <span className="truncate font-mono">{m}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    ) : (
      <IconAction
        label="测试连通性"
        onClick={() => startTest(testModels[0])}
        disabled={test.isPending}
      >
        <ActivityIcon className="size-4" />
      </IconAction>
    );

  const moreMenu = (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="icon" variant="ghost" aria-label="更多操作">
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40">
          <DropdownMenuItem
            disabled={clone.isPending}
            onClick={() => clone.mutate()}
          >
            <CopyIcon />
            克隆
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={archive.isPending}
            onClick={() => archive.mutate()}
          >
            <ArchiveIcon />
            归档
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={() => setDeleteOpen(true)}>
            <Trash2Icon />
            删除
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除端点</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-secondary">
            确定删除端点「<span className="font-medium">{endpoint.name}</span>」吗？此操作不可撤销。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={del.isPending}
              onClick={() => {
                del.mutate(undefined, { onSuccess: () => setDeleteOpen(false) });
              }}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  // 映射已启用且至少一条入站→出站配置时高亮图标。
  const mappingActive =
    endpoint.modelMappingsEnabled !== false &&
    (endpoint.modelMappings?.length ?? 0) > 0;

  const actions = (
    <div className="flex gap-0.5">
      {testButton}
      <IconAction label="模型映射" onClick={() => setMapOpen(true)}>
        <WaypointsIcon
          className={`size-4 ${mappingActive ? "text-primary" : ""}`}
        />
      </IconAction>
      <IconAction label="编辑" onClick={() => onEdit(endpoint)}>
        <PencilIcon className="size-4" />
      </IconAction>
      {moreMenu}
      <ModelMappingDialog open={mapOpen} onOpenChange={setMapOpen} endpoint={endpoint} />
      <TestResultDialog
        open={testDialogOpen}
        name={endpoint.name}
        model={testModel || endpoint.model || "（默认）"}
        models={testModels}
        result={testResult}
        pending={test.isPending}
        onSelectModel={setTestModel}
        onRetry={() => startTest(testModel || testModels[0])}
        onClose={() => {
          setTestDialogOpen(false);
          setTestResult(null);
        }}
      />
    </div>
  );

  const meta = (
    <span className="flex min-w-0 items-center text-xs text-ink-secondary">
      <span
        role="link"
        tabIndex={0}
        className="cursor-pointer truncate text-left hover:text-primary"
        title={`在浏览器打开 ${endpoint.apiUrl}`}
        onClick={handleOpenUrl}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          handleOpenUrl();
        }}
      >
        {endpoint.apiUrl}
      </span>
      {endpoint.model ? (
        <span className="shrink-0 select-none whitespace-pre"> · {endpoint.model}</span>
      ) : null}
    </span>
  );

  // 可用性合并：实时请求结果优先于手动测试（healthy/recovering→可用，unhealthy→不可用）；
  // 无实时数据（端点禁用/代理未运行无记录）或 unknown 时回退手动测试结果 testStatus。
  const availabilityStatus =
    health?.status === "healthy" || health?.status === "recovering"
      ? "available"
      : health?.status === "unhealthy"
        ? "unavailable"
        : endpoint.testStatus;

  // 可用性指示：悬停展示该端点模型清单（限高可滚动）
  const availability = (
    <HoverCard openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>
        <span className="cursor-default">
          <TestBadge status={availabilityStatus} />
        </span>
      </HoverCardTrigger>
      <HoverCardContent side="top" className="scrollbar-none max-h-60 w-56 overflow-auto">
        {displayModels.length === 0 ? (
          <span className="text-sm text-ink-mute">无已配置模型</span>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="mb-0.5 text-xs text-ink-secondary">模型（{displayModels.length}）</span>
            {displayModels.map((m) => {
              const ModelIcon = getModelIcon(m);
              return (
                <span key={m} className="flex min-w-0 items-center gap-1.5 text-xs">
                  <ModelIcon size={14} className="shrink-0" />
                  <span className="truncate font-mono">{m}</span>
                </span>
              );
            })}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );

  if (view === "grid") {
    return (
      <Card className="h-full gap-0 py-0">
        <CardContent className="flex h-full flex-col gap-2.5 p-4">
          <div className="flex select-none items-center gap-2">
            <TransformerIcon size={16} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate font-medium">{endpoint.name}</span>
            {/* <Badge variant="muted">{endpoint.transformer}</Badge> */}
            {grip}
          </div>
          {meta}
          <div className="mt-auto flex select-none items-center justify-between gap-2 border-t border-edge-subtle pt-2.5">
            <div className="flex items-center gap-1.5">
              {availability}
              {circuitBadge}
            </div>
            {enableSwitch}
          </div>
          <div className="group/toolbar flex h-9 select-none items-center justify-end">
            <div
              className={cn(
                "pointer-events-none opacity-0 group-hover/toolbar:pointer-events-auto group-hover/toolbar:opacity-100",
                toolbarTransition && "transition-opacity duration-200 ease-in-out",
              )}
            >
              {actions}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-4 py-3">
        <div className="flex shrink-0 select-none items-center gap-2">
          {grip}
          <TransformerIcon size={18} className="shrink-0" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex select-none items-center gap-2">
            <span className="truncate font-medium">{endpoint.name}</span>
            <Badge variant="muted">{endpoint.transformer}</Badge>
            {availability}
            {circuitBadge}
          </div>
          {meta}
        </div>
        <div className="select-none">{enableSwitch}</div>
        <div className="select-none">{actions}</div>
      </CardContent>
    </Card>
  );
}
