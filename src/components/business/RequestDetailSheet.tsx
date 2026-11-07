import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogDescription, DialogHeader,
  DialogOverlay, DialogPortal, DialogTitle,
} from "@/components/ui/dialog";
import { fmtDateTime, formatDuration, formatOutputTps } from "@/lib/format";
import type { RequestLog } from "@/services/modules/stats";

export const COST_LABELS = {
  priced: "已计价",
  unpriced: "未配置价格",
  incomplete_usage: "用量不完整，未计价",
  calculation_error: "成本计算失败",
  legacy_unknown: "历史记录无费率快照",
} as const;

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] items-baseline gap-4 text-sm">
      <dt className="text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-all text-right font-mono text-xs leading-5 tabular-nums">{children}</dd>
    </dl>
  );
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="flex flex-col gap-3 rounded-lg border border-edge p-4">{children}</div>
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
  const parts = [["input", "输入"], ["output", "输出"], ["cacheRead", "缓存读取"], ["cacheWrite", "缓存创建"]] as const;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">成本明细（USD）</h3>
        <span className="text-xs text-ink-secondary">{COST_LABELS[log.costStatus ?? "legacy_unknown"]}</span>
      </div>
      {log.costStatus !== "priced" && log.costReason && <p className="break-words text-xs text-ink-secondary">{log.costReason}</p>}
      <div className="overflow-hidden rounded-lg border border-edge">
        <div className="flex flex-col gap-3 p-4">
          <DetailRow label="计价模型">{log.pricingModel ?? snapshot?.modelId ?? "未记录"}</DetailRow>
          <DetailRow label="规则">{snapshot ? snapshot.source === "auto" ? "models.dev 自动价" : snapshot.source === "base" ? "默认价" : snapshot.ruleName || snapshot.ruleId : "未记录"}</DetailRow>
          <DetailRow label="时区">{snapshot?.source === "auto" ? "—" : snapshot?.timezone ?? "未记录"}</DetailRow>
          <DetailRow label="计价时刻（UTC）">{log.pricingAt != null ? new Date(log.pricingAt).toISOString() : "未记录"}</DetailRow>
        </div>
        <table className="w-full table-fixed border-t border-edge text-xs">
          <thead className="text-ink-mute">
            <tr>
              <th className="w-1/4 px-4 py-3 text-left font-normal">分项</th>
              <th className="px-2 py-3 text-right font-normal">USD / 百万 token</th>
              <th className="px-4 py-3 text-right font-normal">成本 USD</th>
            </tr>
          </thead>
          <tbody>
            {parts.map(([key, label]) => (
              <tr key={key}>
                <td className="px-4 py-2 text-ink-secondary">{label}</td>
                <td className="break-all px-2 py-2 text-right font-mono tabular-nums">{snapshot?.rates[key] ?? "—"}</td>
                <td className="break-all px-4 py-2 text-right font-mono tabular-nums">{log.costStatus === "priced" ? log.cost?.[key] ?? "—" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-edge p-4 text-sm">
          <span className="shrink-0 text-ink-secondary">合计</span>
          <span className="break-all text-right font-mono font-semibold tabular-nums">{log.costStatus === "priced" && log.cost ? `$${log.cost.total}` : "—"}</span>
        </div>
      </div>
    </section>
  );
}

function RequestDetail({ log }: { log: RequestLog }) {
  const total = log.inputTokens + log.outputTokens + log.cacheReadTokens + log.cacheCreationTokens;
  const tps = log.isError ? null : formatOutputTps(log.outputTokens, log.durationMs, log.firstByteMs, log.outputEstimated);
  const estimated = log.outputEstimated ? "≈" : "";
  return (
    <>
      <DetailSection title="基本信息">
        <DetailRow label="完成时间">{fmtDateTime(log.ts)}</DetailRow>
        <DetailRow label="记录 ID">{log.id > 0 ? log.id : "未落库"}</DetailRow>
        <DetailRow label="端点">{log.endpointName}</DetailRow>
        <DetailRow label="端点 ID">{log.endpointId ?? "未记录"}</DetailRow>
        <DetailRow label="状态">{log.statusCode ?? "ERR"}{log.isError ? " · 请求失败" : ""}</DetailRow>
        <DetailRow label="请求模型">{log.model?.trim() || "未记录"}</DetailRow>
        <DetailRow label="实际模型">{log.actualModel?.trim() || log.model?.trim() || "未记录"}</DetailRow>
        <DetailRow label="入站协议">{log.inboundFormat || "未记录"}</DetailRow>
        <DetailRow label="入站路径">{log.inboundPath || "未记录"}</DetailRow>
        <DetailRow label="出站路径">{log.upstreamPath || "未记录"}</DetailRow>
        <DetailRow label="上游地址">{log.upstreamUrl || "未记录"}</DetailRow>
      </DetailSection>
      <DetailSection title="Token 用量">
        <DetailRow label="输入">{log.inputTokens.toLocaleString()}</DetailRow>
        <DetailRow label="输出">{estimated}{log.outputTokens.toLocaleString()}</DetailRow>
        <DetailRow label="缓存读取">{log.cacheReadTokens.toLocaleString()}</DetailRow>
        <DetailRow label="缓存创建">{log.cacheCreationTokens.toLocaleString()}</DetailRow>
        <div className="border-t border-edge pt-3"><DetailRow label="合计">{estimated}{total.toLocaleString()}</DetailRow></div>
      </DetailSection>
      <CostDetail log={log} />
      <DetailSection title="性能">
        {log.isError ? <div className="text-xs text-ink-mute">请求失败，未展示性能指标</div> : <>
          <DetailRow label="首字">{log.firstByteMs != null ? formatDuration(log.firstByteMs) : "未记录"}</DetailRow>
          <DetailRow label="用时">{log.durationMs != null ? formatDuration(log.durationMs) : "未记录"}</DetailRow>
          <DetailRow label="TPS">{tps ?? "未记录"}</DetailRow>
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
  return (
    <Dialog open={log !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          onCloseAutoFocus={onCloseAutoFocus}
          className="fixed inset-y-0 right-0 z-50 flex h-dvh w-full max-w-[100vw] flex-col border-l border-edge bg-background shadow-xl outline-none duration-200 motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-right sm:w-[560px] sm:rounded-l-xl"
        >
          <DialogHeader className="shrink-0 border-b border-edge px-6 py-5 pr-16 text-left">
            <DialogTitle>请求详情</DialogTitle>
            <DialogDescription className="sr-only">所选代理请求的用量、冻结费用和性能记录。</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button variant="ghost" size="icon" aria-label="关闭请求详情" className="absolute top-3 right-3"><XIcon className="size-4" /></Button>
          </DialogClose>
          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain p-6">
            {log && <RequestDetail log={log} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}
