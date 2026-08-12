import { move } from "@dnd-kit/helpers";
import { DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { GripVerticalIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { PiOmpProviderMeta } from "@/lib/piOmpCommon";
import { cn } from "@/lib/utils";

function SortableProviderRow({
  provider,
  index,
  selected,
  onSelect,
  onDelete,
  onToggle,
}: {
  provider: PiOmpProviderMeta;
  index: number;
  selected: boolean;
  onSelect: (providerId: string) => void;
  onDelete: (provider: PiOmpProviderMeta) => void;
  onToggle: (providerId: string, enabled: boolean) => void;
}) {
  const { ref, handleRef, isDragging } = useSortable({ id: provider.id, index });

  return (
    <li
      ref={ref}
      className={cn(
        "group rounded-md border border-transparent transition-colors",
        selected
          ? "border-primary/30 bg-primary/10 text-primary"
          : provider.enabled
            ? "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary"
            : "text-ink-mute opacity-70 hover:bg-surface-hover",
      )}
      style={{ opacity: isDragging ? 0.5 : undefined }}
    >
      <div className="flex cursor-pointer items-center gap-2 px-2 py-2" onClick={() => onSelect(provider.id)}>
        <span
          ref={handleRef}
          aria-label="拖动以排序"
          className="shrink-0 cursor-grab touch-none text-ink-mute"
          onClick={(event) => event.stopPropagation()}
        >
          <GripVerticalIcon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium" title={provider.name}>
              {provider.name}
            </span>
            {provider.isDefault && (
              <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">默认</span>
            )}
          </div>
          <p className="truncate text-[11px] text-ink-mute">
            {provider.id} · {provider.modelCount} models
          </p>
        </div>
        <Switch
          checked={provider.enabled}
          onClick={(event) => event.stopPropagation()}
          onCheckedChange={(enabled) => onToggle(provider.id, enabled)}
        />
        <button
          type="button"
          aria-label={`删除 ${provider.name}`}
          className="size-3.5 shrink-0 text-ink-mute opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100 group-focus-within:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onDelete(provider);
          }}
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>
    </li>
  );
}

export function ProviderList({
  providers,
  loading,
  selectedId,
  onSelect,
  onNew,
  onDelete,
  onToggle,
  onReorder,
}: {
  providers: PiOmpProviderMeta[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (providerId: string) => void;
  onNew: () => void;
  onDelete: (provider: PiOmpProviderMeta) => void;
  onToggle: (providerId: string, enabled: boolean) => void;
  onReorder: (nextProviders: PiOmpProviderMeta[]) => void;
}) {
  return (
    <div className="flex h-full min-h-0 w-64 shrink-0 flex-col rounded-lg border border-edge bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <span className="text-sm font-medium text-ink-secondary">拆分渠道</span>
        <Button type="button" variant="ghost" size="icon" onClick={onNew} aria-label="新增渠道">
          <PlusIcon className="size-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-4 text-center text-xs text-ink-mute">同步中…</p>
        ) : providers.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-ink-mute">
            暂无拆分渠道，点击右上角 + 新增
          </p>
        ) : (
          <DragDropProvider
            onDragEnd={(event) => {
              if (event.canceled) return;
              const nextProviders = move(providers, event).map((provider, providerIndex) => ({
                ...provider,
                order: providerIndex,
              }));
              if (
                nextProviders.length === providers.length &&
                nextProviders.every((provider, index) => provider.id === providers[index]?.id)
              ) {
                return;
              }
              onReorder(nextProviders);
            }}
          >
            <ul className="flex flex-col gap-1">
              {providers.map((provider, index) => (
                <SortableProviderRow
                  key={provider.id}
                  provider={provider}
                  index={index}
                  selected={selectedId === provider.id}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onToggle={onToggle}
                />
              ))}
            </ul>
          </DragDropProvider>
        )}
      </div>
    </div>
  );
}

export function upsertProviderMeta(
  providers: PiOmpProviderMeta[],
  nextProvider: PiOmpProviderMeta,
): PiOmpProviderMeta[] {
  const existingIndex = providers.findIndex((provider) => provider.id === nextProvider.id);
  if (existingIndex < 0) {
    return [...providers, { ...nextProvider, order: providers.length }];
  }
  return providers.map((provider, providerIndex) =>
    providerIndex === existingIndex ? { ...nextProvider, order: provider.order } : provider,
  );
}

export function sortProviders(providers: PiOmpProviderMeta[]): PiOmpProviderMeta[] {
  return [...providers]
    .sort((leftProvider, rightProvider) =>
      leftProvider.order === rightProvider.order
        ? leftProvider.name.localeCompare(rightProvider.name)
        : leftProvider.order - rightProvider.order,
    )
    .map((provider, providerIndex) => ({ ...provider, order: providerIndex }));
}
