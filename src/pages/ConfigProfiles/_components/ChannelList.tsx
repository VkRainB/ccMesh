import type { ReactNode } from "react";
import { BookmarkIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ListItem {
  id: string;
  name: string;
  /** 当前应用中的配置（如 Claude Desktop appliedId）。 */
  active?: boolean;
}

interface Props<T extends ListItem> {
  channels: T[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (channel: T) => void;
  /** 左栏标题，默认「渠道」。 */
  title?: string;
  /** 标题与新增按钮之间的附加内容（如状态徽章）。 */
  headerAddon?: ReactNode;
  /** 顶栏右侧、新增按钮左侧的动作区（如「更多配置」）。 */
  headerActions?: ReactNode;
  /** 空态提示，默认「暂无渠道，点击右上角 + 新增」。 */
  emptyLabel?: string;
  /** 新增按钮 aria/title，默认「新增渠道」。 */
  newLabel?: string;
}

/** 左栏：已保存渠道/配置文件列表 + 顶部新增按钮。行内删除按钮与右键菜单都触发 onDelete。 */
export function ChannelList<T extends ListItem>({
  channels,
  loading,
  selectedId,
  onSelect,
  onNew,
  onDelete,
  title = "渠道",
  headerAddon,
  headerActions,
  emptyLabel = "暂无渠道，点击右上角 + 新增",
  newLabel = "新增渠道",
}: Props<T>) {
  return (
    <div className="flex h-full min-h-0 w-56 shrink-0 flex-col rounded-lg border border-edge bg-surface">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-sm font-medium text-ink-secondary">{title}</span>
          {headerAddon}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {headerActions}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="shrink-0"
            onClick={onNew}
            aria-label={newLabel}
            title={newLabel}
          >
            <PlusIcon className="size-4" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {loading ? (
          <p className="px-2 py-4 text-center text-xs text-ink-mute">加载中…</p>
        ) : channels.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-ink-mute">{emptyLabel}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {channels.map((ch) => (
              <li key={ch.id}>
                <div
                  className={cn(
                    "group flex cursor-pointer items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors",
                    selectedId === ch.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary",
                  )}
                  onClick={() => onSelect(ch.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onDelete(ch);
                  }}
                >
                  <span className="flex min-w-0 items-center gap-1.5" title={ch.name}>
                    <span className="truncate">{ch.name}</span>
                    {ch.active && (
                      <BookmarkIcon className="size-3.5 shrink-0" aria-label="当前应用" />
                    )}
                  </span>
                  <button
                    type="button"
                    aria-label={`删除 ${ch.name}`}
                    className="ml-2 hidden shrink-0 text-ink-mute hover:text-destructive group-hover:block"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(ch);
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
