import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { endpointApi } from "@/services/modules/endpoint";
import { pricingApi, type PriceRates } from "@/services/modules/pricing";

export const RATE_LABELS = [
  ["input", "输入"], ["output", "输出"], ["cacheRead", "缓存读取"], ["cacheWrite", "缓存创建"],
] as const;

export function PricingHelp({ label, children }: { label: string; children: string }) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" aria-label={label} className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-ink-secondary hover:text-ink-primary focus-visible:ring-2 focus-visible:ring-ring">
        <InfoIcon className="size-3.5" />
      </button>
    </TooltipTrigger>
    <TooltipContent sideOffset={5} className="z-[70] max-w-72 text-pretty">{children}</TooltipContent>
  </Tooltip>;
}

export function PriceRatesView({ rates }: { rates: PriceRates }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
    {RATE_LABELS.map(([key, label]) => <div key={key}>
      <dt className="text-xs text-ink-mute">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm tabular-nums">{rates[key]}</dd>
    </div>)}
  </dl>;
}

/** 仅向后端询价：不在浏览器复刻星期、跨午夜或 DST 匹配。 */
export function ModelPriceQuoteView({ endpointId, modelId, onUseAutoRates }: {
  endpointId: number;
  modelId: string;
  onUseAutoRates?: (rates: PriceRates) => void;
}) {
  const [preview, setPreview] = useState("");
  const at = preview ? new Date(preview).getTime() : undefined;
  const valid = at === undefined || Number.isFinite(at);
  const query = useQuery({
    queryKey: ["model-prices", endpointId, modelId, at],
    queryFn: () => pricingApi.getPrices(endpointId, [modelId], at),
    enabled: !!modelId && valid,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
  const { refetch } = query;
  const quote = query.data?.[0];
  useEffect(() => {
    if (!modelId || !valid) return;
    const refresh = () => { void refetch(); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", visible);
    const unlisten = endpointApi.onChanged(refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", visible);
      void unlisten.then((fn) => fn());
    };
  }, [modelId, valid, refetch]);
  useEffect(() => {
    if (at !== undefined || quote?.nextChangeAt == null) return;
    const timer = window.setTimeout(() => { void refetch(); },
      Math.min(2_147_483_647, Math.max(100, quote.nextChangeAt - Date.now() + 50)));
    return () => window.clearTimeout(timer);
  }, [at, quote, refetch]);

  return <section className="flex flex-col gap-3 rounded-md border border-edge bg-surface-raised p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        <h3 className="text-sm font-medium">{preview ? "指定时间报价" : "当前有效价"}</h3>
        <PricingHelp label="报价预览说明">基于已保存的价格，不含正在编辑的草稿。预览时间使用本机时区，留空查看当前价格。</PricingHelp>
      </div>
      {quote?.source && <Badge variant="muted">{quote.source === "auto" ? "models.dev 自动价" : quote.source === "window" ? quote.ruleName || "时段价" : "默认价"}</Badge>}
    </div>
    {modelId && <div className="flex flex-wrap items-center gap-2">
      <label className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
        预览时间
        <Input type="datetime-local" className="h-8 w-auto" value={preview} onChange={(e) => setPreview(e.target.value)} />
      </label>
      {preview && <Button size="sm" variant="ghost" onClick={() => setPreview("")}>回到当前</Button>}
    </div>}
    {!modelId ? <p className="text-xs text-ink-mute">请输入准确的出站模型 ID</p>
      : !valid ? <p role="alert" className="text-xs text-destructive">请选择有效预览时间</p>
      : query.isError ? <p role="alert" className="text-xs text-destructive">报价查询失败：{String(query.error)}</p>
      : query.isPending ? <p className="text-xs text-ink-mute">正在查询价格…</p>
      : quote ? <>
        {quote.requestedModel !== quote.modelId && <p className="break-all font-mono text-xs text-ink-secondary">{quote.requestedModel} → {quote.modelId}</p>}
        {quote.effectiveRates ? <>
          <PriceRatesView rates={quote.effectiveRates} />
          {quote.timezone && quote.source !== "auto" && <p className="text-xs text-ink-secondary">时段时区：{quote.timezone}</p>}
          {quote.source === "window" && quote.baseRates && <details className="text-xs text-ink-secondary"><summary className="cursor-pointer">默认四价</summary><div className="mt-2"><PriceRatesView rates={quote.baseRates} /></div></details>}
          {quote.source === "auto" && quote.modelId === modelId && onUseAutoRates &&
            <Button size="sm" variant="outline" className="self-start" onClick={() => { if (quote.effectiveRates) onUseAutoRates(quote.effectiveRates); }}>填入默认价</Button>}
        </> : <p className="text-sm text-ink-mute">未配置价格</p>}
        <p className="text-xs text-ink-mute">报价时刻：{new Date(quote.at).toLocaleString()}（本机时区）</p>
        {quote.nextChangeAt != null && <p className="text-xs text-ink-mute">下次变化：{new Date(quote.nextChangeAt).toLocaleString()}（本机时区）</p>}
      </> : <p className="text-sm text-ink-mute">未配置价格</p>}
  </section>;
}
