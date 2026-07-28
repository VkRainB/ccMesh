import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { statsApi } from "@/services/modules/stats";

export type RequestLogsMode = "live" | "ranged";

export interface RequestLogsParams {
  /** live：事件驱动实时刷新；ranged：时间段 + 分页查询。 */
  mode: RequestLogsMode;
  startMs?: number;
  endMs?: number;
  endpointFilter?: string;
  page: number;
  pageSize: number;
}

/**
 * 请求明细 7 段复合 queryKey：随 mode/区间/端点过滤/分页变化重新查询；
 * 可选段用 null 强制稳定锚点，避免 undefined 与具体值混用导致 key 漂移。
 */
export function requestLogsKey(p: RequestLogsParams): readonly unknown[] {
  return [
    "request-logs",
    p.mode,
    p.startMs ?? null,
    p.endMs ?? null,
    p.endpointFilter ?? null,
    p.page,
    p.pageSize,
  ];
}

/**
 * 请求明细分页查询；live 模式第 1 页由 `request-logged` 事件触发刷新，
 * 避免打断翻页浏览。统计页 ranged 与仪表盘 live 复用同一 hook。
 */
export function useRequestLogs(params: RequestLogsParams) {
  const qc = useQueryClient();
  const { mode, startMs, endMs, endpointFilter, page, pageSize } = params;

  useEffect(() => {
    if (mode !== "live") return;
    let un: (() => void) | undefined;
    let cancelled = false;
    statsApi
      .onRequestLogged(() => {
        if (page === 1) {
          qc.invalidateQueries({ queryKey: ["request-logs", "live"] });
        }
      })
      .then((u) => {
        if (cancelled) u();
        else un = u;
      });
    return () => {
      cancelled = true;
      un?.();
    };
  }, [mode, page, qc]);

  return useQuery({
    queryKey: requestLogsKey(params),
    queryFn: () =>
      statsApi.getRequestLogs({
        startMs,
        endMs,
        endpoint: endpointFilter,
        page,
        pageSize,
      }),
  });
}
