import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ActivityIcon,
  CopyIcon,
  GripVerticalIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { endpointApi, type Endpoint } from "@/services/modules/endpoint";
import type { EndpointView } from "@/stores";
import { TestBadge } from "./TestBadge";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

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

  const toggle = useMutation({
    mutationFn: (v: boolean) => endpointApi.update(endpoint.id, { enabled: v }),
    onSuccess: invalidate,
    onError: (e) => toast.error(errMsg(e)),
  });
  const test = useMutation({
    mutationFn: () => endpointApi.test(endpoint.id),
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
      <span
        ref={dragHandleRef}
        aria-label="拖动以排序"
        className="shrink-0 cursor-grab touch-none text-ink-mute"
      >
        <GripVerticalIcon className="size-4" />
      </span>
    ) : (
      <GripVerticalIcon className="size-4 shrink-0 text-ink-disabled" />
    );

  const enableSwitch = (
    <Switch
      checked={endpoint.enabled}
      onCheckedChange={(v) => toggle.mutate(v)}
      aria-label="启用"
    />
  );

  const actions = (
    <div className="flex gap-0.5">
      <Button
        size="icon"
        variant="ghost"
        aria-label="测试"
        onClick={() => test.mutate()}
        disabled={test.isPending}
      >
        <ActivityIcon className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" aria-label="克隆" onClick={() => clone.mutate()}>
        <CopyIcon className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" aria-label="编辑" onClick={() => onEdit(endpoint)}>
        <PencilIcon className="size-4" />
      </Button>
      <Button size="icon" variant="ghost" aria-label="删除" onClick={() => del.mutate()}>
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );

  const meta = (
    <span className="truncate text-xs text-ink-secondary">
      {endpoint.apiUrl}
      {endpoint.model ? ` · ${endpoint.model}` : ""}
    </span>
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
            <TestBadge status={endpoint.testStatus} />
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
            <TestBadge status={endpoint.testStatus} />
          </div>
          {meta}
        </div>
        {enableSwitch}
        {actions}
      </CardContent>
    </Card>
  );
}
