import { describe, expect, it } from "vitest";

import {
  aggregateRange,
  periodRange,
} from "@/pages/Statistics/_components/EndpointStatsPanel";
import type { DailyStat } from "@/services/modules/stats";

// 2026-08-12 是周三
const TODAY = new Date(2026, 7, 12).getTime();

describe("periodRange", () => {
  it("today 走预设，yesterday 为昨日单日区间", () => {
    expect(periodRange("today", TODAY)).toEqual({ kind: "preset", key: "today" });
    const y = new Date(2026, 7, 11).getTime();
    expect(periodRange("yesterday", TODAY)).toEqual({
      kind: "custom",
      startMs: y,
      endMs: y,
    });
  });

  it("thisWeek 从周一起，thisMonth 从 1 号起", () => {
    expect(periodRange("thisWeek", TODAY)).toEqual({
      kind: "custom",
      startMs: new Date(2026, 7, 10).getTime(), // 周一
      endMs: TODAY,
    });
    expect(periodRange("thisMonth", TODAY)).toEqual({
      kind: "custom",
      startMs: new Date(2026, 7, 1).getTime(),
      endMs: TODAY,
    });
  });
});

describe("aggregateRange", () => {
  const row = (
    endpointName: string,
    date: string,
    requests: number,
    errors = 0,
  ): DailyStat => ({
    endpointName,
    date,
    requests,
    errors,
    inputTokens: 10,
    outputTokens: 5,
    cacheCreationTokens: 1,
    cacheReadTokens: 2,
  });

  it("按日期闭区间过滤并按端点合并，端点按请求数降序", () => {
    const rows = [
      row("a", "2026-08-09", 1), // 区间外
      row("a", "2026-08-10", 2),
      row("a", "2026-08-11", 3, 1),
      row("b", "2026-08-11", 9),
    ];
    const s = aggregateRange(rows, "2026-08-10", "2026-08-11");
    expect(s.requests).toBe(14);
    expect(s.errors).toBe(1);
    expect(s.inputTokens).toBe(30);
    expect(s.cacheReadTokens).toBe(6);
    expect(s.endpoints.map((e) => e.endpointName)).toEqual(["b", "a"]);
    expect(s.endpoints[1].requests).toBe(5); // a: 2+3
  });

  it("空区间返回全零", () => {
    const s = aggregateRange([row("a", "2026-08-09", 1)], "2026-01-01", "2026-01-02");
    expect(s.requests).toBe(0);
    expect(s.endpoints).toEqual([]);
  });
});
