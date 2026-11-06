import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { InfoIcon, ArrowDownRightIcon, TriangleAlertIcon, Trash2Icon, Settings2Icon } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useRequestLogs } from "@/hooks/useRequestLogs";
import { useCache } from "@/hooks/useCache";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { DateRangePicker } from "@/components/business/DateRangePicker";
import { RequestLogsCleanupDialog } from "@/components/business/RequestLogsCleanupDialog";
import { COST_LABELS, ErrorDetail, RequestDetailSheet } from "@/components/business/RequestDetailSheet";
import { rangeValueMs, startOfTodayMs, ymd, type RangeValue } from "@/lib/range";
import { fmtDateTime, fmtTime, formatDuration, formatOutputTps, formatTokenK } from "@/lib/format";
import { statsApi, type RequestLog } from "@/services/modules/stats";

const COLUMNS = [
  ["time", "时间"], ["endpoint", "端点"], ["routes", "入站 / 出站"],
  ["status", "状态"], ["model", "模型"], ["latency", "延迟"], ["tokens", "Token"],
] as const;
type Column = typeof COLUMNS[number][0];
interface TablePreferences { hiddenColumns: Column[]; actualModelOnly: boolean }
const DEFAULT_PREFERENCES: TablePreferences = { hiddenColumns: [], actualModelOnly: false };
const CACHE_KEY = "ccmesh:request-table-preferences:v1";

function parsePreferences(value: unknown): TablePreferences {
  if (typeof value !== "object" || value === null) return DEFAULT_PREFERENCES;
  const saved = value as Record<string, unknown>;
  if (!Array.isArray(saved.hiddenColumns) || typeof saved.actualModelOnly !== "boolean") return DEFAULT_PREFERENCES;
  const hiddenColumns = COLUMNS.map(([id]) => id).filter((id) => saved.hiddenColumns instanceof Array && saved.hiddenColumns.includes(id));
  if (hiddenColumns.length === COLUMNS.length) return DEFAULT_PREFERENCES;
  return { hiddenColumns, actualModelOnly: saved.actualModelOnly };
}

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
  const [preferences, setPreferences] = useCache(CACHE_KEY, { defaultValue: DEFAULT_PREFERENCES, parse: parsePreferences });
  const [selectedLog, setSelectedLog] = useState<RequestLog | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const openDetail = (log: RequestLog, trigger: HTMLElement) => {
    detailTrigger.current = trigger;
    setSelectedLog(log);
  };
  const [ownRange, setOwnRange] = useState<RangeValue>({
    kind: "preset",
    key: "today",
  });
  const rangeValue = controlledRange ?? ownRange;
  const [cleanupOpen, setCleanupOpen] = useState(false);
  // 按天对齐的稳定锚点：同一天内多次渲染得到相同区间，避免 queryKey 逐帧漂移导致无限重取。
  const [todayStart, setTodayStart] = useState(startOfTodayMs);
  useEffect(() => {
    let timer: number;
    const refreshDay = () => {
      window.clearTimeout(timer);
      const now = new Date();
      setTodayStart(startOfTodayMs(now.getTime()));
      const tomorrow = new Date(now);
      tomorrow.setHours(24, 0, 0, 0);
      timer = window.setTimeout(refreshDay, Math.max(1, tomorrow.getTime() - now.getTime()));
    };
    const onVisible = () => { if (!document.hidden) refreshDay(); };
    refreshDay();
    window.addEventListener("focus", refreshDay);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refreshDay);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  const range = useMemo(
    () => (mode === "ranged" ? rangeValueMs(rangeValue, todayStart) : {}),
    [mode, rangeValue, todayStart],
  );
  // 范围变化（含外部受控变化）时回到第 1 页
  useEffect(() => setPage(1), [rangeValue]);
  useEffect(() => setSelectedLog(null), [mode, page, range.startMs, range.endMs, endpointFilter]);

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

  if (hideWhenEmpty && !isLoading && total === 0 && !selectedLog) return null;

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-sm font-medium text-ink-secondary">
          {title ?? (mode === "live" ? "实时请求监控" : "端点请求记录")}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {mode === "ranged" && !controlledRange && (
            <DateRangePicker value={rangeValue} onChange={setOwnRange} />
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button ref={settingsButton} size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="配置请求表格">
                <Settings2Icon className="size-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" aria-label="请求表格配置">
              <div className="flex flex-col gap-3">
                <p className="text-sm font-medium">显示字段</p>
                <div className="grid grid-cols-2 gap-2">
                  {COLUMNS.map(([id, label]) => {
                    const visible = !preferences.hiddenColumns.includes(id);
                    return <label key={id} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={visible} aria-label={label}
                        disabled={visible && preferences.hiddenColumns.length === COLUMNS.length - 1}
                        onCheckedChange={(checked) => {
                          setPreferences((previous) => ({ ...previous, hiddenColumns: checked === true
                            ? previous.hiddenColumns.filter((column) => column !== id)
                            : [...previous.hiddenColumns, id] }));
                        }} />
                      {label}
                    </label>;
                  })}
                </div>
                <label className="flex items-center justify-between gap-3 text-sm">
                  仅显示实际模型
                  <Switch aria-label="仅显示实际模型" checked={preferences.actualModelOnly}
                    onCheckedChange={(actualModelOnly) => setPreferences((previous) => ({ ...previous, actualModelOnly }))} />
                </label>
                <Button variant="outline" size="sm" onClick={() => setPreferences(DEFAULT_PREFERENCES)}>恢复默认</Button>
              </div>
            </PopoverContent>
          </Popover>
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
        onCleaned={() => { setSelectedLog(null); setPage(1); }}
      />
      <RequestDetailSheet
        log={selectedLog}
        onClose={() => setSelectedLog(null)}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const target = detailTrigger.current;
          (target?.isConnected ? target : settingsButton.current)?.focus({ preventScroll: true });
        }}
      />

      {isLoading ? (
        <p className="text-sm text-ink-mute">加载中…</p>
      ) : (
        <RequestLogTable items={items} preferences={preferences} todayStart={todayStart} onOpenDetail={openDetail} />
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
export function RequestLogTable({ items, preferences = DEFAULT_PREFERENCES, todayStart = startOfTodayMs(), onOpenDetail }: {
  items: RequestLog[];
  preferences?: TablePreferences;
  todayStart?: number;
  onOpenDetail?: (log: RequestLog, trigger: HTMLElement) => void;
}) {
  if (items.length === 0) {
    return <p className="text-sm text-ink-mute">暂无请求记录</p>;
  }
  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border border-edge">
      <table className="w-full text-sm">
        {!preferences.hiddenColumns.includes("tokens") && <caption className="caption-bottom border-t border-edge px-3 py-2 text-left text-xs text-ink-mute">本地估算，非渠道扣款账单。仅完整用量与已配置价格的请求计价。</caption>}
        <thead>
          <tr className="border-b border-edge text-xs text-ink-secondary">
            {COLUMNS.filter(([id]) => !preferences.hiddenColumns.includes(id)).map(([id, label]) => (
              <th key={id} className={`px-3 py-2 text-left font-medium whitespace-nowrap ${id === "model" ? "w-[12rem] max-w-[12rem]" : id === "status" ? "w-[4.5rem]" : ""}`}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((r) => (
            <RequestRow key={r.id || r.ts} log={r} preferences={preferences} todayStart={todayStart} onOpenDetail={onOpenDetail} />
          ))}
        </tbody>
      </table>
    </div>
  );
}


function statusDot(code: number | null): "success" | "warning" | "danger" {
  if (code == null) return "danger";
  if (code < 300) return "success";
  if (code < 400) return "warning";
  return "danger";
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

/** 延迟：首字、用时、输出速度垂直三行。没有值时留空。标签和数值都从左对齐。 */
export function LatencyCell({ log }: { log: RequestLog }) {
  const tps = log.isError
    ? null
    : formatOutputTps(log.outputTokens, log.durationMs, log.firstByteMs, log.outputEstimated);
  const rows: [string, string][] = [
    ["首字", !log.isError && log.firstByteMs != null ? formatDuration(log.firstByteMs) : ""],
    ["用时", !log.isError && log.durationMs != null ? formatDuration(log.durationMs) : ""],
    ["TPS", tps ?? ""],
  ];
  return (
    <div className="inline-grid grid-cols-[max-content_max-content] items-baseline justify-items-start gap-x-3 gap-y-0.5 text-left text-xs leading-4">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <span className="text-left text-ink-mute">{label}</span>
          <span
            className="justify-self-start text-left font-mono tabular-nums tracking-tight text-foreground"
            title={
              label === "TPS" && value.startsWith("≈")
                ? "分母为总用时（生成窗口过短或无首字），或输出 token 按字符估算"
                : undefined
            }
          >
            {value}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function RequestRow({ log, preferences, todayStart, onOpenDetail }: {
  log: RequestLog;
  preferences: TablePreferences;
  todayStart: number;
  onOpenDetail?: (log: RequestLog, trigger: HTMLElement) => void;
}) {
  // 优先 transformer（端点配置类型，更准确），旧行/未记录回退 inboundFormat
  const FormatIcon = getEndpointIcon(log.transformer ?? log.inboundFormat);
  const total =
    log.inputTokens +
    log.outputTokens +
    log.cacheCreationTokens +
    log.cacheReadTokens;
  return (
    <tr
      className={`border-b border-edge-subtle last:border-0 ${onOpenDetail ? "cursor-pointer transition-colors hover:bg-surface-hover focus-within:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" : ""}`}
      tabIndex={onOpenDetail ? 0 : undefined}
      aria-label={onOpenDetail ? `查看请求详情：${fmtDateTime(log.ts)} ${log.endpointName}` : undefined}
      onKeyDown={onOpenDetail ? (event) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onOpenDetail(log, event.currentTarget);
      } : undefined}
      onClick={onOpenDetail ? (event) => {
        if ((event.target as HTMLElement).closest("button, a, input, select, textarea, [role=button]") || window.getSelection()?.toString()) return;
        onOpenDetail(log, event.currentTarget);
      } : undefined}
    >
      {!preferences.hiddenColumns.includes("time") && (
      <td
        className="w-px px-3 py-2 whitespace-nowrap"
        title={fmtDateTime(log.ts)}
      >
        <time dateTime={new Date(log.ts).toISOString()} className="flex flex-col gap-0.5 font-mono text-xs tabular-nums">
          {startOfTodayMs(log.ts) !== todayStart && <span className="text-ink-mute">{ymd(log.ts)}</span>}
          <span>{fmtTime(log.ts)}</span>
        </time>
      </td>
      )}
      {!preferences.hiddenColumns.includes("endpoint") && (
      <td className="max-w-[10rem] px-3 py-2">
        <div className="flex items-center gap-1.5">
          <FormatIcon size={14} className="shrink-0" />
          <span className="truncate" title={log.endpointName}>{log.endpointName}</span>
        </div>
      </td>
      )}
      {!preferences.hiddenColumns.includes("routes") && (
      <td className="max-w-[16rem] px-3 py-2 font-mono text-xs text-ink-secondary">
        <div className="flex min-w-0 max-w-[14.5rem] flex-col gap-0.5">
          <span className="truncate" title={`入站协议：${log.inboundFormat} · ${log.inboundPath || inferPath(log.inboundFormat)}`}>
            {log.inboundPath || inferPath(log.inboundFormat)}
          </span>
          <span className="truncate" title={log.upstreamUrl ? `${log.upstreamUrl}${log.upstreamPath}` : undefined}>
            {log.upstreamPath || inferPath(log.inboundFormat)}
          </span>
        </div>
      </td>
      )}
      {!preferences.hiddenColumns.includes("status") && (
      <td className="w-[4.5rem] px-3 py-2">
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
      )}
      {!preferences.hiddenColumns.includes("model") && (
      <td className="w-[12rem] max-w-[12rem] px-3 py-2 align-middle">
        <ModelCell model={log.model} actualModel={log.actualModel} actualModelOnly={preferences.actualModelOnly} />
      </td>
      )}
      {!preferences.hiddenColumns.includes("latency") && (
      <td className="w-px px-3 py-2 text-left whitespace-nowrap">
        <LatencyCell log={log} />
      </td>
      )}
      {!preferences.hiddenColumns.includes("tokens") && (
      <td className="w-px px-3 py-2 text-left whitespace-nowrap">
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
        {onOpenDetail ? <button type="button" aria-label="查看估算成本明细" onClick={(event) => onOpenDetail(log, event.currentTarget)}
          className="mt-0.5 block max-w-[10rem] truncate rounded-sm text-xs text-ink-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={log.costStatus === "priced" && log.cost ? `$${log.cost.total}` : COST_LABELS[log.costStatus ?? "legacy_unknown"]}>
          {log.costStatus === "priced" && log.cost ? <span className="font-mono tabular-nums">${log.cost.total}</span> : COST_LABELS[log.costStatus ?? "legacy_unknown"]}
        </button> : <span className="mt-0.5 block font-mono text-xs tabular-nums">{log.costStatus === "priced" && log.cost ? `$${log.cost.total}` : COST_LABELS[log.costStatus ?? "legacy_unknown"]}</span>}
      </td>
      )}
    </tr>
  );
}


/** 模型列：按共享偏好展示映射链或唯一实际模型；缺实际名回退请求名。 */
export function ModelCell({
  model,
  actualModel,
  actualModelOnly = false,
}: {
  model: string | null;
  actualModel: string | null;
  actualModelOnly?: boolean;
}) {
  // 后端入站缺失时可能是 ""，与 null 一并视为无入站。
  const inbound = model?.trim() ? model : null;
  const actual = actualModel?.trim() ? actualModel : null;
  if (!inbound && !actual) return null;
  const name = actualModelOnly ? actual ?? inbound : inbound ?? actual;
  return (
    <div className="flex w-40 min-w-0 max-w-full flex-col gap-0.5 text-xs text-ink-secondary">
      <span className="block truncate" title={name ?? undefined}>{name}</span>
      {!actualModelOnly && inbound && actual && (
        <span className="flex min-w-0 items-center gap-1">
          <ArrowDownRightIcon className="size-3 shrink-0 text-ink-mute" aria-hidden />
          <span className="min-w-0 flex-1 truncate" title={actual}>{actual}</span>
        </span>
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
  const tps = log.isError
    ? null
    : formatOutputTps(log.outputTokens, log.durationMs, log.firstByteMs, log.outputEstimated);
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
          <span title={k === "输出" && log.outputEstimated ? "按输出字符估算" : v.toLocaleString()}>
            <TabularText>
              {k === "输出" && log.outputEstimated && v > 0 ? `≈${formatTokenK(v)}` : formatTokenK(v)}
            </TabularText>
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
      {tps && (
        <div className="flex items-center justify-between gap-4 text-ink-secondary">
          <span>TPS</span>
          <TabularText>{tps}</TabularText>
        </div>
      )}
    </div>
  );
}
