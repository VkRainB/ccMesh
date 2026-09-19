import { describe, expect, it } from "vitest";

import {
  cacheHitRate,
  cachePromptDenom,
  EMPTY_BUCKETS,
  formatCacheHitPercent,
  fromUsageSummary,
  realConsumption,
  trendPct,
  type TokenBuckets,
} from "@/lib/usageMetrics";

const buckets = (
  input: number,
  output: number,
  write: number,
  read: number,
): TokenBuckets => ({
  inputTokens: input,
  outputTokens: output,
  cacheCreationTokens: write,
  cacheReadTokens: read,
});

describe("realConsumption", () => {
  it("四桶相加，含输出", () => {
    expect(realConsumption(buckets(200, 50, 300, 500))).toBe(1050);
    expect(realConsumption(EMPTY_BUCKETS)).toBe(0);
  });
});

describe("cacheHitRate", () => {
  it("例 A：OpenAI 归一后 75%", () => {
    // input_net=500, cache_read=1500, cache_write=0, output=100
    expect(cacheHitRate(buckets(500, 100, 0, 1500))).toBe(0.75);
  });

  it("例 B：Claude 净输入+读+写 = 50%，输出不进分母", () => {
    expect(cacheHitRate(buckets(200, 50, 300, 500))).toBe(0.5);
    expect(cachePromptDenom(buckets(200, 50, 300, 500))).toBe(1000);
  });

  it("例 D：写入进分母，去掉 write 会虚高", () => {
    expect(cacheHitRate(buckets(400, 80, 200, 600))).toBe(0.5);
  });

  it("例 E：会话 SUM 后再除（token 加权）", () => {
    // 冷启动 8000/0/8000 + 热请求 9×(200/15800/0)
    const cold = buckets(8000, 0, 8000, 0);
    const hot = buckets(200 * 9, 0, 0, 15800 * 9);
    const sum = buckets(
      cold.inputTokens + hot.inputTokens,
      0,
      cold.cacheCreationTokens + hot.cacheCreationTokens,
      cold.cacheReadTokens + hot.cacheReadTokens,
    );
    expect(cacheHitRate(sum)).toBeCloseTo(0.88875, 10);
  });

  it("例 F：空数据返回 null，不当成 0% 命中", () => {
    expect(cacheHitRate(EMPTY_BUCKETS)).toBeNull();
    expect(formatCacheHitPercent(null)).toBe("—");
  });

  it("错法：净输入当分母会超过 100%，推荐式不会", () => {
    const b = buckets(200, 50, 300, 500);
    expect(500 / 200).toBeGreaterThan(1);
    expect(cacheHitRate(b)!).toBeLessThanOrEqual(1);
  });
});

describe("formatCacheHitPercent", () => {
  it("一位小数，满命中才 100%", () => {
    expect(formatCacheHitPercent(0.724)).toBe("72.4%");
    expect(formatCacheHitPercent(0.5)).toBe("50.0%");
    expect(formatCacheHitPercent(1)).toBe("100%");
    expect(formatCacheHitPercent(0)).toBe("0.0%");
  });

  it("99.95% 以上不到 100 显示 99.9%，不四舍五入成 100%", () => {
    expect(formatCacheHitPercent(0.9996)).toBe("99.9%");
    expect(formatCacheHitPercent(0.999)).toBe("99.9%");
  });
});

describe("trendPct", () => {
  it("按昨日对比，无基线返回 null", () => {
    expect(trendPct(108.3, 100)).toBeCloseTo(8.3, 5);
    expect(trendPct(50, 100)).toBe(-50);
    expect(trendPct(10, 0)).toBeNull();
    expect(trendPct(0, 0)).toBeNull();
  });
});

describe("fromUsageSummary", () => {
  it("映射 total* 字段", () => {
    expect(
      fromUsageSummary({
        totalInputTokens: 1,
        totalOutputTokens: 2,
        totalCacheCreationTokens: 3,
        totalCacheReadTokens: 4,
      }),
    ).toEqual(buckets(1, 2, 3, 4));
  });
});
