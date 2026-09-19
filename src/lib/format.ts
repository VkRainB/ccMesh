/**
 * Token 数量的辅助单位文案：就近取量级，约等号 + 两位小数 + 中文单位。
 * - ≥ 1 亿：`≈1.25亿`
 * - ≥ 1 万：`≈900.00万`
 * - 否则：原始数字（千分位），不加单位与约等号
 *
 * 主数值仍应展示精确值，本函数仅产出"辅助小字"文案。
 * 非有限值按 `"0"` 处理；负数取绝对值折算并保留负号。
 */
export function formatTokenCompact(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${sign}≈${(abs / 1e8).toFixed(2)}亿`;
  if (abs >= 1e4) return `${sign}≈${(abs / 1e4).toFixed(2)}万`;
  return n.toLocaleString();
}

/**
 * 统计概览主数值：百万以上用 M（12.4M / 3.21M），否则千分位整数。
 * ≥10M 一位小数，1M–10M 两位小数，对齐用量卡片设计稿。
 */
export function formatTokenMetric(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1e9) {
    const v = abs / 1e9;
    return `${sign}${v >= 10 ? v.toFixed(1) : v.toFixed(2)}B`;
  }
  if (abs >= 1e6) {
    const v = abs / 1e6;
    return `${sign}${v >= 10 ? v.toFixed(1) : v.toFixed(2)}M`;
  }
  return `${sign}${Math.round(abs).toLocaleString()}`;
}

/**
 * Token 数量紧凑展示（千位 k 单位）：
 * - |n| ≥ 1000：取整千 → `1k`、`102k`、`110k`
 * - 否则：原始整数
 * 用于悬停明细等空间紧凑处。负数保留符号。
 */
export function formatTokenK(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000) return `${sign}${Math.round(abs / 1000)}k`;
  return String(Math.round(n));
}

/** 耗时统一按秒展示（两位小数）：`6458ms → 6.46s`。非有限值按 `0.00s`。 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "0.00s";
  return `${(ms / 1000).toFixed(2)}s`;
}
