import { useEffect, useRef, useState } from "react";
import { MessageSquarePlusIcon, PencilIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ChatTopic } from "@/services/modules/chat";

export function TopicList({
  topics,
  activeId,
  onSelect,
  onNew,
  onRename,
  onDelete,
}: {
  topics: ChatTopic[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (topic: ChatTopic, title: string) => Promise<void>;
  onDelete: (t: ChatTopic) => void;
}) {
  const [editingTopicId, setEditingTopicId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const editingInputRef = useRef<HTMLInputElement>(null);
  const savingRenameRef = useRef(false);
  const ignoreRenameBlurRef = useRef(false);

  useEffect(() => {
    editingInputRef.current?.focus();
    editingInputRef.current?.select();
  }, [editingTopicId]);

  const beginRename = (topic: ChatTopic) => {
    setEditingTopicId(topic.id);
    setEditingTitle(topic.title || "新对话");
  };

  const cancelRename = () => {
    setEditingTopicId(null);
    setEditingTitle("");
  };

  const commitRename = async (topic: ChatTopic) => {
    if (savingRenameRef.current) return;
    const nextTitle = editingTitle.trim();
    const currentTitle = topic.title || "新对话";
    if (!nextTitle || nextTitle === currentTitle) {
      cancelRename();
      return;
    }
    savingRenameRef.current = true;
    cancelRename();
    try {
      await onRename(topic, nextTitle);
    } finally {
      savingRenameRef.current = false;
    }
  };

  return (
    <aside className="flex h-full w-full flex-col border-r border-edge bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-3">
        <span className="text-xs font-medium tracking-wide text-ink-secondary uppercase">
          会话
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onNew}
          title="新建对话"
          aria-label="新建对话"
        >
          <MessageSquarePlusIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {topics.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-ink-mute">暂无会话</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {topics.map((t) => (
              <li key={t.id}>
                <div
                  className={cn(
                    "group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm",
                    activeId === t.id
                      ? "bg-primary/12 text-ink-primary"
                      : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary",
                  )}
                >
                  {editingTopicId === t.id ? (
                    <Input
                      ref={editingInputRef}
                      className="h-7 min-w-0 flex-1 rounded px-2 text-sm"
                      value={editingTitle}
                      onChange={(event) => setEditingTitle(event.target.value)}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={() => {
                        if (ignoreRenameBlurRef.current) {
                          ignoreRenameBlurRef.current = false;
                          return;
                        }
                        void commitRename(t);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void commitRename(t);
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          ignoreRenameBlurRef.current = true;
                          cancelRename();
                        }
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      onClick={() => onSelect(t.id)}
                    >
                      {t.title || "新对话"}
                    </button>
                  )}
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100"
                    title="重命名"
                    aria-label="重命名"
                    onClick={() => beginRename(t)}
                  >
                    <PencilIcon className="size-3.5 text-ink-mute" />
                  </button>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100"
                    title="删除"
                    aria-label="删除"
                    onClick={() => onDelete(t)}
                  >
                    <Trash2Icon className="size-3.5 text-ink-mute" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
