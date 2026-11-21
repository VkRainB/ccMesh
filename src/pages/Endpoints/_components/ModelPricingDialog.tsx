import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDownIcon, PlusIcon, Trash2Icon, ZapIcon } from "lucide-react";
import { toast } from "sonner";

import { ModelCombobox } from "@/components/business/ModelCombobox";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { endpointApi, outboundModels, type Endpoint } from "@/services/modules/endpoint";
import type { ModelPricing, PriceRates, PriceWindow } from "@/services/modules/pricing";
import { ModelPriceQuoteView, PricingHelp, RATE_LABELS } from "./ModelPriceQuoteView";

type DraftWindow = Omit<PriceWindow, "startMinute" | "endMinute"> & { start: string; end: string };
type DraftModel = Omit<ModelPricing, "windows"> & { windows: DraftWindow[] };

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 7];
const DAYS = ["一", "二", "三", "四", "五", "六", "日"];
const DAY_PRESETS = [["每天", [...WEEKDAYS, ...WEEKEND]], ["工作日", WEEKDAYS], ["周末", WEEKEND]] as const;
// https://api-docs.deepseek.com/quick_start/pricing — 参考官方标价，仅填草稿。
const DEEPSEEK_PRESETS = [
  {
    label: "Flash", modelId: "deepseek-flash",
    aliases: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
    offPeak: { input: "0.15", output: "0.6", cacheRead: "0.003", cacheWrite: "0" },
    peak: { input: "0.3", output: "1.2", cacheRead: "0.006", cacheWrite: "0" },
  },
  {
    label: "Pro", modelId: "deepseek-v4-pro", aliases: [],
    offPeak: { input: "0.66", output: "1.98", cacheRead: "0.022", cacheWrite: "0" },
    peak: { input: "1.32", output: "3.96", cacheRead: "0.044", cacheWrite: "0" },
  },
];

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
  const titleRef = useRef<HTMLHeadingElement>(null);
  const confirmTrigger = useRef<HTMLButtonElement>(null);
  const modelInputId = useId();
  const modelOptions = [...new Set([
    ...outboundModels(endpoint),
    ...endpoint.modelMappings.map(({ to }) => to),
  ])];
  const [rows, setRows] = useState<DraftModel[]>([]);
  const [selected, setSelected] = useState(0);
  const [confirmAction, setConfirmAction] = useState<"delete" | "deepseek" | null>(null);
  const [expandedWindow, setExpandedWindow] = useState<string | null>(null);
  const [error, setError] = useState("");
  // ponytail: 仅打开时拷贝；查询刷新绝不能覆盖尚未保存或保存失败的编辑。
  useEffect(() => {
    if (!open) return;
    setRows((endpoint.modelPricing ?? []).map((row) => ({ ...row,
      windows: row.windows.map(({ startMinute, endMinute, ...window }) => ({ ...window, start: clock(startMinute), end: clock(endMinute) })),
    })));
    setSelected(0);
    setError("");
    setConfirmAction(null);
    setExpandedWindow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 独立编辑快照
  }, [open]);
  const row = rows[selected];
  const modelId = row?.modelId.trim() ?? "";
  const officialDeepSeek = URL.canParse(endpoint.apiUrl) && new URL(endpoint.apiUrl).origin === "https://api.deepseek.com";
  const matchingPreset = DEEPSEEK_PRESETS.find((preset) => preset.modelId === modelId || preset.aliases.includes(modelId));
  const hasBaseRates = row && Object.values(row.baseRates).some(Boolean);
  const update = (patch: Partial<DraftModel>) => setRows((previous) => previous.map((item, i) => i === selected ? { ...item, ...patch } : item));
  const updateWindow = (index: number, patch: Partial<DraftWindow>) => {
    update({ windows: row.windows.map((window, i) => i === index ? { ...window, ...patch } : window) });
  };
  const applyDeepSeek = (preset: (typeof DEEPSEEK_PRESETS)[number]) => {
    // ponytail: 复用每周规则，不推断中国法定节假日；精确匹配需要可维护的日历例外。
    const windows = [["上午高峰", "09:00", "12:00"], ["下午高峰", "14:00", "18:00"]]
      .map(([name, start, end]) => ({ id: crypto.randomUUID(), name, start, end, weekdays: WEEKDAYS, rates: preset.peak }));
    const draft = { modelId: modelId || preset.modelId, timezone: "Asia/Shanghai", baseRates: preset.offPeak, windows };
    if (row) update(draft);
    else setRows([draft]);
    setExpandedWindow(null);
    setConfirmAction(null);
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
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}>
      <DialogHeader className="shrink-0 border-b border-edge px-6 py-4 pr-14">
        <div className="flex items-center gap-2">
          <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">模型价格 · {endpoint.name}</DialogTitle>
          <PricingHelp label="价格配置说明">按当前端点和准确的出站模型 ID 配置。未配置时回退到 models.dev 自动价。</PricingHelp>
        </div>
        <DialogDescription className="sr-only">配置出站模型的默认价和每周时段价。</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto px-6 py-4">
      <fieldset disabled={save.isPending} className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {rows.map((item, i) => <Button key={i} size="sm" variant={selected === i ? "secondary" : "outline"}
            onClick={() => setSelected(i)} aria-pressed={selected === i} className="max-w-64 truncate font-mono text-xs">{item.modelId || "新模型"}</Button>)}
          <Button variant="outline" size="sm" onClick={() => {
            setRows([...rows, { modelId: "", timezone: "Asia/Shanghai", baseRates: emptyRates(), windows: [] }]);
            setSelected(rows.length);
          }}><PlusIcon className="size-3.5" />添加模型价格</Button>
          <Button variant="outline" size="sm" aria-haspopup="dialog" onClick={(e) => {
            confirmTrigger.current = e.currentTarget;
            setConfirmAction("deepseek");
          }}>
            <ZapIcon className="size-3.5" />DeepSeek 价格快捷设置
          </Button>
        </div>
        {!row ? <p className="rounded-md border border-dashed border-edge p-5 text-center text-sm text-ink-mute">未配置价格 · 添加模型后填写四项默认价</p> : <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor={modelInputId} className="text-xs text-ink-secondary">出站模型 ID</label>
              <ModelCombobox key={selected} id={modelInputId} options={modelOptions} value={row.modelId}
                onChange={(modelId) => update({ modelId })} placeholder="选择或输入模型 ID" />
            </div>
          </div>
          <section className="flex flex-col gap-2 rounded-md border border-edge p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium">默认价</h3>
                <PricingHelp label="默认价说明">未匹配时段时使用默认价。输入对应未命中缓存，缓存读取对应命中。四项必填，免费须明确填 0。</PricingHelp>
              </div>
              <span className="text-xs text-ink-mute">USD / 百万 token</span>
            </div>
            <RatesFields value={row.baseRates} onChange={(baseRates) => update({ baseRates })} />
          </section>
          <section className="flex flex-col gap-2 rounded-md border border-edge p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h3 className="text-sm font-medium">每周时段价</h3>
                <PricingHelp label="时段规则说明">按指定 IANA 时区计算，不跟随本机时区。包含开始、不含结束；跨午夜归属开始日。全天填 00:00–24:00。时段不能重叠。</PricingHelp>
              </div>
              <Button size="sm" variant="outline" onClick={() => {
                const id = crypto.randomUUID();
                update({ windows: [...row.windows, { id, name: "", weekdays: [], start: "", end: "", rates: emptyRates() }] });
                setExpandedWindow(id);
              }}><PlusIcon className="size-3.5" />添加时段</Button>
            </div>
            {row.windows.length ? <label className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
              时段时区
              <Input value={row.timezone} placeholder="Asia/Shanghai"
                onChange={(e) => update({ timezone: e.target.value })} className="h-8 w-44 font-mono text-xs" />
            </label> : <p className="text-xs text-ink-mute">未添加时段，始终使用默认价</p>}
            {row.windows.map((window, i) => {
              const expanded = expandedWindow === window.id;
              const days = DAY_PRESETS.find(([, preset]) => preset.length === window.weekdays.length
                && preset.every((day) => window.weekdays.includes(day)))?.[0]
                ?? DAYS.filter((_, day) => window.weekdays.includes(day + 1)).map((day) => `周${day}`).join("、");
              return <div key={window.id} className="rounded-md border border-edge">
                <div className="flex items-center justify-between gap-2 px-2">
                  <button type="button" aria-expanded={expanded} onClick={() => setExpandedWindow(expanded ? null : window.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-sm">
                    <ChevronDownIcon className={`size-4 shrink-0 text-ink-secondary ${expanded ? "rotate-180" : ""}`} />
                    <span className="truncate font-medium">{window.name || `时段 ${i + 1}`}</span>
                    <span className="truncate text-xs text-ink-secondary">{[days, window.start && window.end && `${window.start}–${window.end}`].filter(Boolean).join(" · ")}</span>
                  </button>
                  <Button size="icon" variant="ghost" aria-label={`删除时段 ${window.name || i + 1}`} onClick={() => update({ windows: row.windows.filter((_, index) => index !== i) })}><Trash2Icon className="size-4" /></Button>
                </div>
                {expanded && <div className="flex flex-col gap-3 border-t border-edge p-3">
                  <label className="flex flex-col gap-1 text-xs text-ink-secondary">时段名称<Input value={window.name} onChange={(e) => updateWindow(i, { name: e.target.value })} className="h-8" /></label>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="开始日星期">
                    {DAYS.map((day, index) => <Button key={day} size="sm" variant={window.weekdays.includes(index + 1) ? "secondary" : "outline"}
                      aria-pressed={window.weekdays.includes(index + 1)} onClick={() => updateWindow(i, { weekdays: window.weekdays.includes(index + 1) ? window.weekdays.filter((value) => value !== index + 1) : [...window.weekdays, index + 1] })}>周{day}</Button>)}
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    {DAY_PRESETS.map(([label, weekdays]) => <Button key={label} size="sm" variant="ghost" onClick={() => updateWindow(i, { weekdays: [...weekdays] })}>{label}</Button>)}
                    <Button size="sm" variant="ghost" className="ml-auto" disabled={!hasBaseRates} onClick={() => updateWindow(i, { rates: row.baseRates })}>复制默认价</Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs text-ink-secondary">开始（HH:mm）<Input placeholder="22:00" value={window.start} onChange={(e) => updateWindow(i, { start: e.target.value })} className="h-8 font-mono" /></label>
                    <label className="flex flex-col gap-1 text-xs text-ink-secondary">结束（允许 24:00）<Input placeholder="08:00" value={window.end} onChange={(e) => updateWindow(i, { end: e.target.value })} className="h-8 font-mono" /></label>
                  </div>
                  <RatesFields value={window.rates} onChange={(rates) => updateWindow(i, { rates })} />
                </div>}
              </div>;
            })}
          </section>
          <ModelPriceQuoteView key={`${endpoint.id}-${selected}`} endpointId={endpoint.id} modelId={modelId}
            onUseAutoRates={!hasBaseRates ? (baseRates) => update({ baseRates }) : undefined} />
          <Button size="sm" variant="ghost" className="self-start text-destructive" onClick={(e) => {
            confirmTrigger.current = e.currentTarget;
            setConfirmAction("delete");
          }}><Trash2Icon className="size-3.5" />删除模型价格</Button>
        </>}
      </fieldset>
      </div>
      <DialogFooter className="shrink-0 items-center border-t border-edge px-6 py-3">
        {error && <p role="alert" className="mr-auto text-sm text-destructive">{error}</p>}
        <Button variant="outline" disabled={save.isPending} onClick={() => onOpenChange(false)}>取消</Button>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? "正在保存…" : "保存价格"}</Button>
      </DialogFooter>
      <Dialog open={confirmAction !== null} onOpenChange={(value) => { if (!value) setConfirmAction(null); }}>
        <DialogContent className="sm:max-w-md" onCloseAutoFocus={(e) => {
          if (!confirmTrigger.current?.isConnected) return;
          e.preventDefault();
          confirmTrigger.current.focus();
        }}>
          <DialogHeader><DialogTitle>{confirmAction === "deepseek" ? "DeepSeek 价格快捷设置" : "删除模型价格"}</DialogTitle></DialogHeader>
          {confirmAction === "deepseek" ? <>
            <DialogDescription>
              {modelId ? <>将模板填入 <span className="break-all font-mono">{modelId}</span>，不改模型 ID。</> : "未填写出站模型 ID，将使用模板自带的 ID。"}
              {hasBaseRates || row?.windows.length ? " 此操作会覆盖当前草稿中的默认价、时区和时段。" : ""}
              {" 仅填入草稿，保存后才生效。"}
            </DialogDescription>
            <p className="text-xs text-ink-secondary">默认填低谷价；高峰为北京时间周一至周五 09:00–12:00、14:00–18:00，不自动排除中国法定节假日。</p>
            {!officialDeepSeek && <p className="text-xs text-warning">第三方端点以渠道实际价格为准，保存前请核对。</p>}
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmAction(null)}>取消</Button>
              {(matchingPreset ? [matchingPreset] : DEEPSEEK_PRESETS).map((preset) => {
                const duplicate = !modelId && rows.some((item) => item.modelId.trim() === preset.modelId);
                return <Button key={preset.modelId} disabled={duplicate} onClick={() => applyDeepSeek(preset)}>
                  {duplicate ? `${preset.label} 已配置` : `填入 ${preset.label}`}
                </Button>;
              })}
            </DialogFooter>
          </> : <>
            <DialogDescription>删除后，新请求将回退自动价；没有自动价时显示未配置。历史估算成本保持不变，保存后生效。</DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmAction(null)}>取消</Button>
              <Button variant="destructive" onClick={() => {
                setRows(rows.filter((_, i) => i !== selected));
                setSelected(Math.max(0, selected - 1));
                setConfirmAction(null);
              }}>删除模型价格</Button>
            </DialogFooter>
          </>}
        </DialogContent>
      </Dialog>
    </DialogContent>
  </Dialog>;
}
