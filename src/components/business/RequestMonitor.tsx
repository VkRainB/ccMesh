import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon, ArrowDownRightIcon, TriangleAlertIcon, Trash2Icon } from "lucide-react";
import { Anthropic, Codex, OpenAI } from "@lobehub/icons";
import type { ComponentType } from "react";

import { StatusDot, TabularText } from "@/components/ui";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Pagination } from "@/components/ui/Pagination";
import { Button } from "@/components/ui/button";
import { useRequestLogs } from "@/hooks/useRequestLogs";
import { DateRangePicker } from "@/components/business/DateRangePicker";
import { RequestLogsCleanupDialog } from "@/components/business/RequestLogsCleanupDialog";
import { rangeValueMs, startOfTodayMs, type RangeValue } from "@/lib/range";
import { formatDuration, formatTokenK } from "@/lib/format";
import { statsApi, type RequestLog } from "@/services/modules/stats";

type Mode = "live" | "ranged";

interface Props {
  /** live：事件驱动实时刷新；ranged：时间段 + 分页查询。 */
  mode: Mode;
  /** 受控时间范围：传入后隐藏内置日期选择器，跟随外部（如面板顶部统一筛选）。 */
  range?: RangeValue;
  /** 当前范围无记录时整块隐藏（含标题/清理入口）。 */
  hideWhenEmpty?: boolean;
  /** 可选端点过滤。 */
  endpointFilter?: string;
  pageSize?: number;
  /** 标题（默认按模式取）。 */
  title?: string;
}

/**
 * 端点请求实时监控（统计页 ranged / 仪表盘 live 复用）。
 * 数据统一走 `get_request_logs` 分页查询；live 模式在第 1 页时由 `request-logged` 事件触发刷新。
 */
export function RequestMonitor({
  mode,
  range: controlledRange,
  hideWhenEmpty = false,
  endpointFilter,
  pageSize = 20,
  title,
}: Props) {
  const [page, setPage] = useState(1);
  const [ownRange, setOwnRange] = useState<RangeValue>({
    kind: "preset",
    key: "today",
  });
  const rangeValue = controlledRange ?? ownRange;
  const [cleanupOpen, setCleanupOpen] = useState(false);
  // 按天对齐的稳定锚点：同一天内多次渲染得到相同区间，避免 queryKey 逐帧漂移导致无限重取。
  const todayStart = startOfTodayMs();
  const range = useMemo(
    () => (mode === "ranged" ? rangeValueMs(rangeValue, todayStart) : {}),
    [mode, rangeValue, todayStart],
  );
  // 范围变化（含外部受控变化）时回到第 1 页
  useEffect(() => setPage(1), [rangeValue]);

  const { data, isLoading } = useRequestLogs({
    mode,
    startMs: range.startMs,
    endMs: range.endMs,
    endpointFilter,
    page,
    pageSize,
  });
  const { data: retentionDays } = useQuery({
    queryKey: ["request-log-retention-days"],
    queryFn: statsApi.getRetentionDays,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  if (hideWhenEmpty && !isLoading && total === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-ink-secondary">
          {title ?? (mode === "live" ? "实时请求监控" : "端点请求记录")}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {mode === "ranged" && !controlledRange && (
            <DateRangePicker value={rangeValue} onChange={setOwnRange} />
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setCleanupOpen(true)}
            className="h-8 w-8 p-0 hover:text-destructive"
            aria-label="清理请求明细"
          >
            <Trash2Icon className="size-4" />
          </Button>
        </div>
      </div>

      <RequestLogsCleanupDialog
        open={cleanupOpen}
        onOpenChange={setCleanupOpen}
        retentionDays={retentionDays}
        onCleaned={() => setPage(1)}
      />

      {isLoading ? (
        <p className="text-sm text-ink-mute">加载中…</p>
      ) : (
        <RequestLogTable items={items} />
      )}

      {total > pageSize && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={setPage}
        />
      )}
    </section>
  );
}

/** 纯展示：请求明细表（空态自处理），便于复用与单测。 */
export function RequestLogTable({ items }: { items: RequestLog[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-mute">暂无请求记录</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-edge">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-edge text-xs text-ink-secondary">
            <th className="px-3 py-2 text-left font-medium">时间</th>
            <th className="px-3 py-2 text-left font-medium">端点</th>
            <th className="px-3 py-2 text-left font-medium">入站</th>
            <th className="px-3 py-2 text-left font-medium">出站</th>
            <th className="w-[5.5rem] px-3 py-2 text-left font-medium">状态</th>
            <th className="w-[8rem] max-w-[8rem] px-3 py-2 text-left font-medium">模型</th>
            <th className="px-3 py-2 text-right font-medium">用时</th>
            <th className="px-3 py-2 text-right font-medium">首字</th>
            <th className="px-3 py-2 text-right font-medium">Token</th>
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <RequestRow key={r.id || r.ts} log={r} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 请求时间按 24 小时制 时:分:秒（零填充）展示，避免地区设置带来的上午/下午前缀。 */
export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 请求日期 年-月-日（零填充，本地时区）。 */
export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 请求时间完整展示：年-月-日 时:分:秒（24 小时制）。 */
export function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)} ${fmtTime(ts)}`;
}

function statusDot(code: number | null): "success" | "warning" | "danger" {
  if (code == null) return "danger";
  if (code < 300) return "success";
  if (code < 400) return "warning";
  return "danger";
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
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">错误详情</div>
      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-ink-secondary">
        {formatErrorBody(errorBody)}
      </pre>
    </div>
  );
}

/** 旧行无真实路径时，按入站协议推断兜底路由。 */
function inferPath(format: string): string {
  if (format === "openai") return "/v1/chat/completions";
  if (format === "responses") return "/v1/responses";
  if (format === "claude") return "/v1/messages";
  if (format === "images") return "/v1/images/generations";
  return "—";
}

/** 端点类型（transformer 优先，回退 inboundFormat）→ 品牌图标。
 *  transformer 值：claude / openai / openai_chat / openai2 / codex / openai_responses / openai-responses / ...
 *  inboundFormat 值：claude / openai / responses / images（旧行回退）。
 *  与端点卡片视觉一致：claude→Anthropic、openai 系→OpenAI、codex/responses 系→Codex。 */
const ENDPOINT_ICON: Record<string, ComponentType<{ size?: number; className?: string }>> = {
  claude: Anthropic,
  openai: OpenAI,
  "openai_chat": OpenAI,
  "openai-chat": OpenAI,
  openai2: OpenAI,
  codex: Codex.Color,
  responses: Codex.Color,
  "openai_responses": Codex.Color,
  "openai-responses": Codex.Color,
  images: OpenAI,
};
const getEndpointIcon = (
  type: string | null | undefined,
): ComponentType<{ size?: number; className?: string }> => {
  if (type) {
    const icon = ENDPOINT_ICON[type.toLowerCase()];
    if (icon) return icon;
  }
  return OpenAI;
};

function RequestRow({ log }: { log: RequestLog }) {
  // 优先 transformer（端点配置类型，更准确），旧行/未记录回退 inboundFormat
  const FormatIcon = getEndpointIcon(log.transformer ?? log.inboundFormat);
  const total =
    log.inputTokens +
    log.outputTokens +
    log.cacheCreationTokens +
    log.cacheReadTokens;
  return (
    <tr className="border-b border-edge-subtle last:border-0">
      <td
        className="px-3 py-2 whitespace-nowrap"
        title={new Date(log.ts).toLocaleString()}
      >
        <TabularText>{fmtDateTime(log.ts)}</TabularText>
      </td>
      <td className="px-3 py-2">
        <div className="flex items-center gap-1.5">
          <FormatIcon size={14} className="shrink-0" />
          <span className="truncate">{log.endpointName}</span>
        </div>
      </td>
      <td
        className="px-3 py-2 font-mono text-xs text-ink-secondary"
        title={`入站协议：${log.inboundFormat}`}
      >
        {log.inboundPath || inferPath(log.inboundFormat)}
      </td>
      <td
        className="max-w-[200px] truncate px-3 py-2 font-mono text-xs text-ink-secondary"
        title={
          log.upstreamUrl
            ? `${log.upstreamUrl}${log.upstreamPath}`
            : undefined
        }
      >
        {log.upstreamPath || inferPath(log.inboundFormat)}
      </td>
      <td className="w-[5.5rem] px-3 py-2">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5">
            <StatusDot status={statusDot(log.statusCode)} />
            <TabularText className="w-8 text-left text-xs text-ink-secondary">
              {log.statusCode ?? "ERR"}
            </TabularText>
          </span>
          {log.isError && log.errorBody ? (
            <HoverCard openDelay={100} closeDelay={50}>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  aria-label="查看错误详情"
                  title="查看错误详情"
                  className="inline-flex shrink-0 items-center text-warning/60 transition-colors hover:text-warning"
                >
                  <TriangleAlertIcon className="size-3" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent align="center" className="max-h-72 w-96 overflow-auto">
                <ErrorDetail errorBody={log.errorBody} />
              </HoverCardContent>
            </HoverCard>
          ) : (
            <span className="inline-block size-3 shrink-0" aria-hidden="true" />
          )}
        </div>
      </td>
      <td className="w-[8rem] max-w-[8rem] px-3 py-2 align-middle">
        <ModelCell model={log.model} actualModel={log.actualModel} />
      </td>
      <td className="px-3 py-2 text-right text-xs text-ink-secondary">
        <TabularText>
          {!log.isError && log.durationMs != null ? formatDuration(log.durationMs) : "—"}
        </TabularText>
      </td>
      <td className="px-3 py-2 text-right text-xs text-ink-secondary">
        <TabularText>
          {!log.isError && log.firstByteMs != null ? formatDuration(log.firstByteMs) : "—"}
        </TabularText>
      </td>
      <td className="px-3 py-2 text-right">
        <HoverCard openDelay={100} closeDelay={50}>
          <HoverCardTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-ink-secondary transition-colors hover:text-foreground"
            >
              <TabularText>{total}</TabularText>
              <InfoIcon className="size-3.5" />
            </button>
          </HoverCardTrigger>
          <HoverCardContent align="end" className="w-56">
            <TokenDetail log={log} total={total} />
          </HoverCardContent>
        </HoverCard>
      </td>
    </tr>
  );
}

/** 模型列：透传单行；映射时上入站 / 中转化图标 / 下实际模型（同色）。无模型留白。 */
export function ModelCell({
  model,
  actualModel,
}: {
  model: string | null;
  actualModel: string | null;
}) {
  // 后端入站缺失时可能是 ""，与 null 一并视为无入站。
  const inbound = model?.trim() ? model : null;
  const actual = actualModel?.trim() ? actualModel : null;
  if (!inbound && !actual) return null;
  // 仅有实际模型（入站空、出站改写）：仍展示唯一可用名。
  if (!inbound) {
    return (
      <span className="block w-full min-w-0  text-xs text-ink-secondary" title={actual ?? undefined}>
        {actual}
      </span>
    );
  }
  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5">
      <span className="block w-full min-w-0  text-xs text-ink-secondary" title={inbound}>
        {inbound}
      </span>
      {actual && (
        <>
          <ArrowDownRightIcon className="size-3 shrink-0 text-ink-mute" aria-hidden />
          <span className="block w-full min-w-0  text-xs text-ink-secondary" title={actual}>
            {actual}
          </span>
        </>
      )}
    </div>
  );
}

export function TokenDetail({ log, total }: { log: RequestLog; total: number }) {
  const rows: [string, number][] = [
    ["输入", log.inputTokens],
    ["输出", log.outputTokens],
    ["缓存创建", log.cacheCreationTokens],
    ["缓存读取", log.cacheReadTokens],
  ];
  return (
    <div className="flex flex-col gap-1.5 text-xs">
      {log.model && (
        <div className="truncate text-ink-secondary" title={log.model}>
          模型：{log.model}
        </div>
      )}
      {log.actualModel && (
        <div title={log.actualModel} className="text-ink-secondary">
          实际模型：<span className=" truncate text-info">{log.actualModel}</span>
        </div>
      )}
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <span className="text-ink-secondary">{k}</span>
          <span title={v.toLocaleString()}>
            <TabularText>{formatTokenK(v)}</TabularText>
          </span>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-edge-subtle pt-1.5 font-medium">
        <span>合计</span>
        <span title={total.toLocaleString()}>
          <TabularText>{formatTokenK(total)}</TabularText>
        </span>
      </div>
      {!log.isError && log.firstByteMs != null && (
        <div className="flex items-center justify-between gap-4 text-ink-secondary">
          <span>首字</span>
          <TabularText>{formatDuration(log.firstByteMs)}</TabularText>
        </div>
      )}
      {!log.isError && log.durationMs != null && (
        <div className="flex items-center justify-between gap-4 text-ink-secondary">
          <span>耗时</span>
          <TabularText>{formatDuration(log.durationMs)}</TabularText>
        </div>
      )}
    </div>
  );
}
