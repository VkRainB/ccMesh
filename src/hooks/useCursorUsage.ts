import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { cursorUsageApi } from "@/services/modules/cursorUsage";

const STALE_MS = 5 * 60 * 1000;

export function useCursorUsage(autoRefreshSec = 0, enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["cursor-usage"],
    queryFn: cursorUsageApi.get,
    enabled,
  });

  const refresh = useMutation({
    mutationFn: cursorUsageApi.refresh,
    onSuccess: (data) => {
      qc.setQueryData(["cursor-usage"], data);
    },
    onError: (e) =>
      toast.error(`Cursor 用量刷新失败：${e instanceof Error ? e.message : String(e)}`),
  });

  const bootstrapped = useRef(false);
  useEffect(() => {
    if (!enabled || query.isLoading || bootstrapped.current) return;
    bootstrapped.current = true;
    const age = query.data?.fetchedAt ? Date.now() - query.data.fetchedAt : Infinity;
    if (age > STALE_MS) refresh.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, query.isLoading, query.data?.fetchedAt]);

  useEffect(() => {
    if (!enabled || autoRefreshSec <= 0) return;
    const id = setInterval(() => refresh.mutate(), autoRefreshSec * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, autoRefreshSec]);

  return { snapshot: query.data ?? null, query, refresh };
}
