import { useEffect, useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { endpointApi, outboundModels, type Endpoint } from "@/services/modules/endpoint";
import type { ModelPricing, PriceRates, PriceWindow } from "@/services/modules/pricing";
import { ModelPriceQuoteView, RATE_LABELS } from "./ModelPriceQuoteView";

type DraftWindow = Omit<PriceWindow, "startMinute" | "endMinute"> & { start: string; end: string };
type DraftModel = Omit<ModelPricing, "windows"> & { windows: DraftWindow[] };
const emptyRates = (): PriceRates => ({ input: "", output: "", cacheRead: "", cacheWrite: "" });
const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
const minute = (value: string, end: boolean) => {
  if (end && value === "24:00") return 1440;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error("请输入有效时间 HH:mm；结束时间允许 24:00");
  const [hour, min] = value.split(":").map(Number);
  return hour * 60 + min;
};

function RatesFields({ value, onChange }: { value: PriceRates; onChange: (rates: PriceRates) => void }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
    {RATE_LABELS.map(([key, label]) => <label key={key} className="flex flex-col gap-1 text-xs text-ink-secondary">
      {label}
      <Input required inputMode="decimal" placeholder="未填写" className="h-8 font-mono text-xs" value={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.value })} />
    </label>)}
  </div>;
}

export function ModelPricingDialog({ open, onOpenChange, endpoint }: {
  open: boolean; onOpenChange: (open: boolean) => void; endpoint: Endpoint;
}) {
  const qc = useQueryClient();
  const listId = useId();
  const [rows, setRows] = useState<DraftModel[]>([]);
  const [selected, setSelected] = useState(0);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState("");
  // ponytail: 仅打开时拷贝；查询刷新绝不能覆盖尚未保存或保存失败的编辑。
  useEffect(() => {
    if (!open) return;
    setRows((endpoint.modelPricing ?? []).map((row) => ({ ...row,
      windows: row.windows.map(({ startMinute, endMinute, ...window }) => ({ ...window, start: clock(startMinute), end: clock(endMinute) })),
    })));
    setSelected(0);
    setError("");
    setDeleteOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 独立编辑快照
  }, [open]);
  const row = rows[selected];
  const update = (patch: Partial<DraftModel>) => setRows((previous) => previous.map((item, i) => i === selected ? { ...item, ...patch } : item));
  const updateWindow = (index: number, patch: Partial<DraftWindow>) => {
    update({ windows: row.windows.map((window, i) => i === index ? { ...window, ...patch } : window) });
  };
  const save = useMutation({
    mutationFn: () => {
      setError("");
      const modelPricing: ModelPricing[] = rows.map((item) => {
        if (!item.modelId.trim()) throw new Error("请输入准确的出站模型 ID");
        for (const rates of [item.baseRates, ...item.windows.map((window) => window.rates)]) {
          if (Object.values(rates).some((value) => !/^\d+(?:\.\d{1,9})?$/.test(value))) {
            throw new Error("价格必须是非负十进制数（四项必填，最多 9 位小数）");
          }
        }
        return { ...item, modelId: item.modelId.trim(), windows: item.windows.map(({ start, end, ...window }) => ({
          ...window, startMinute: minute(start, false), endMinute: minute(end, true),
        })) };
      });
      return endpointApi.update(endpoint.id, { modelPricing });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["endpoints"] });
      void qc.invalidateQueries({ queryKey: ["model-prices", endpoint.id] });
      toast.success("已保存模型价格");
      onOpenChange(false);
    },
    onError: (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      toast.error(message);
    },
  });

  return <Dialog open={open} onOpenChange={(value) => { if (!save.isPending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
      <DialogHeader><DialogTitle>模型价格 · {endpoint.name}</DialogTitle></DialogHeader>
      <p className="text-xs leading-relaxed text-ink-secondary">按本端点 × 准确出站模型 ID 配置；未配置时使用 models.dev 自动价。四价必填，免费请显式填写 0；单位 USD / 百万 token。</p>
      <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {rows.map((item, i) => <Button key={i} size="sm" variant={selected === i ? "secondary" : "outline"}
            onClick={() => setSelected(i)} aria-pressed={selected === i} className="max-w-64 truncate font-mono text-xs">{item.modelId || "新模型"}</Button>)}
          <Button variant="outline" size="sm" onClick={() => {
            setRows([...rows, { modelId: "", timezone: "Asia/Shanghai", baseRates: emptyRates(), windows: [] }]);
            setSelected(rows.length);
          }}><PlusIcon className="size-3.5" />添加模型价格</Button>
        </div>
        {!row ? <p className="rounded-md border border-dashed border-edge p-5 text-center text-sm text-ink-mute">未配置价格 · 添加模型后填写四项默认价</p> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs text-ink-secondary">出站模型 ID（可选择或手输）
              <Input list={listId} value={row.modelId} onChange={(e) => update({ modelId: e.target.value })} className="font-mono text-xs" />
              <datalist id={listId}>{[...new Set([...outboundModels(endpoint), ...endpoint.modelMappings.map((mapping) => mapping.to)])].map((model) => <option key={model} value={model} />)}</datalist>
            </label>
            <label className="flex flex-col gap-1 text-xs text-ink-secondary">IANA 时区（不跟随系统）
              <Input value={row.timezone} placeholder="Asia/Shanghai" onChange={(e) => update({ timezone: e.target.value })} className="font-mono text-xs" />
            </label>
          </div>
          <section className="flex flex-col gap-2 rounded-md border border-edge p-3"><h3 className="text-sm font-medium">默认价</h3><RatesFields value={row.baseRates} onChange={(baseRates) => update({ baseRates })} /></section>
          <div className="flex flex-col gap-3">
            <p className="text-xs leading-relaxed text-ink-mute">时段左闭右开；跨午夜归属于开始日；全天填 00:00–24:00。星期按所选时区计算，同一模型的时段不能重叠。未命中时使用默认价。</p>
            {row.windows.map((window, i) => <section key={window.id} className="flex flex-col gap-3 rounded-md border border-edge p-3">
              <div className="flex items-end gap-2">
                <label className="flex flex-1 flex-col gap-1 text-xs text-ink-secondary">时段名称<Input value={window.name} onChange={(e) => updateWindow(i, { name: e.target.value })} className="h-8" /></label>
                <Button size="icon" variant="ghost" aria-label={`删除时段 ${window.name || i + 1}`} onClick={() => update({ windows: row.windows.filter((_, index) => index !== i) })}><Trash2Icon className="size-4" /></Button>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="开始日星期">
                {["一", "二", "三", "四", "五", "六", "日"].map((day, index) => <Button key={day} type="button" size="sm" variant={window.weekdays.includes(index + 1) ? "secondary" : "outline"}
                  aria-label={`周${day}`} aria-pressed={window.weekdays.includes(index + 1)} onClick={() => updateWindow(i, { weekdays: window.weekdays.includes(index + 1) ? window.weekdays.filter((value) => value !== index + 1) : [...window.weekdays, index + 1] })}>周{day}</Button>)}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-xs text-ink-secondary">开始（HH:mm）<Input placeholder="22:00" value={window.start} onChange={(e) => updateWindow(i, { start: e.target.value })} className="h-8 font-mono" /></label>
                <label className="flex flex-col gap-1 text-xs text-ink-secondary">结束（允许 24:00）<Input placeholder="08:00" value={window.end} onChange={(e) => updateWindow(i, { end: e.target.value })} className="h-8 font-mono" /></label>
              </div>
              <RatesFields value={window.rates} onChange={(rates) => updateWindow(i, { rates })} />
            </section>)}
            <Button size="sm" variant="outline" className="self-start" onClick={() => update({ windows: [...row.windows, {
              id: crypto.randomUUID(), name: "", weekdays: [], start: "", end: "", rates: emptyRates(),
            }] })}><PlusIcon className="size-3.5" />添加时段</Button>
          </div>
          <p className="text-xs text-ink-mute">以下为当前有效报价（未保存编辑不参与预览）；入站别名由后端解析，编辑时请使用实际出站 ID。</p>
          <ModelPriceQuoteView key={`${endpoint.id}-${selected}`} endpointId={endpoint.id} modelId={row.modelId.trim()} />
          <Button size="sm" variant="ghost" className="self-start text-destructive" onClick={() => setDeleteOpen(true)}><Trash2Icon className="size-3.5" />删除模型价格</Button>
        </>}
      </fieldset>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "正在保存…" : "保存价格"}</Button>
      </DialogFooter>
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}><DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>删除模型价格</DialogTitle></DialogHeader>
        <p className="text-sm text-ink-secondary">删除后，新请求将显示未配置价格；历史估算成本保持不变。</p>
        <p className="text-xs text-ink-mute">删除将在点击「保存价格」后生效。</p>
        <DialogFooter><Button variant="outline" onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="destructive" onClick={() => {
          setRows(rows.filter((_, i) => i !== selected)); setSelected(Math.max(0, selected - 1)); setDeleteOpen(false);
        }}>删除模型价格</Button></DialogFooter>
      </DialogContent></Dialog>
    </DialogContent>
  </Dialog>;
}
