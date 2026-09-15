export type EffortLevel = "xhigh" | "high" | "medium" | "low";

export function fmtUsd(cents: number | undefined | null): string {
  return (
    "$" +
    (Number(cents || 0) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function maskEmail(email: string | undefined | null): string {
  if (!email || !email.includes("@")) return email || "-";
  const i = email.indexOf("@");
  const local = email.slice(0, i);
  const dom = email.slice(i);
  if (local.length <= 2) return `${local[0] ?? ""}****${dom}`;
  return `${local.slice(0, 2)}****${local.slice(-2)}${dom}`;
}

export function effortLevel(model: string): EffortLevel | null {
  const m = (model || "").toLowerCase();
  if (m.includes("xhigh")) return "xhigh";
  if (m.includes("high")) return "high";
  if (m.includes("medium")) return "medium";
  if (m.includes("low")) return "low";
  return null;
}

export function topModels(
  categories: { models: { model: string; weight: number; usagePct: number }[] }[],
  n = 10,
) {
  const models = categories.flatMap((c) => c.models);
  return [...models].sort((a, b) => b.weight - a.weight).slice(0, n);
}

export interface HourlyStackRow {
  label: string;
  [model: string]: string | number;
}

/** 今日逐小时：金额 TOP5 模型 + 其他，供堆叠柱。 */
export function hourlyStackSeries(
  hourly: { label: string; models: { model: string; cents: number }[] }[],
): { rows: HourlyStackRow[]; keys: string[] } {
  const totals: Record<string, number> = {};
  hourly.forEach((h) =>
    h.models.forEach((m) => {
      totals[m.model] = (totals[m.model] ?? 0) + m.cents;
    }),
  );
  const keys = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);
  const rows: HourlyStackRow[] = hourly.map((h) => {
    const row: HourlyStackRow = { label: h.label };
    let other = 0;
    h.models.forEach((m) => {
      if (keys.includes(m.model)) row[m.model] = m.cents;
      else other += m.cents;
    });
    if (other > 0) row["其他"] = other;
    return row;
  });
  const outKeys = rows.some((r) => Number(r["其他"] ?? 0) > 0) ? [...keys, "其他"] : keys;
  return { rows, keys: outKeys };
}

export function fmtCycleDay(ms: number | undefined): string {
  if (!ms) return "-";
  const n = Number(ms);
  const t = n < 1e12 ? n * 1000 : n;
  const dt = new Date(t);
  return `${dt.getMonth() + 1}-${String(dt.getDate()).padStart(2, "0")}`;
}
