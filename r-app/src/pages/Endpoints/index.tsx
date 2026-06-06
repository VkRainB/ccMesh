import { useMemo, useState } from "react";

import { useEndpoints } from "@/hooks/useEndpoints";
import type { Endpoint } from "@/services/modules/endpoint";
import { useFilterStore, useLayoutStore } from "@/stores";
import { DnDList } from "./_components/DnDList";
import { EndpointForm } from "./_components/EndpointForm";
import { FilterBar } from "./_components/FilterBar";
import { ModelList } from "./_components/ModelList";

export function Endpoints() {
  const { data: endpoints, isLoading } = useEndpoints();
  const search = useFilterStore((s) => s.search);
  const enabledOnly = useFilterStore((s) => s.enabledOnly);
  const transformer = useFilterStore((s) => s.transformer);
  const isActive = useFilterStore((s) => s.isActive);
  const view = useLayoutStore((s) => s.endpointView);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Endpoint | null>(null);

  const filtered = useMemo(
    () =>
      (endpoints ?? []).filter(
        (e) =>
          (!enabledOnly || e.enabled) &&
          (transformer === "all" || e.transformer === transformer) &&
          (search === "" ||
            e.name.toLowerCase().includes(search.toLowerCase()) ||
            e.apiUrl.toLowerCase().includes(search.toLowerCase())),
      ),
    [endpoints, search, enabledOnly, transformer],
  );

  const dragEnabled = !isActive();

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (e: Endpoint) => {
    setEditing(e);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <h1 className="text-2xl font-light tracking-tight">端点管理</h1>
      <FilterBar onCreate={openCreate} />
      {isLoading ? (
        <p className="text-sm text-ink-mute">加载中…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-ink-mute">暂无端点，点击「新建端点」添加。</p>
      ) : (
        <DnDList endpoints={filtered} draggable={dragEnabled} view={view} onEdit={openEdit} />
      )}
      <ModelList />
      <EndpointForm open={formOpen} onOpenChange={setFormOpen} editing={editing} />
    </div>
  );
}
