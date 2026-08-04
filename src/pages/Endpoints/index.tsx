import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { PetSprite } from "@/components/pet/PetSprite";
import { useEndpoints } from "@/hooks/useEndpoints";
import { useEndpointHealthEvents } from "@/hooks/useEndpointHealth";
import { usePets } from "@/hooks/usePets";
import type { Endpoint } from "@/services/modules/endpoint";
import { petApi } from "@/services/modules/pet";
import { useFilterStore, useLayoutStore } from "@/stores";
import { DnDList } from "./_components/DnDList";
import { EndpointForm } from "./_components/EndpointForm";
import { EndpointSidebar } from "./_components/EndpointSidebar";
import { FilterBar } from "./_components/FilterBar";

export function Endpoints() {
  const { data: endpoints, isLoading } = useEndpoints();
  const { data: pets } = usePets();
  const { data: activeDirId } = useQuery({
    queryKey: ["pets", "active"],
    queryFn: petApi.getActive,
  });
  const activePet = useMemo(
    () => pets?.find((p) => p.dirId === activeDirId),
    [pets, activeDirId],
  );
  const search = useFilterStore((s) => s.search);
  const enabledOnly = useFilterStore((s) => s.enabledOnly);
  const transformer = useFilterStore((s) => s.transformer);
  const typeFilterActive = transformer !== "all";
  const view = useLayoutStore((s) => s.endpointView);

  // 熔断/端点变更事件 → 刷新各卡片的实时健康态与列表（共享 hook 统一订阅）。
  useEndpointHealthEvents();

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

  const dragEnabled = search === "" && !enabledOnly;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };
  const openEdit = (e: Endpoint) => {
    setEditing(e);
    setFormOpen(true);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* 第一行：标题 + 筛选控件（仅中栏有内容，左右空白对称占位让中栏居中） */}
      <div className="flex shrink-0 gap-4">
        <div className="hidden min-w-0 flex-[1] xl:block" aria-hidden />
        <div className="flex min-w-0 max-w-4xl flex-[3] flex-col gap-4">
          <h1 className="shrink-0 text-2xl font-light tracking-tight">端点管理</h1>
          <FilterBar onCreate={openCreate} />
        </div>
        <div className="hidden min-w-0 flex-[1] xl:block" aria-hidden />
      </div>

      {/* 第二行：端点列表（中栏） + 端点统计/可用模型（右栏），三栏顶部水平对齐 */}
      <div className="flex min-h-0 flex-1 gap-4">
        {/* 左栏：动效宠物展示区（xl 及以上显示，区域内可拖拽） */}
        <div className="hidden min-w-0 flex-[1] xl:block">
          {activePet ? (
            <div className="h-full w-full rounded-lg border border-edge bg-surface">
              <PetSprite pet={activePet} className="h-28 aspect-[192/208]" />
            </div>
          ) : null}
        </div>

        {/* 中栏：端点列表，限宽 4xl，超出内部滚动 */}
        <div className="scrollbar-none min-h-0 min-w-0 max-w-4xl flex-[3] overflow-y-auto rounded-lg border border-edge bg-surface p-4">
          {isLoading ? (
            <p className="text-sm text-ink-mute">加载中…</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-ink-mute">暂无端点，点击「新建端点」添加。</p>
          ) : (
            <DnDList
              endpoints={filtered}
              allEndpoints={endpoints ?? []}
              draggable={dragEnabled}
              typeFilterActive={typeFilterActive}
              view={view}
              onEdit={openEdit}
            />
          )}
        </div>

        {/* 右栏：端点统计 + 可用模型，顶部与中栏端点列表卡片对齐 */}
        <EndpointSidebar />
      </div>

      <EndpointForm open={formOpen} onOpenChange={setFormOpen} editing={editing} />
    </div>
  );
}
