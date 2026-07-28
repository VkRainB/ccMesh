import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { statsApi } from "@/services/modules/stats";

/** 四周期统计；监听 `stats-updated` 事件零延迟刷新。 */
export function useStats() {
  const qc = useQueryClient();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    statsApi
      .onUpdated(() => qc.invalidateQueries({ queryKey: ["stats"] }))
      .then((un) => {
        if (cancelled) un();
        else unlisten = un;
      });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [qc]);

  return useQuery({ queryKey: ["stats"], queryFn: statsApi.getStats });
}
