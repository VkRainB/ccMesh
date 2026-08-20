import { describe, expect, it } from "vitest";

import {
  buildHeatmapCells,
  heatLevel,
  hourKey,
  mergeByDate,
  sliceHourlyTrend,
  sliceTrend,
} from "@/pages/Statistics/_components/usageChart";
import type { DailyUsage } from "@/services/modules/usage";

// 固定锚点：2026-08-12 是周三（周一对齐行号 = 2）
const TODAY = new Date(2026, 7, 12).getTime();

function row(date: string, appType: string, requests: number): DailyUsage {
  return {
    date,
    appType,
    requests,
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationTokens: 3,
    cacheReadTokens: 4,
  };
}

describe("mergeByDate", () => {
  it("同日多来源求和", () => {
    const m = mergeByDate([row("2026-08-10", "claude", 5), row("2026-08-10", "codex", 7)]);
    const t = m.get("2026-08-10")!;
    expect(t.requests).toBe(12);
    expect(t.inputTokens).toBe(20);
    expect(t.cacheTokens).toBe(14);
    expect(t.totalTokens).toBe(74);
  });
});

describe("buildHeatmapCells", () => {
  const cells = buildHeatmapCells(TODAY);

  it("首格为周一、末格为今天", () => {
    expect(cells[0].dayIndex).toBe(0);
    expect(cells[cells.length - 1].date).toBe("2026-08-12");
    expect(cells[cells.length - 1].dayIndex).toBe(2);
  });

  it("53 周网格：52 满周 + 今天所在周 3 天", () => {
    expect(cells.length).toBe(52 * 7 + 3);
  });

  it("日期连续且不重复", () => {
    const dates = new Set(cells.map((c) => c.date));
    expect(dates.size).toBe(cells.length);
    for (let i = 1; i < cells.length; i++) {
      expect(cells[i].ms - cells[i - 1].ms).toBe(86_400_000);
    }
  });
});

describe("heatLevel", () => {
  it("边界：0 无数据、最大值满档、最小非零至少 1 档", () => {
    expect(heatLevel(0, 100)).toBe(0);
    expect(heatLevel(5, 0)).toBe(0);
    expect(heatLevel(100, 100)).toBe(4);
    expect(heatLevel(1, 100)).toBe(1);
    expect(heatLevel(50, 100)).toBe(2);
    expect(heatLevel(76, 100)).toBe(4);
  });
});

describe("sliceTrend", () => {
  const merged = mergeByDate([row("2026-08-10", "claude", 5)]);
  const preset = (key: "today" | "7d" | "30d" | "all") =>
    ({ kind: "preset", key }) as const;

  it("7d：7 个点升序，缺失日期补 0", () => {
    const pts = sliceTrend(merged, preset("7d"), TODAY);
    expect(pts.length).toBe(7);
    expect(pts[0].date).toBe("2026-08-06");
    expect(pts[6].date).toBe("2026-08-12");
    expect(pts.map((p) => p.requests)).toEqual([0, 0, 0, 0, 5, 0, 0]);
    expect(pts[4].tokens).toBe(37);
  });

  it("today：单点", () => {
    const pts = sliceTrend(merged, preset("today"), TODAY);
    expect(pts.length).toBe(1);
    expect(pts[0].date).toBe("2026-08-12");
  });

  it("all：从最早数据日到今天；空数据仅今天", () => {
    expect(sliceTrend(merged, preset("all"), TODAY).length).toBe(3);
    expect(sliceTrend(new Map(), preset("all"), TODAY).length).toBe(1);
  });

  it("custom：起止日闭区间，终点截到今天", () => {
    const custom = (startMs: number, endMs: number) =>
      ({ kind: "custom", startMs, endMs }) as const;
    // 08-09 10:30 ~ 08-11 08:00 → 09/10/11 三天
    const pts = sliceTrend(
      merged,
      custom(new Date(2026, 7, 9, 10, 30).getTime(), new Date(2026, 7, 11, 8, 0).getTime()),
      TODAY,
    );
    expect(pts.map((p) => p.date)).toEqual(["2026-08-09", "2026-08-10", "2026-08-11"]);
    expect(pts[1].requests).toBe(5);
    // 终点在未来 → 截到今天
    const clamped = sliceTrend(
      merged,
      custom(new Date(2026, 7, 11).getTime(), new Date(2026, 7, 20).getTime()),
      TODAY,
    );
    expect(clamped[clamped.length - 1].date).toBe("2026-08-12");
  });
});

describe("sliceHourlyTrend", () => {
  const dayStart = new Date(2026, 7, 12, 0, 0, 0, 0).getTime();
  const tomorrow = dayStart + 86_400_000;

  it("今日 now=14:37：点为 00…14，无 15–23；缺小时补 0", () => {
    const ten = new Date(2026, 7, 12, 10, 0).getTime();
    const merged = mergeByDate([row(hourKey(ten), "claude", 5)]);
    const now = new Date(2026, 7, 12, 14, 37).getTime();
    const pts = sliceHourlyTrend(merged, { startMs: dayStart, endExclusiveMs: tomorrow }, now);
    expect(pts).toHaveLength(15);
    expect(pts[0].label).toBe("00:00");
    expect(pts[14].label).toBe("14:00");
    expect(pts.map((p) => p.label)).not.toContain("15:00");
    expect(pts[10].requests).toBe(5);
    expect(pts[0].requests).toBe(0);
  });

  it("昨日：24 点，00…23", () => {
    const y = dayStart - 86_400_000;
    const pts = sliceHourlyTrend(new Map(), { startMs: y, endExclusiveMs: dayStart }, dayStart);
    expect(pts).toHaveLength(24);
    expect(pts[0].label).toBe("00:00");
    expect(pts[23].label).toBe("23:00");
  });

  it("空数据仍画出到 lastHour 的零序列", () => {
    const now = new Date(2026, 7, 12, 2, 10).getTime();
    const pts = sliceHourlyTrend(new Map(), { startMs: dayStart, endExclusiveMs: tomorrow }, now);
    expect(pts.map((p) => p.requests)).toEqual([0, 0, 0]);
  });
});
