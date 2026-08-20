/**
 * 用量图表的纯数据逻辑：按日合并、热力图网格、强度分级、趋势切片补零（按日 / 按小时）。
 * 与组件分离，便于单测（见 src/__tests__/usageChart.test.ts）。
 */
import { startOfDayMs } from "@/lib/dateRange";
import { ymd, type RangeValue, type TrendWindow } from "@/lib/range";

const DAY_MS = 86_400_000;

export interface DayTotals {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  totalTokens: number;
}

/** 按天行的最小结构（用量 DailyUsage / 端点 DailyStat 均满足）。 */
export interface DayRow {
  date: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** 后端按 (date, 来源/端点) 返回多行，这里按 date 合并求和。 */
export function mergeByDate(rows: DayRow[]): Map<string, DayTotals> {
  const map = new Map<string, DayTotals>();
  for (const r of rows) {
    const t = map.get(r.date) ?? {
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheTokens: 0,
      totalTokens: 0,
    };
    t.requests += r.requests;
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.cacheTokens += r.cacheCreationTokens + r.cacheReadTokens;
    t.totalTokens +=
      r.inputTokens + r.outputTokens + r.cacheCreationTokens + r.cacheReadTokens;
    map.set(r.date, t);
  }
  return map;
}

export interface HeatmapCell {
  date: string;
  ms: number;
  /** 周一=0 … 周日=6（网格行号）。 */
  dayIndex: number;
}

/** 周一对齐的行号：周一=0 … 周日=6。 */
function mondayIndex(ms: number): number {
  return (new Date(ms).getDay() + 6) % 7;
}

/**
 * 生成 GitHub 贡献图风格的格子序列：从 `weeks` 周前那一周的周一起，到今天止。
 * 顺序为按天递增，配合 `grid-auto-flow: column`（7 行）即自动按周成列。
 */
export function buildHeatmapCells(
  todayStartMs: number,
  weeks = 53,
): HeatmapCell[] {
  const currentMonday = todayStartMs - mondayIndex(todayStartMs) * DAY_MS;
  const start = new Date(currentMonday - (weeks - 1) * 7 * DAY_MS);
  // ponytail: 用 Date 构造器逐日递增而非 +DAY_MS，规避 DST 跳变导致的重复/缺日。
  const cells: HeatmapCell[] = [];
  for (let i = 0; ; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ms = d.getTime();
    if (ms > todayStartMs) break;
    cells.push({ date: ymd(ms), ms, dayIndex: mondayIndex(ms) });
  }
  return cells;
}

/** 相对分级：0 无数据；1–4 按与最大值的比例分档（自适应任意数据规模）。 */
export function heatLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (value <= 0 || max <= 0) return 0;
  const level = Math.ceil((value / max) * 4);
  return Math.min(4, Math.max(1, level)) as 1 | 2 | 3 | 4;
}

export interface TrendPoint {
  date: string;
  /** X 轴短标签，如 `8/12`。 */
  label: string;
  requests: number;
  tokens: number;
}

function parseYmd(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 按时间周期切出趋势序列（升序），缺失日期补 0。
 * 预设 `all`：从数据最早日期到今天；数据为空时仅今天一个点。
 * 自定义：起止日闭区间（终点不超过今天）。
 */
export function sliceTrend(
  merged: Map<string, DayTotals>,
  range: RangeValue,
  todayStartMs: number,
): TrendPoint[] {
  let startMs: number;
  let endMs = todayStartMs;
  if (range.kind === "custom") {
    startMs = startOfDayMs(range.startMs);
    endMs = Math.max(startMs, Math.min(startOfDayMs(range.endMs), todayStartMs));
  } else if (range.key === "today") startMs = todayStartMs;
  else if (range.key === "7d") startMs = todayStartMs - 6 * DAY_MS;
  else if (range.key === "30d") startMs = todayStartMs - 29 * DAY_MS;
  else {
    const dates = [...merged.keys()].sort();
    startMs = dates.length ? parseYmd(dates[0]).getTime() : todayStartMs;
  }

  const start = new Date(startMs);
  const points: TrendPoint[] = [];
  for (let i = 0; ; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const ms = d.getTime();
    if (ms > endMs) break;
    const date = ymd(ms);
    const t = merged.get(date);
    points.push({
      date,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      requests: t?.requests ?? 0,
      tokens: t?.totalTokens ?? 0,
    });
  }
  return points;
}

function startOfHourMs(ms: number): number {
  const d = new Date(ms);
  d.setMinutes(0, 0, 0);
  return d.getTime();
}

/** 本地小时键，与 SQLite `strftime('%Y-%m-%d %H:00', …, 'localtime')` 对齐。 */
export function hourKey(ms: number): string {
  const d = new Date(ms);
  return `${ymd(ms)} ${String(d.getHours()).padStart(2, "0")}:00`;
}

/**
 * 按小时切出趋势序列（升序），缺失小时补 0。
 * 上界截到 `min(now, endExclusive-1)` 所在小时，不垫未来空小时。
 */
export function sliceHourlyTrend(
  merged: Map<string, DayTotals>,
  { startMs, endExclusiveMs }: TrendWindow,
  nowMs: number,
): TrendPoint[] {
  const first = startOfHourMs(startMs);
  const last = startOfHourMs(Math.min(nowMs, endExclusiveMs - 1));
  if (last < first) return [];
  const points: TrendPoint[] = [];
  for (let i = 0; ; i++) {
    const d = new Date(first);
    d.setHours(d.getHours() + i);
    const ms = d.getTime();
    if (ms > last) break;
    const date = hourKey(ms);
    const t = merged.get(date);
    points.push({
      date,
      label: `${String(d.getHours()).padStart(2, "0")}:00`,
      requests: t?.requests ?? 0,
      tokens: t?.totalTokens ?? 0,
    });
  }
  return points;
}
