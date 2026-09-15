import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { EChartsOption } from "echarts";
import ReactEChartsImport from "echarts-for-react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";

// Vite + React 19: CJS default export may arrive nested (echarts-for-react#619)
type ChartComponent = typeof ReactEChartsImport;
const ReactECharts: ChartComponent =
  (ReactEChartsImport as unknown as { default?: ChartComponent }).default ??
  ReactEChartsImport;

const TOKEN_KEYS = [
  "primary",
  "info",
  "warning",
  "destructive",
  "primary-soft",
  "ink-primary",
  "ink-secondary",
  "ink-mute",
  "edge",
  "edge-strong",
  "card",
  "popover",
] as const;

export type ChartTokens = Record<(typeof TOKEN_KEYS)[number], string>;

function readTokens(): ChartTokens {
  const get = (name: string) =>
    getComputedStyle(document.documentElement)
      .getPropertyValue(`--${name}`)
      .trim();
  return Object.fromEntries(TOKEN_KEYS.map((k) => [k, get(k)])) as ChartTokens;
}

/**
 * 主题切换后重读 CSS 变量，驱动 ECharts option 重算。
 *
 * ponytail: next-themes 通过 useEffect 更新 DOM 的 .dark class，在 React 渲染之后才执行；
 * 若在 useMemo 中同步读取 CSS 变量，拿到的是旧主题的值（切换瞬间错位）。
 * 改用 useState + useEffect + 双 rAF：等 next-themes 的 effect 更新 DOM、浏览器重算样式后，
 * 再读 CSS 变量并触发重渲染。双 rAF 是为了兜底 effect 间执行顺序的不确定性。
 */
export function useChartTokens(): ChartTokens {
  const { resolvedTheme } = useTheme();
  const [tokens, setTokens] = useState<ChartTokens>(() => readTokens());

  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setTokens(readTokens()));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [resolvedTheme]);

  return tokens;
}

export function EChart({
  option,
  className,
  style,
}: {
  option: EChartsOption;
  className?: string;
  style?: CSSProperties;
}) {
  const t = useChartTokens();
  const { resolvedTheme } = useTheme();
  const themed = useMemo<EChartsOption>(() => {
    const tip = option.tooltip;
    const tipObj = tip && typeof tip === "object" && !Array.isArray(tip) ? tip : {};
    return {
      textStyle: { color: t["ink-primary"] },
      ...option,
      tooltip: {
        ...tipObj,
        backgroundColor: t.popover,
        borderColor: t["edge-strong"],
        borderWidth: 1,
        extraCssText: `color:${t["ink-primary"]};box-shadow:none;`,
        textStyle: { color: t["ink-primary"], fontSize: 11 },
      },
    };
  }, [option, t]);
  return (
    <ReactECharts
      key={resolvedTheme}
      option={themed}
      className={cn("h-full w-full", className)}
      style={{ height: "100%", width: "100%", ...style }}
      notMerge
      lazyUpdate
    />
  );
}
