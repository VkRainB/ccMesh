import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InfoIcon } from "lucide-react";

import { StatusDot, TabularText } from "@/components/ui";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Pagination } from "@/components/ui/Pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { statsApi, type RequestLog } from "@/services/modules/stats";

type Mode = "live" | "ranged";
type RangeKey = "today" | "7d" | "30d" | "all";

const RANGES: { key: RangeKey; label: string }[] = [
  { key: "today", label: "今日" },
  { key: "7d", label: "近 7 天" },
  { key: "30d", label: "近 30 天" },
  { key: "all", label: "全部" },
];

const DAY_MS = 86_400_000;

function computeRange(key: RangeKey): { startMs?: number; endMs?: number } {
  const now = Date.now();
  switch (key) {
    case "today": {
      const d = new Date();
      d.setHours(0, 0, 0, 0);
      return { startMs: d.getTime(), endMs: now };
    }
    case "7d":
      return { startMs: now - 7 * DAY_MS, endMs: now };
    case "30d":
      return { startMs: now - 30 * DAY_MS, endMs: now };
    case "all":
      return {};
  }
}

interface Props {
  /** live：事件驱动实时刷新；ranged：时间段 + 分页查询。 */
  mode: Mode;
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
export function RequestMonitor({ mode, endpointFilter, pageSize = 20, title }: Props) {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [rangeKey, setRangeKey] = useState<RangeKey>("today");
  const range = mode === "ranged" ? computeRange(rangeKey) : {};

  const { data, isLoading } = useQuery({
    queryKey: [
      "request-logs",
      mode,
      range.startMs ?? null,
      range.endMs ?? null,
      endpointFilter ?? null,
      page,
      pageSize,
    ],
    queryFn: () =>
      statsApi.getRequestLogs({
        startMs: range.startMs,
        endMs: range.endMs,
        endpoint: endpointFilter,
        page,
        pageSize,
      }),
  });

  // live：新请求事件 → 仅在第 1 页时刷新，避免打断翻页浏览
  useEffect(() => {
    if (mode !== "live") return;
    let un: (() => void) | undefined;
    statsApi
      .onRequestLogged(() => {
        if (page === 1) {
          qc.invalidateQueries({ queryKey: ["request-logs", "live"] });
        }
      })
      .then((u) => {
        un = u;
      });
    return () => un?.();
  }, [mode, page, qc]);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-ink-secondary">
          {title ?? (mode === "live" ? "实时请求监控" : "端点请求记录")}
        </h2>
        {mode === "ranged" && (
          <Select
            value={rangeKey}
            onValueChange={(v) => {
              setRangeKey(v as RangeKey);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGES.map((r) => (
                <SelectItem key={r.key} value={r.key}>
                  {r.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

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
            <th className="px-3 py-2 text-center font-medium">状态</th>
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

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function statusDot(code: number | null): "success" | "warning" | "danger" {
  if (code == null) return "danger";
  if (code < 300) return "success";
  if (code < 400) return "warning";
  return "danger";
}

function RequestRow({ log }: { log: RequestLog }) {
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
        <TabularText>{fmtTime(log.ts)}</TabularText>
      </td>
      <td className="px-3 py-2">{log.endpointName}</td>
      <td className="px-3 py-2 text-xs text-ink-secondary uppercase">
        {log.inboundFormat}
      </td>
      <td
        className="max-w-[180px] truncate px-3 py-2 text-xs text-ink-secondary"
        title={log.upstreamUrl}
      >
        {log.upstreamUrl || "—"}
      </td>
      <td className="px-3 py-2 text-center">
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status={statusDot(log.statusCode)} />
          <TabularText className="text-xs">{log.statusCode ?? "ERR"}</TabularText>
        </span>
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

function TokenDetail({ log, total }: { log: RequestLog; total: number }) {
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
      {rows.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4">
          <span className="text-ink-secondary">{k}</span>
          <TabularText>{v}</TabularText>
        </div>
      ))}
      <div className="mt-1 flex items-center justify-between gap-4 border-t border-edge-subtle pt-1.5 font-medium">
        <span>合计</span>
        <TabularText>{total}</TabularText>
      </div>
      {log.durationMs != null && (
        <div className="flex items-center justify-between gap-4 text-ink-secondary">
          <span>耗时</span>
          <TabularText>{log.durationMs}ms</TabularText>
        </div>
      )}
    </div>
  );
}
