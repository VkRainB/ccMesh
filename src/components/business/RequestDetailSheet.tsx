import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { InfoIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogDescription, DialogHeader,
  DialogOverlay, DialogPortal, DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtDateTime, formatDuration, formatOutputTps } from "@/lib/format";
import type { RequestLog } from "@/services/modules/stats";
import { useLayoutStore } from "@/stores";

export const COST_LABELS = {
  priced: "已计价",
  unpriced: "未配置价格",
  incomplete_usage: "用量不完整，未计价",
  calculation_error: "成本计算失败",
  legacy_unknown: "历史记录无费率快照",
} as const;

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-4 text-xs">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono leading-4 tabular-nums">{children}</dd>
    </dl>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-1.5 rounded-lg border border-edge p-4">{children}</div>
    </section>
  );
}

export function formatErrorBody(errorBody: string): string {
  try {
    return JSON.stringify(JSON.parse(errorBody), null, 2);
  } catch {
    return errorBody;
  }
}

export function ErrorDetail({ errorBody }: { errorBody: string }) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="text-sm font-semibold">错误详情</h3>
      <pre className="whitespace-pre-wrap break-words rounded-lg border border-destructive/30 p-4 font-mono text-xs text-ink-secondary [overflow-wrap:anywhere]">
        {formatErrorBody(errorBody)}
      </pre>
    </section>
  );
}

export function CostDetail({ log }: { log: RequestLog }) {
  const snapshot = log.pricingSnapshot;
  const estimated = log.outputEstimated ? "≈" : "";
  const parts = [
    ["input", "输入", log.inputTokens, ""],
    ["output", "输出", log.outputTokens, estimated],
    ["cacheRead", "缓存读取", log.cacheReadTokens, ""],
    ["cacheWrite", "缓存创建", log.cacheCreationTokens, ""],
  ] as const;
  const usageTotal = log.inputTokens + log.outputTokens + log.cacheReadTokens + log.cacheCreationTokens;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Token明细</h3>
        {log.costStatus && log.costStatus !== "legacy_unknown" && (
          <span className="text-xs text-ink-secondary">{COST_LABELS[log.costStatus]}</span>
        )}
      </div>
      {log.costStatus !== "priced" && log.costReason && <p className="break-words text-xs text-ink-secondary">{log.costReason}</p>}
      <div className="overflow-hidden rounded-lg border border-edge">
        <div className="flex flex-col gap-1.5 p-4">
          <DetailRow label="计价模型">{log.pricingModel ?? snapshot?.modelId ?? ""}</DetailRow>
          <DetailRow label="规则">{snapshot ? snapshot.source === "auto" ? "models.dev" : snapshot.source === "base" ? "默认价" : snapshot.ruleName || snapshot.ruleId : ""}</DetailRow>
          <DetailRow label="时区">{snapshot?.source === "auto" ? "—" : snapshot?.timezone ?? ""}</DetailRow>
          <DetailRow label="计价时刻">{log.pricingAt != null ? fmtDateTime(log.pricingAt) : ""}</DetailRow>
        </div>
        <table className="w-full table-fixed border-t border-edge text-xs">
          <thead className="text-ink-mute">
            <tr>
              <th className="w-[22%] px-4 py-2 text-left font-normal">分项</th>
              <th className="px-2 py-2 text-right font-normal">
                <span className="inline-flex items-center justify-end gap-1">
                  计价
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" className="text-ink-mute transition-colors hover:text-ink-secondary" aria-label="USD / 百万 token">
                        <InfoIcon className="size-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>USD / 百万 token</TooltipContent>
                  </Tooltip>
                </span>
              </th>
              <th className="px-2 py-2 text-right font-normal">成本</th>
              <th className="px-4 py-2 text-right font-normal">用量</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(([key, label, tokens, prefix]) => (
              <tr key={key}>
                <td className="px-4 py-1 text-ink-secondary">{label}</td>
                <td className="break-all px-2 py-1 text-right font-mono tabular-nums">{snapshot?.rates[key] ?? "—"}</td>
                <td className="break-all px-2 py-1 text-right font-mono tabular-nums">{log.costStatus === "priced" ? log.cost?.[key] ?? "—" : "—"}</td>
                <td className="break-all px-4 py-1 text-right font-mono tabular-nums">{prefix}{tokens.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-edge">
              <td className="px-4 py-2 text-ink-secondary">合计</td>
              <td className="px-2 py-2 text-right font-mono text-ink-mute">—</td>
              <td className="break-all px-2 py-2 text-right font-mono font-semibold tabular-nums">{log.costStatus === "priced" && log.cost ? `$${log.cost.total}` : "—"}</td>
              <td className="break-all px-4 py-2 text-right font-mono font-semibold tabular-nums">{estimated}{usageTotal.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function RequestDetail({ log }: { log: RequestLog }) {
  const tps = log.isError ? null : formatOutputTps(log.outputTokens, log.durationMs, log.outputEstimated);
  return (
    <>
      <DetailSection title="基本信息">
        <DetailRow label="完成时间">{fmtDateTime(log.ts)}</DetailRow>
        <DetailRow label="端点">{log.endpointName}</DetailRow>
        <DetailRow label="状态">{log.statusCode ?? "ERR"}{log.isError ? " · 请求失败" : ""}</DetailRow>
        <DetailRow label="请求模型">{log.model?.trim() || ""}</DetailRow>
        <DetailRow label="实际模型">{log.actualModel?.trim() || log.model?.trim() || ""}</DetailRow>
        <DetailRow label="入站协议">{log.inboundFormat || ""}</DetailRow>
        <DetailRow label="入站路径">{log.inboundPath || ""}</DetailRow>
        <DetailRow label="出站路径">{log.upstreamPath || ""}</DetailRow>
        <DetailRow label="上游地址">{log.upstreamUrl || ""}</DetailRow>
      </DetailSection>
      <CostDetail log={log} />
      <DetailSection title="性能">
        {log.isError ? <div className="text-xs text-ink-mute">请求失败，未展示性能指标</div> : <>
          <DetailRow label="首字">{log.firstByteMs != null ? formatDuration(log.firstByteMs) : ""}</DetailRow>
          <DetailRow label="用时">{log.durationMs != null ? formatDuration(log.durationMs) : ""}</DetailRow>
          <DetailRow label="TPS">{tps ?? ""}</DetailRow>
        </>}
      </DetailSection>
      {log.errorBody && <ErrorDetail errorBody={log.errorBody} />}
    </>
  );
}

interface Props {
  log: RequestLog | null;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}

export function RequestDetailSheet({ log, onClose, onCloseAutoFocus }: Props) {
  // 标题栏 h-8；横向导航再加 TopNav h-14。抽屉门户在 body 上，不能靠布局里的 CSS 变量继承。
  const chromeTop = useLayoutStore((s) => (s.navMode === "horizontal" ? "5.5rem" : "2rem"));
  return (
    <Dialog open={log !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay style={{ top: chromeTop }} />
        <DialogPrimitive.Content
          onCloseAutoFocus={onCloseAutoFocus}
          onInteractOutside={(event) => {
            const target = event.target;
            if (target instanceof Element && target.closest("[data-app-chrome]")) event.preventDefault();
          }}
          style={{ top: chromeTop }}
          className="fixed right-0 bottom-0 z-50 flex w-full max-w-[100vw] flex-col border-l border-edge bg-background shadow-xl outline-none duration-200 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-right sm:w-[560px] sm:rounded-bl-xl"
        >
          <DialogHeader className="shrink-0 border-b border-edge px-6 py-5 pr-16 text-left">
            <DialogTitle>请求详情</DialogTitle>
            <DialogDescription className="sr-only">所选代理请求的用量、冻结费用和性能记录。</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="关闭请求详情" className="absolute top-3 right-3"><XIcon className="size-4" /></Button>
          </DialogClose>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-6">
            {log && <RequestDetail log={log} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
