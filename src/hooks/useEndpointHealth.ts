import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { endpointApi } from "@/services/modules/endpoint";
import { healthApi } from "@/services/modules/health";

/**
 * 订阅 `endpoint-health-changed`（熔断状态转换）与 `endpoints-changed`（启停/编辑/手动测试），
 * 按事件精确失效：配置变更只失效 `["endpoints"]`，熔断变更只失效 `["endpoint-health"]`，
 * 避免互相触发不必要的重请求。页级挂载一次即可，替代各组件内联的重复订阅。
 */
export function useEndpointHealthEvents() {
  const qc = useQueryClient();
  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let cancelled = false;
    endpointApi
      .onChanged(() => qc.invalidateQueries({ queryKey: ["endpoints"] }))
      .then((un) => {
        if (cancelled) un();
        else unlistens.push(un);
      });
    healthApi
      .onHealthChanged(() => qc.invalidateQueries({ queryKey: ["endpoint-health"] }))
      .then((un) => {
        if (cancelled) un();
        else unlistens.push(un);
      });
    return () => {
      cancelled = true;
      unlistens.forEach((un) => un());
    };
  }, [qc]);
}

/** 端点实时健康/熔断态查询（多组件共享同一 queryKey，React Query 自动去重）。 */
export function useEndpointHealth() {
  return useQuery({
    queryKey: ["endpoint-health"],
    queryFn: healthApi.getEndpointHealth,
  });
}
