import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { move } from "@dnd-kit/helpers";

import { endpointApi, type Endpoint } from "@/services/modules/endpoint";
import type { EndpointView } from "@/stores";
import { EndpointCard } from "./EndpointCard";

interface Props {
  endpoints: Endpoint[];
  draggable: boolean;
  view: EndpointView;
  onEdit: (e: Endpoint) => void;
}

interface RowProps {
  endpoint: Endpoint;
  index: number;
  draggable: boolean;
  view: EndpointView;
  onEdit: (e: Endpoint) => void;
}

/** 单行：useSortable 接管位移/放置动画，把 handleRef 交给 EndpointCard 的 grip 图标。 */
function SortableRow({ endpoint, index, draggable, view, onEdit }: RowProps) {
  const { ref, handleRef, isDragging } = useSortable({
    id: endpoint.id,
    index,
    disabled: !draggable,
  });

  return (
    <div ref={ref} style={{ opacity: isDragging ? 0.5 : undefined }}>
      <EndpointCard
        endpoint={endpoint}
        onEdit={onEdit}
        draggable={draggable}
        dragHandleRef={handleRef}
        view={view}
      />
    </div>
  );
}

/** 基于 @dnd-kit/react 的拖拽排序；list/grid 仅切换容器样式，拖拽逻辑共用。 */
export function DnDList({ endpoints, draggable, view, onEdit }: Props) {
  const qc = useQueryClient();
  const [order, setOrder] = useState<Endpoint[]>(endpoints);

  useEffect(() => {
    setOrder(endpoints);
  }, [endpoints]);

  const reorder = useMutation({
    mutationFn: (ids: number[]) => endpointApi.reorder(ids),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["endpoints"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const containerClass =
    view === "grid"
      ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
      : "flex flex-col gap-2";

  return (
    <DragDropProvider
      onDragEnd={(event) => {
        if (event.canceled) return;
        const next = move(order, event);
        if (next.every((e, i) => e.id === order[i].id)) return;
        setOrder(next);
        reorder.mutate(next.map((e) => e.id));
      }}
    >
      <div className={containerClass}>
        {order.map((ep, index) => (
          <SortableRow
            key={ep.id}
            endpoint={ep}
            index={index}
            draggable={draggable}
            view={view}
            onEdit={onEdit}
          />
        ))}
      </div>
    </DragDropProvider>
  );
}
