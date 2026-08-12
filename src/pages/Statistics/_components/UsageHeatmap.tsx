import { useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { TabularText } from "@/components/ui";
import { startOfTodayMs } from "@/lib/range";
import {
  buildHeatmapCells,
  heatLevel,
  type DayTotals,
  type HeatmapCell,
} from "./usageChart";

const GAP = "3px";
/** 星期标签列宽（第一列），其余列 1fr 均分容器宽度、格子 aspect-square 保持正方形。 */
const LABEL_COL = "1.25rem";
const WEEKDAY_LABELS: Record<number, string> = { 0: "一", 2: "三", 4: "五", 6: "日" };

const fmt = (n: number) => n.toLocaleString();

interface TooltipState {
  cell: HeatmapCell;
  x: number;
  y: number;
}

/** 按天调用热力图（GitHub 贡献图风格，近一年）。 */
export function UsageHeatmap({ totals }: { totals: Map<string, DayTotals> }) {
  const todayStart = startOfTodayMs();
  const cells = useMemo(() => buildHeatmapCells(todayStart), [todayStart]);
  const max = useMemo(() => {
    let m = 0;
    for (const c of cells) m = Math.max(m, totals.get(c.date)?.requests ?? 0);
    return m;
  }, [cells, totals]);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  const weekCount = Math.ceil(cells.length / 7);
  // 每列（周）首格所在月份变化时打月份刻度
  const monthLabels = useMemo(() => {
    const labels: { col: number; text: string }[] = [];
    let prevMonth = -1;
    for (let w = 0; w < weekCount; w++) {
      const first = cells[w * 7];
      const month = new Date(first.ms).getMonth();
      if (month !== prevMonth) {
        labels.push({ col: w, text: `${month + 1}月` });
        prevMonth = month;
      }
    }
    return labels;
  }, [cells, weekCount]);

  const active = tooltip ? totals.get(tooltip.cell.date) : undefined;
  // 首列为星期标签，其余每周一列 1fr 均分，宽屏自动铺满、无横向滚动
  const gridColumns = `${LABEL_COL} repeat(${weekCount}, minmax(0, 1fr))`;

  return (
    <div className="flex flex-col" style={{ gap: GAP }}>
      {/* 月份刻度行（首列占位与星期标签对齐） */}
      <div
        className="grid h-3.5 text-[10px] leading-none text-ink-mute"
        style={{ gridTemplateColumns: gridColumns, gap: GAP }}
      >
        {monthLabels.map((m) => (
          <span
            key={m.col}
            className="whitespace-nowrap"
            style={{ gridColumnStart: m.col + 2 }}
          >
            {m.text}
          </span>
        ))}
      </div>
      {/* 星期标签列 + 格子：同一 grid（列流式填充，前 7 项为标签列） */}
      <div
        className="grid"
        style={{
          gridTemplateColumns: gridColumns,
          gridTemplateRows: "repeat(7, auto)",
          gridAutoFlow: "column",
          gap: GAP,
        }}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <span
            key={`wd-${i}`}
            className="flex items-center text-[10px] leading-none text-ink-mute"
          >
            {WEEKDAY_LABELS[i] ?? ""}
          </span>
        ))}
        {cells.map((cell) => {
          const level = heatLevel(totals.get(cell.date)?.requests ?? 0, max);
          return (
            <div
              key={cell.date}
              className="aspect-square w-full rounded-xs transition-transform hover:scale-125"
              style={{
                backgroundColor:
                  level === 0
                    ? "var(--muted)"
                    : `color-mix(in oklch, var(--primary) ${level * 25}%, var(--muted))`,
              }}
              onMouseEnter={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setTooltip({
                  cell,
                  x: rect.left + rect.width / 2,
                  y: rect.top,
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
      </div>

      {tooltip &&
        createPortal(
          <div
            className="pointer-events-none fixed z-50 rounded-md border border-edge bg-surface px-3 py-2 text-xs shadow-md"
            style={{ left: tooltip.x, top: tooltip.y - 8, transform: "translate(-50%, -100%)" }}
          >
            <p className="font-medium">{tooltip.cell.date}</p>
            {active ? (
              <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-ink-secondary">
                <span>请求数</span>
                <TabularText className="text-right">{fmt(active.requests)}</TabularText>
                <span>输入 Token</span>
                <TabularText className="text-right">{fmt(active.inputTokens)}</TabularText>
                <span>输出 Token</span>
                <TabularText className="text-right">{fmt(active.outputTokens)}</TabularText>
                <span>缓存 Token</span>
                <TabularText className="text-right">{fmt(active.cacheTokens)}</TabularText>
              </div>
            ) : (
              <p className="mt-1 text-ink-mute">无调用记录</p>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
