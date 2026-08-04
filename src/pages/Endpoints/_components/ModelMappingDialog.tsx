import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRightIcon, InfoIcon, PlusIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  endpointApi,
  litOutboundModels,
  type Endpoint,
  type ModelMapping,
} from "@/services/modules/endpoint";

import { MODEL_MAPPING_PRESETS } from "./modelMappingPresets";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  endpoint: Endpoint;
}

/** 端点模型映射弹窗：左=入站(手输) 中=→ 右=出站(仅该端点可用模型)，支持多条与总开关。 */
export function ModelMappingDialog({ open, onOpenChange, endpoint }: Props) {
  const qc = useQueryClient();
  // 出站候选按点亮模型过滤（未点亮任何项时回退全部），与对外公布口径一致。
  const outbound = litOutboundModels(endpoint);
  const [rows, setRows] = useState<ModelMapping[]>([]);
  const [enabled, setEnabled] = useState(true);

  // 仅在打开弹窗时灌入服务端状态。开关即时保存会 invalidate endpoint，
  // 若依赖 endpoint 会把未点保存的 rows 冲掉——开关与映射列表各自独立。
  useEffect(() => {
    if (!open) return;
    setRows(endpoint.modelMappings ?? []);
    setEnabled(endpoint.modelMappingsEnabled !== false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 故意不跟 endpoint
  }, [open]);

  const defaultTo = outbound[0] ?? "";
  const addRow = () => setRows((r) => [...r, { from: "", to: defaultTo }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const setFrom = (i: number, v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, from: v } : row)));
  const setTo = (i: number, v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, to: v } : row)));
  const hasFrom = (from: string) =>
    rows.some((r) => r.from.trim().toLowerCase() === from.trim().toLowerCase());
  /** 快捷添加：入站用预设 from，出站默认第一个可用模型；关闭映射或已存在同名入站则忽略。 */
  const addPreset = (from: string) => {
    if (!enabled || !defaultTo || hasFrom(from)) return;
    setRows((r) => [...r, { from, to: defaultTo }]);
  };

  const toggleEnabled = useMutation({
    mutationFn: (v: boolean) =>
      endpointApi.update(endpoint.id, { modelMappingsEnabled: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["endpoints"] }),
    onError: (e, v) => {
      setEnabled(!v); // 失败回滚开关
      toast.error(errMsg(e));
    },
  });

  const save = useMutation({
    mutationFn: () => {
      const cleaned = rows
        .map((r) => ({ from: r.from.trim(), to: r.to.trim() }))
        .filter((r) => r.from && r.to);
      return endpointApi.update(endpoint.id, { modelMappings: cleaned });
    },
    onSuccess: () => {
      toast.success("已保存模型映射");
      qc.invalidateQueries({ queryKey: ["endpoints"] });
      onOpenChange(false);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const noModels = outbound.length === 0;
  const onEnabledChange = (v: boolean) => {
    setEnabled(v);
    toggleEnabled.mutate(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle>模型映射 · {endpoint.name}</DialogTitle>
            <label className="flex shrink-0 items-center gap-2 text-sm text-ink-secondary">
              <span>启用映射</span>
              <Switch
                checked={enabled}
                onCheckedChange={onEnabledChange}
                disabled={toggleEnabled.isPending}
                aria-label="启用模型映射"
              />
            </label>
          </div>
        </DialogHeader>

        <div className="rounded-md border border-edge bg-surface-raised px-3 py-2.5 text-xs leading-relaxed text-ink-secondary">
          <p>「入站模型」请求时改写为「出站模型」转发上游；关闭则不生效</p>
          <p className="mt-1 pl-1.5 font-mono text-ink-mute">
            例：客户端 gpt-5.5 → 上游 claude-opus-4-8
          </p>
        </div>

        {noModels ? (
          <p className="rounded-md border border-edge bg-surface-raised px-3 py-2 text-sm text-ink-secondary">
            暂无可用模型，请先在端点中点亮模型或锁定模型后再添加映射。
          </p>
        ) : (
          <div
            className={`flex flex-col overflow-hidden rounded-md border border-edge ${
              enabled ? "" : "opacity-50"
            }`}
          >
            <div className="flex items-center gap-2 border-b border-edge bg-surface-raised px-3 py-2 text-xs text-ink-mute">
              <span className="flex-1">入站模型（手动输入）</span>
              <span className="w-4" />
              <span className="flex flex-1 items-center gap-1.5">
                出站模型（可用模型）
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InfoIcon className="size-3.5 cursor-help text-ink-disabled" />
                  </TooltipTrigger>
                  <TooltipContent>仅该端点点亮模型，未点亮则全部</TooltipContent>
                </Tooltip>
              </span>
              <span className="w-8" />
            </div>

            <div className="flex flex-col gap-2 p-3">
              {rows.length === 0 ? (
                <div className="flex flex-col items-center rounded-md border border-dashed border-edge px-3 py-6">
                  <Button type="button" variant="outline" size="sm" onClick={addRow}>
                    <PlusIcon className="size-4" />
                    添加映射
                  </Button>
                </div>
              ) : (
                <>
                  {rows.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        className="flex-1 font-mono text-xs"
                        placeholder="gpt-5.5"
                        value={row.from}
                        onChange={(e) => setFrom(i, e.target.value)}
                      />
                      <ArrowRightIcon className="size-4 shrink-0 text-ink-mute" />
                      <div className="flex-1">
                        <Select value={row.to} onValueChange={(v) => setTo(i, v)}>
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="选择出站模型" />
                          </SelectTrigger>
                          <SelectContent>
                            {outbound.map((m) => (
                              <SelectItem key={m} value={m} className="font-mono text-xs">
                                {m}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label="移除该映射"
                        onClick={() => removeRow(i)}
                      >
                        <XIcon className="size-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="self-start"
                    onClick={addRow}
                  >
                    <PlusIcon className="size-4" />
                    添加映射
                  </Button>
                </>
              )}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {MODEL_MAPPING_PRESETS.map((p) => {
                  const used = hasFrom(p.from);
                  const blocked = !enabled || used;
                  return (
                    <button
                      key={p.from}
                      type="button"
                      disabled={blocked}
                      title={
                        !enabled
                          ? "请先启用映射"
                          : used
                            ? `已有入站「${p.from}」`
                            : `添加入站 ${p.from}`
                      }
                      aria-label={`快捷添加 ${p.label}`}
                      onClick={() => addPreset(p.from)}
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-40 ${p.color}`}
                    >
                      + {p.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={() => save.mutate()} disabled={noModels || save.isPending}>
            保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
