import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import { endpointApi } from "@/services/modules/endpoint";
import { pricingApi, type PriceRates } from "@/services/modules/pricing";

export const RATE_LABELS = [
  ["input", "输入"], ["output", "输出"], ["cacheRead", "缓存读取"], ["cacheWrite", "缓存创建"],
] as const;

export function PriceRatesView({ rates }: { rates: PriceRates }) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
    {RATE_LABELS.map(([key, label]) => <div key={key}>
      <dt className="text-xs text-ink-mute">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm tabular-nums">{rates[key]}</dd>
    </div>)}
  </dl>;
}

/** 仅向后端询价：不在浏览器复刻星期、跨午夜或 DST 匹配。 */
export function ModelPriceQuoteView({ endpointId, modelId }: { endpointId: number; modelId: string }) {
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
      <h3 className="text-sm font-medium">{preview ? "指定时间预览" : "当前有效价"}</h3>
      <span className="text-xs text-ink-mute">USD / 百万 token</span>
    </div>
    <label className="flex flex-wrap items-center gap-2 text-xs text-ink-secondary">
      预览时间（本机时区，留空为当前）
      <Input type="datetime-local" aria-label="预览时间" className="h-8 w-auto" value={preview} onChange={(e) => setPreview(e.target.value)} />
    </label>
    {!modelId ? <p className="text-xs text-ink-mute">请输入准确的出站模型 ID</p>
      : !valid ? <p role="alert" className="text-xs text-destructive">请选择有效预览时间</p>
      : query.isError ? <p role="alert" className="text-xs text-destructive">报价查询失败：{String(query.error)}</p>
      : query.isPending ? <p className="text-xs text-ink-mute">正在查询价格…</p>
      : quote ? <>
        <p className="break-all font-mono text-xs text-ink-secondary">{quote.requestedModel} → {quote.modelId}</p>
        {quote.effectiveRates ? <>
          <PriceRatesView rates={quote.effectiveRates} />
          <p className="text-xs text-ink-secondary">{quote.source === "auto" ? "models.dev 自动价" : <>{quote.source === "window" ? `时段：${quote.ruleName || quote.ruleId}` : "默认价"} · {quote.timezone}</>}</p>
          {quote.baseRates && <details className="text-xs text-ink-secondary"><summary className="cursor-pointer">默认四价</summary><div className="mt-2"><PriceRatesView rates={quote.baseRates} /></div></details>}
        </> : <p className="text-sm text-ink-mute">未配置价格</p>}
        <p className="text-xs text-ink-mute">报价时刻：{new Date(quote.at).toLocaleString()}（本机时区）</p>
        {quote.nextChangeAt != null && <p className="text-xs text-ink-mute">下次变化：{new Date(quote.nextChangeAt).toLocaleString()}（本机时区）</p>}
      </> : <p className="text-sm text-ink-mute">未配置价格</p>}
  </section>;
}
