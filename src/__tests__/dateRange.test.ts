import { describe, expect, it } from "vitest";

import {
  calendarDays,
  fmtTimeInput,
  startOfDayMs,
  withDatePart,
  withDayFrom,
  withTimePart,
} from "@/lib/dateRange";
import { rangeValueLabel, rangeValueMs, rangeValueUsageFilter } from "@/lib/range";

describe("calendarDays", () => {
  it("42 格、周日起始、覆盖整月", () => {
    // 2026-08-01 是周六
    const days = calendarDays(2026, 7);
    expect(days.length).toBe(42);
    expect(new Date(days[0]).getDay()).toBe(0); // 周日
    expect(new Date(days[0]).getDate()).toBe(26); // 7 月 26 日
    const inMonth = days.filter((ms) => new Date(ms).getMonth() === 7);
    expect(inMonth.length).toBe(31);
    // 连续递增一天
    expect(days[1] - days[0]).toBe(86_400_000);
  });
});

describe("日期/时间部件合成", () => {
  const base = new Date(2026, 7, 12, 21, 45).getTime();

  it("withDatePart 换日保时；无效输入原样返回", () => {
    const next = withDatePart(base, "2026-08-01");
    const d = new Date(next);
    expect([d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      8, 1, 21, 45,
    ]);
    expect(withDatePart(base, "")).toBe(base);
  });

  it("withTimePart 换时保日；无效输入原样返回", () => {
    const next = withTimePart(base, "08:30");
    const d = new Date(next);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([12, 8, 30]);
    expect(withTimePart(base, "abc")).toBe(base);
  });

  it("withDayFrom 取目标日的年月日 + 原值的时分", () => {
    const day = new Date(2026, 0, 3).getTime();
    const d = new Date(withDayFrom(base, day));
    expect([d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([
      0, 3, 21, 45,
    ]);
  });

  it("startOfDayMs / fmtTimeInput", () => {
    expect(startOfDayMs(base)).toBe(new Date(2026, 7, 12).getTime());
    expect(fmtTimeInput(base)).toBe("21:45");
  });
});

describe("RangeValue 助手", () => {
  const todayStart = new Date(2026, 7, 12).getTime();

  it("preset 走 date 闭区间，custom 走 ts 毫秒", () => {
    expect(rangeValueUsageFilter({ kind: "preset", key: "today" }, todayStart)).toEqual({
      start: "2026-08-12",
      end: "2026-08-12",
    });
    const custom = { kind: "custom", startMs: 1000, endMs: 2000 } as const;
    expect(rangeValueUsageFilter(custom, todayStart)).toEqual({
      startTs: 1000,
      endTs: 2000,
    });
    expect(rangeValueMs(custom, todayStart)).toEqual({ startMs: 1000, endMs: 2000 });
  });

  it("label：preset 用选项文案，custom 用起止时间", () => {
    expect(rangeValueLabel({ kind: "preset", key: "7d" })).toBe("近 7 天");
    const label = rangeValueLabel({
      kind: "custom",
      startMs: new Date(2026, 7, 1, 0, 0).getTime(),
      endMs: new Date(2026, 7, 12, 21, 45).getTime(),
    });
    expect(label).toBe("08-01 00:00 ~ 08-12 21:45");
  });
});
