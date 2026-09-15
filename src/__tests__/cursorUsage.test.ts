import { describe, expect, it } from "vitest";

import {
  effortLevel,
  fmtTok,
  fmtUsd,
  hourlyStackSeries,
  maskEmail,
  topModels,
} from "@/pages/Statistics/_components/cursor/cursorUsage";

describe("fmtUsd", () => {
  it("美分转美元带千分位", () => {
    expect(fmtUsd(1234)).toBe("$12.34");
    expect(fmtUsd(0)).toBe("$0.00");
  });
});

describe("fmtTok", () => {
  it("按万/亿缩写", () => {
    expect(fmtTok(123)).toBe("123");
    expect(fmtTok(12_000)).toBe("1.2万");
    expect(fmtTok(200_000_000)).toBe("2.0亿");
  });
});

describe("maskEmail", () => {
  it("中间打码保留首尾", () => {
    expect(maskEmail("ab@x.com")).toBe("a****@x.com");
    expect(maskEmail("alice@x.com")).toBe("al****ce@x.com");
    expect(maskEmail("")).toBe("-");
  });
});

describe("effortLevel", () => {
  it("从模型名解析推理强度", () => {
    expect(effortLevel("gpt-5-high")).toBe("high");
    expect(effortLevel("claude-xhigh")).toBe("xhigh");
    expect(effortLevel("glm-5.2-max")).toBe("max");
    expect(effortLevel("composer")).toBe(null);
  });
});

describe("topModels", () => {
  it("按 weight 取 TOP n", () => {
    const top = topModels(
      [
        {
          models: [
            { model: "a", weight: 1, usagePct: 1 },
            { model: "b", weight: 9, usagePct: 9 },
          ],
        },
      ],
      1,
    );
    expect(top[0].model).toBe("b");
  });
});

describe("hourlyStackSeries", () => {
  it("TOP5 之外归其他", () => {
    const hourly = [
      {
        label: "00:00",
        models: [
          { model: "m1", cents: 50 },
          { model: "m2", cents: 40 },
          { model: "m3", cents: 30 },
          { model: "m4", cents: 20 },
          { model: "m5", cents: 10 },
          { model: "m6", cents: 5 },
        ],
      },
    ];
    const { keys, rows } = hourlyStackSeries(hourly);
    expect(keys).toContain("其他");
    expect(keys).toContain("m1");
    expect(Number(rows[0]["其他"])).toBe(5);
  });
});
