import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { DateRangePicker, StatCard, TokenHint } from "@/components/business";
import { TabularText } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isHourlyTrend, rangeValueUsageFilter, resolveTrendWindow, startOfTodayMs, type RangeValue } from "@/lib/range";
import { usageApi, type DayModelUsage, type UsageAppFilter } from "@/services/modules/usage";

import { UsageHeatmap } from "./UsageHeatmap";
import { UsageTrendChart } from "./UsageTrendChart";
import { mergeByDate, sliceHourlyTrend, sliceTrend } from "./usageChart";

const APP_TABS: { key: UsageAppFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "claude", label: "Claude Code" },
  { key: "codex", label: "Codex" },
  { key: "zcode", label: "ZCode" },
];

const fmt = (n: number) => n.toLocaleString();

function appLabel(app: string): string {
  if (app === "claude") return "Claude Code";
  if (app === "codex") return "Codex";
  if (app === "zcode") return "ZCode";
  return app;
}

/** 用量统计（MVP）：读取本机 Claude Code / Codex 会话日志，按 日期×来源×模型 汇总 token。 */
export function UsagePanel() {
  const qc = useQueryClient();
  const [app, setApp] = useState<UsageAppFilter>("all");
  const appType = app === "all" ? undefined : app;
  const [range, setRange] = useState<RangeValue>({ kind: "preset", key: "today" });
  // 按天对齐锚点，使筛选参数在同一条件下稳定（不把 Date.now() 放进 queryKey）。
  const todayStart = startOfTodayMs();
  const filter = useMemo(
    () => rangeValueUsageFilter(range, todayStart),
    [range, todayStart],
  );

  const sync = useMutation({
    mutationFn: () => usageApi.sync(),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["usage"] });
      if (r.imported > 0) toast.success(`已同步 ${r.imported} 条用量记录`);
    },
    onError: (e) =>
      toast.error(`同步失败：${e instanceof Error ? e.message : String(e)}`),
  });

  // 进入面板自动同步一次
  useEffect(() => {
    sync.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterKey = [
    filter.start ?? null,
    filter.end ?? null,
    filter.startTs ?? null,
    filter.endTs ?? null,
  ];
  const summary = useQuery({
    queryKey: ["usage", "summary", app, ...filterKey],
    queryFn: () => usageApi.getSummary({ appType, ...filter }),
  });
  const byDayModel = useQuery({
    queryKey: ["usage", "day-model", app, ...filterKey],
    queryFn: () => usageApi.getByDayModel({ appType, ...filter }),
  });
  // 全量按天数据：热力图取近一年，趋势图按 range 前端切片（一条查询喂两张图）
  const byDay = useQuery({
    queryKey: ["usage", "by-day", app],
    queryFn: () => usageApi.getByDay({ appType }),
  });
  const dayTotals = useMemo(() => mergeByDate(byDay.data ?? []), [byDay.data]);
  const trendWin = useMemo(
    () => resolveTrendWindow(range, todayStart),
    [range, todayStart],
  );
  const hourly = isHourlyTrend(trendWin);
  const byHour = useQuery({
    queryKey: ["usage", "by-hour", app, trendWin?.startMs, trendWin?.endExclusiveMs],
    queryFn: () =>
      usageApi.getByHour({
        appType,
        startTs: trendWin!.startMs,
        endTs: trendWin!.endExclusiveMs - 1,
      }),
    enabled: hourly && trendWin != null,
  });
  const trendData = useMemo(() => {
    if (hourly && trendWin) {
      return sliceHourlyTrend(
        mergeByDate(byHour.data ?? []),
        trendWin,
        Date.now(),
      );
    }
    return sliceTrend(dayTotals, range, todayStart);
  }, [hourly, trendWin, byHour.data, dayTotals, range, todayStart]);

  const s = summary.data;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <Tabs value={app} onValueChange={(v) => setApp(v as UsageAppFilter)}>
          <TabsList variant="line">
            {APP_TABS.map((t) => (
              <TabsTrigger key={t.key} value={t.key}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} />
          <Button
            variant="outline"
            size="sm"
            disabled={sync.isPending}
            onClick={() => sync.mutate()}
          >
            <RefreshCwIcon className={sync.isPending ? "size-4 animate-spin" : "size-4"} />
            刷新
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <StatCard label="请求数" value={fmt(s?.totalRequests ?? 0)} />
        <StatCard
          label="输入 Token"
          value={fmt(s?.totalInputTokens ?? 0)}
          hintBelow
          hint={<TokenHint value={s?.totalInputTokens ?? 0} />}
        />
        <StatCard
          label="输出 Token"
          value={fmt(s?.totalOutputTokens ?? 0)}
          hintBelow
          hint={<TokenHint value={s?.totalOutputTokens ?? 0} />}
        />
        <StatCard
          label="缓存 Token"
          value={fmt(
            (s?.totalCacheCreationTokens ?? 0) + (s?.totalCacheReadTokens ?? 0),
          )}
          hintBelow
          hint={
            <TokenHint
              value={
                (s?.totalCacheCreationTokens ?? 0) +
                (s?.totalCacheReadTokens ?? 0)
              }
            />
          }
        />
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-ink-secondary">调用热力图</h2>
        <div className="rounded-lg border border-edge p-4">
          <UsageHeatmap totals={dayTotals} />
        </div>
      </section>

      <section className="rounded-lg border border-edge p-4">
        <UsageTrendChart data={trendData} />
      </section>

      <DayModelTable rows={byDayModel.data ?? []} />
    </div>
  );
}

interface DateGroup {
  date: string;
  rows: DayModelUsage[];
}

/** 按日期分组（后端已按 date 倒序 + 组内 token 降序排好，仅需聚合连续同日期行）。 */
export function groupByDate(rows: DayModelUsage[]): DateGroup[] {
  const groups: DateGroup[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.date === r.date) last.rows.push(r);
    else groups.push({ date: r.date, rows: [r] });
  }
  return groups;
}

/** 多维合并表：日期(rowspan 合并) × 来源 × 模型 × 指标。无数据时整块隐藏。 */
function DayModelTable({ rows }: { rows: DayModelUsage[] }) {
  const groups = groupByDate(rows);
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-medium text-ink-secondary">按日期 · 模型</h2>
      <div className="overflow-hidden rounded-lg border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-edge text-xs text-ink-secondary">
                <th className="px-3 py-2 text-left font-medium">日期</th>
                <th className="px-3 py-2 text-left font-medium">来源</th>
                <th className="px-3 py-2 text-left font-medium">模型</th>
                <th className="px-3 py-2 text-right font-medium">请求</th>
                <th className="px-3 py-2 text-right font-medium">输入</th>
                <th className="px-3 py-2 text-right font-medium">输出</th>
                <th className="px-3 py-2 text-right font-medium">缓存</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) =>
                g.rows.map((r, i) => (
                  <tr
                    key={`${g.date}-${r.appType}-${r.model}-${i}`}
                    className={
                      i === 0 && gi > 0
                        ? "border-t border-edge"
                        : "border-t border-edge-subtle"
                    }
                  >
                    {i === 0 && (
                      <td
                        rowSpan={g.rows.length}
                        className="border-r border-edge-subtle px-3 py-2 align-top"
                      >
                        <TabularText>{g.date}</TabularText>
                      </td>
                    )}
                    <td className="px-3 py-2 text-ink-secondary">
                      {appLabel(r.appType)}
                    </td>
                    <td className="px-3 py-2">{r.model || "—"}</td>
                    <td className="px-3 py-2 text-right">
                      <TabularText>{fmt(r.requests)}</TabularText>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TabularText>{fmt(r.inputTokens)}</TabularText>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TabularText>{fmt(r.outputTokens)}</TabularText>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <TabularText>
                        {fmt(r.cacheCreationTokens + r.cacheReadTokens)}
                      </TabularText>
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
      </div>
    </section>
  );
}
