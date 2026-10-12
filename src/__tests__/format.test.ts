import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatOutputTps,
  formatTokenCompact,
  formatTokenK,
  formatTokenMetric,
} from "@/lib/format";

describe("formatTokenCompact", () => {
  it("不足一万：原样千分位，不加单位与约等号", () => {
    expect(formatTokenCompact(0)).toBe("0");
    expect(formatTokenCompact(999)).toBe("999");
    expect(formatTokenCompact(9999)).toBe("9,999");
  });

  it("万档：≈ + 两位小数 + 万", () => {
    expect(formatTokenCompact(10000)).toBe("≈1.00万");
    expect(formatTokenCompact(20000)).toBe("≈2.00万");
    expect(formatTokenCompact(9_000_000)).toBe("≈900.00万");
    // 1000 万仍属万档（< 1 亿）
    expect(formatTokenCompact(10_000_000)).toBe("≈1000.00万");
    // 接近 1 亿但仍 < 1e8：留在万档，两位小数四舍五入
    expect(formatTokenCompact(99_999_999)).toBe("≈10000.00万");
  });

  it("亿档：≈ + 两位小数 + 亿", () => {
    expect(formatTokenCompact(100_000_000)).toBe("≈1.00亿");
    expect(formatTokenCompact(125_000_000)).toBe("≈1.25亿");
  });

  it("非有限值按 0 处理", () => {
    expect(formatTokenCompact(Number.NaN)).toBe("0");
    expect(formatTokenCompact(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("负数取绝对值折算并保留负号", () => {
    expect(formatTokenCompact(-20000)).toBe("-≈2.00万");
    expect(formatTokenCompact(-500)).toBe("-500");
  });
});

describe("formatTokenMetric", () => {
  it("万/亿一位小数，不足万用千分位", () => {
    expect(formatTokenMetric(12_400_000)).toBe("1240.0万");
    expect(formatTokenMetric(3_210_000)).toBe("321.0万");
    expect(formatTokenMetric(12_000)).toBe("1.2万");
    expect(formatTokenMetric(200_000_000)).toBe("2.0亿");
    expect(formatTokenMetric(1_250_000_000)).toBe("12.5亿");
    expect(formatTokenMetric(1248)).toBe("1,248");
    expect(formatTokenMetric(0)).toBe("0");
    expect(formatTokenMetric(Number.NaN)).toBe("0");
  });
});

describe("formatTokenK", () => {
  it("不足 1000 显示原始整数", () => {
    expect(formatTokenK(0)).toBe("0");
    expect(formatTokenK(94)).toBe("94");
    expect(formatTokenK(999)).toBe("999");
  });

  it("达到 1000 取整千 k", () => {
    expect(formatTokenK(1000)).toBe("1k");
    expect(formatTokenK(1025)).toBe("1k");
    expect(formatTokenK(2000)).toBe("2k");
    expect(formatTokenK(102291)).toBe("102k");
    expect(formatTokenK(110000)).toBe("110k");
  });

  it("负数保留符号，非有限值为 0", () => {
    expect(formatTokenK(-2000)).toBe("-2k");
    expect(formatTokenK(Number.NaN)).toBe("0");
  });
});

describe("formatDuration", () => {
  it("毫秒折算为秒（两位小数）", () => {
    expect(formatDuration(6458)).toBe("6.46s");
    expect(formatDuration(2150)).toBe("2.15s");
    expect(formatDuration(120)).toBe("0.12s");
    expect(formatDuration(0)).toBe("0.00s");
  });

  it("非有限值按 0.00s", () => {
    expect(formatDuration(Number.NaN)).toBe("0.00s");
  });
});

describe("formatOutputTps", () => {
  it("从首字算到结束，输出不少于 100", () => {
    // 24.70s - 5.36s = 19.34s，1656 / 19.34 ≈ 85.6
    expect(formatOutputTps(1656, 24_700, 5_360)).toBe("85.6 tok/s");
    expect(formatOutputTps(100, 2_000, 1_000)).toBe("100.0 tok/s");
  });

  it("输出不足 100、生成时间为 0 或时间缺失时不计算", () => {
    expect(formatOutputTps(99, 24_700, 5_360)).toBeNull();
    expect(formatOutputTps(200, 5_360, 5_360)).toBeNull();
    expect(formatOutputTps(200, null, 5_360)).toBeNull();
    expect(formatOutputTps(Number.NaN, 1_000, 100)).toBeNull();
  });

  it("没有首字且输出不少于 200 时按总用时估算并标约等", () => {
    // 等首字的时间算进分母，所以偏低
    expect(formatOutputTps(200, 10_000, null)).toBe("≈20.0 tok/s");
    expect(formatOutputTps(199, 10_000, null)).toBeNull();
  });
});
