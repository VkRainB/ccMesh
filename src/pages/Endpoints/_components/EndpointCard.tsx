import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  CopyIcon,
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
  WaypointsIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEndpointHealth } from "@/hooks/useEndpointHealth";
import {
  advertisedModels,
  endpointApi,
  outboundModels,
  type Endpoint,
} from "@/services/modules/endpoint";
import type { EndpointView } from "@/stores";
import { ModelMappingDialog } from "./ModelMappingDialog";
import { TestBadge } from "./TestBadge";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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
  const invalidate = () => qc.invalidateQueries({ queryKey: ["endpoints"] });
  const [testOpen, setTestOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  // 共享 ["endpoint-health"] 查询（多卡片去重）；展示运行期熔断态。
  const { data: epHealth } = useEndpointHealth();
  const health = epHealth?.find((h) => h.name === endpoint.name);
  const circuitBadge =
    health && health.circuit !== "closed" ? (
      <Badge
        variant={health.circuit === "open" ? "danger" : "warning"}
        title={health.lastError ?? undefined}
      >
        {health.circuit === "open" ? "熔断中" : "恢复中"}
      </Badge>
    ) : null;

  const toggle = useMutation({
    mutationFn: (v: boolean) => endpointApi.update(endpoint.id, { enabled: v }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errMsg(e)),
  });
  const test = useMutation({
    mutationFn: (model?: string) => endpointApi.test(endpoint.id, model),
    onSuccess: (r) => {
      r.success
        ? toast.success(`${endpoint.name}：${r.message} (${r.latencyMs}ms)`)
        : toast.error(`${endpoint.name}：${r.message}`);
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const clone = useMutation({
    mutationFn: () => endpointApi.clone(endpoint.id),
    onSuccess: () => {
      toast.success("已克隆");
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const del = useMutation({
    mutationFn: () => endpointApi.remove(endpoint.id),
    onSuccess: () => {
      toast.success("已删除");
      invalidate();
    },
    onError: (e) => toast.error(errMsg(e)),
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
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">
          <Switch
            checked={endpoint.enabled}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label={endpoint.enabled ? "禁用端点" : "启用端点"}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent>{endpoint.enabled ? "禁用端点" : "启用端点"}</TooltipContent>
    </Tooltip>
  );

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
          <div className="flex max-h-60 flex-col gap-0.5 overflow-auto">
            {testModels.map((m) => (
              <button
                key={m}
                type="button"
                className="cursor-pointer rounded px-2 py-1 text-left font-mono text-xs hover:bg-surface-hover"
                onClick={() => {
                  setTestOpen(false);
                  test.mutate(m);
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    ) : (
      <IconAction
        label="测试连通性"
        onClick={() => test.mutate(testModels[0])}
        disabled={test.isPending}
      >
        <ActivityIcon className="size-4" />
      </IconAction>
    );

  const actions = (
    <div className="flex gap-0.5">
      {testButton}
      <IconAction label="模型映射" onClick={() => setMapOpen(true)}>
        <WaypointsIcon className="size-4" />
      </IconAction>
      <IconAction label="克隆" onClick={() => clone.mutate()}>
        <CopyIcon className="size-4" />
      </IconAction>
      <IconAction label="编辑" onClick={() => onEdit(endpoint)}>
        <PencilIcon className="size-4" />
      </IconAction>
      <IconAction label="删除" onClick={() => del.mutate()}>
        <Trash2Icon className="size-4" />
      </IconAction>
      <ModelMappingDialog open={mapOpen} onOpenChange={setMapOpen} endpoint={endpoint} />
    </div>
  );

  const meta = (
    <span className="truncate text-xs text-ink-secondary">
      {endpoint.apiUrl}
      {endpoint.model ? ` · ${endpoint.model}` : ""}
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
      <HoverCardContent side="top" className="max-h-60 w-56 overflow-auto">
        {displayModels.length === 0 ? (
          <span className="text-sm text-ink-mute">无已配置模型</span>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="mb-1 text-xs text-ink-secondary">模型（{displayModels.length}）</span>
            {displayModels.map((m) => (
              <span key={m} className="font-mono text-xs">
                {m}
              </span>
            ))}
          </div>
        )}
      </HoverCardContent>
    </HoverCard>
  );

  if (view === "grid") {
    return (
      <Card className="h-full gap-0 py-0">
        <CardContent className="flex h-full flex-col gap-2.5 p-4">
          <div className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-medium">{endpoint.name}</span>
            <Badge variant="muted">{endpoint.transformer}</Badge>
            {grip}
          </div>
          {meta}
          <div className="mt-auto flex items-center justify-between gap-2 border-t border-edge-subtle pt-2.5">
            <div className="flex items-center gap-1.5">
              {availability}
              {circuitBadge}
            </div>
            {enableSwitch}
          </div>
          <div className="flex justify-end">{actions}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="flex items-center gap-3 px-4 py-3">
        {grip}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{endpoint.name}</span>
            <Badge variant="muted">{endpoint.transformer}</Badge>
            {availability}
            {circuitBadge}
          </div>
          {meta}
        </div>
        {enableSwitch}
        {actions}
      </CardContent>
    </Card>
  );
}
