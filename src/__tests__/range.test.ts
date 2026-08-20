import { describe, expect, it } from "vitest";

import {
  isHourlyTrend,
  rangeDates,
  rangeMs,
  resolveTrendWindow,
  startOfTodayMs,
} from "@/lib/range";

const DAY = 86_400_000;
// 固定锚点：2026-06-07 00:00 本地时间（用具体时刻推导，避免依赖运行时"今天"）
const anchor = new Date(2026, 5, 7, 0, 0, 0, 0).getTime();

describe("startOfTodayMs", () => {
  it("按天对齐：同一天内任意时刻得到相同的 0 点锚点", () => {
    const morning = new Date(2026, 5, 7, 8, 30, 12, 345).getTime();
    const night = new Date(2026, 5, 7, 23, 59, 59, 999).getTime();
    expect(startOfTodayMs(morning)).toBe(anchor);
    expect(startOfTodayMs(night)).toBe(anchor);
  });
});

describe("rangeMs（稳定性 + 边界）", () => {
  it("同一 key 同一锚点结果相等（防 queryKey 漂移回归）", () => {
    expect(rangeMs("today", anchor)).toEqual(rangeMs("today", anchor));
    expect(rangeMs("7d", anchor)).toEqual(rangeMs("7d", anchor));
  });

  it("today：当日 0 点 → 次日 0 点", () => {
    expect(rangeMs("today", anchor)).toEqual({
      startMs: anchor,
      endMs: anchor + DAY,
    });
  });

  it("7d/30d：以今天为锚按天回溯，上界为次日 0 点", () => {
    expect(rangeMs("7d", anchor)).toEqual({
      startMs: anchor - 6 * DAY,
      endMs: anchor + DAY,
    });
    expect(rangeMs("30d", anchor)).toEqual({
      startMs: anchor - 29 * DAY,
      endMs: anchor + DAY,
    });
  });

  it("all：无界", () => {
    expect(rangeMs("all", anchor)).toEqual({});
  });
});

describe("rangeDates（本地 YYYY-MM-DD）", () => {
  it("today：闭区间为今天", () => {
    expect(rangeDates("today", anchor)).toEqual({
      start: "2026-06-07",
      end: "2026-06-07",
    });
  });

  it("7d：[today-6, today]", () => {
    expect(rangeDates("7d", anchor)).toEqual({
      start: "2026-06-01",
      end: "2026-06-07",
    });
  });

  it("all：无界", () => {
    expect(rangeDates("all", anchor)).toEqual({});
  });
});

describe("resolveTrendWindow / isHourlyTrend", () => {
  const preset = (key: "today" | "7d" | "30d" | "all") =>
    ({ kind: "preset", key }) as const;
  const custom = (startMs: number, endMs: number) =>
    ({ kind: "custom", startMs, endMs }) as const;
  const hourly = (range: ReturnType<typeof preset> | ReturnType<typeof custom>, today = anchor) =>
    isHourlyTrend(resolveTrendWindow(range, today));

  it("today → 小时，窗 = [今日0, 次日0)", () => {
    expect(resolveTrendWindow(preset("today"), anchor)).toEqual({
      startMs: anchor,
      endExclusiveMs: anchor + DAY,
    });
    expect(hourly(preset("today"))).toBe(true);
  });

  it("昨日零宽 → 小时，窗 = [昨日0, 今日0)", () => {
    const y = anchor - DAY;
    const range = custom(y, y);
    expect(resolveTrendWindow(range, anchor)).toEqual({
      startMs: y,
      endExclusiveMs: anchor,
    });
    expect(hourly(range)).toBe(true);
  });

  it("周二「本周」（两端 0 点、跨两日）→ 按天", () => {
    const mon = anchor;
    const tue = anchor + DAY;
    const range = custom(mon, tue);
    expect(resolveTrendWindow(range, tue)).toEqual({
      startMs: mon,
      endExclusiveMs: tue + DAY,
    });
    expect(hourly(range, tue)).toBe(false);
  });

  it("周一「本周」零宽 → 小时（就是今日）", () => {
    expect(hourly(custom(anchor, anchor))).toBe(true);
  });

  it("custom 10:00–18:00 → 小时", () => {
    const range = custom(
      new Date(2026, 5, 7, 10, 0).getTime(),
      new Date(2026, 5, 7, 18, 0).getTime(),
    );
    expect(hourly(range)).toBe(true);
  });

  it("custom 跨 25h → 按天", () => {
    expect(hourly(custom(anchor, anchor + DAY + 3_600_000))).toBe(false);
  });

  it("7d / all → 按天", () => {
    expect(hourly(preset("7d"))).toBe(false);
    expect(hourly(preset("all"))).toBe(false);
    expect(resolveTrendWindow(preset("all"), anchor)).toBeNull();
  });
});
