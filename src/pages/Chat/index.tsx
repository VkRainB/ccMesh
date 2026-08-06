import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquarePlusIcon,
  PencilIcon,
  Trash2Icon,
  SquareIcon,
  ArrowUpIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useEndpoints } from "@/hooks/useEndpoints";
import { advertisedModels } from "@/services/modules/endpoint";
import {
  chatApi,
  type BranchMessage,
  type ChatTopic,
} from "@/services/modules/chat";
import { useLayoutStore } from "@/stores";

import { MessageBubble } from "./_components/MessageBubble";
import {
  ModelSelector,
  modelKey,
  parseModelKey,
} from "./_components/ModelSelector";

function TopicList({
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
    <aside className="flex w-56 shrink-0 flex-col border-r border-edge bg-surface-raised">
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-3">
        <span className="text-xs font-medium tracking-wide text-ink-secondary uppercase">
          会话
        </span>
        <Button variant="ghost" size="icon-xs" onClick={onNew} title="新建对话">
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
                    onClick={() => beginRename(t)}
                  >
                    <PencilIcon className="size-3.5 text-ink-mute" />
                  </button>
                  <button
                    type="button"
                    className="opacity-0 group-hover:opacity-100"
                    title="删除"
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

export function Chat() {
  const qc = useQueryClient();
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const { data: endpoints = [] } = useEndpoints();

  const modelOptions = useMemo(() => {
    const enabled = endpoints.filter((e) => e.enabled && !e.archived);
    return enabled
      .map((ep) => ({
        ep,
        models: advertisedModels(ep),
      }))
      .filter((x) => x.models.length > 0);
  }, [endpoints]);

  const [selectedKey, setSelectedKey] = useState<string>("");
  useEffect(() => {
    if (selectedKey) return;
    const first = modelOptions[0];
    if (first) setSelectedKey(modelKey(first.ep.id, first.models[0]));
  }, [modelOptions, selectedKey]);

  const topicsQuery = useQuery({
    queryKey: ["chat-topics"],
    queryFn: chatApi.listTopics,
  });
  const topics = topicsQuery.data ?? [];

  const [activeId, setActiveId] = useState<string | null>(null);
  useEffect(() => {
    if (!topicsQuery.isSuccess) return;
    if (activeId && topics.some((topic) => topic.id === activeId)) return;

    const nextActiveId = topics[0]?.id ?? null;
    if (activeId !== nextActiveId) setActiveId(nextActiveId);
  }, [topics, topicsQuery.isSuccess, activeId]);

  const activeTopic = topics.find((t) => t.id === activeId) ?? null;

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", activeId],
    queryFn: () => chatApi.listMessages(activeId!),
    enabled: !!activeId,
  });
  const [localMessages, setLocalMessages] = useState<BranchMessage[]>([]);
  useEffect(() => {
    setLocalMessages(messagesQuery.data ?? []);
  }, [messagesQuery.data, activeId]);

  const [draft, setDraft] = useState("");
  /** 正在生成的会话 id 集合（后端按 topic 并行，前端须隔离）。 */
  const [streamingTopicIds, setStreamingTopicIds] = useState<Set<string>>(
    () => new Set(),
  );
  const streamingTopicIdsRef = useRef(streamingTopicIds);
  streamingTopicIdsRef.current = streamingTopicIds;
  const activeIdRef = useRef<string | null>(null);
  activeIdRef.current = activeId;
  const busy = !!activeId && streamingTopicIds.has(activeId);

  const markStreaming = useCallback((topicId: string, on: boolean) => {
    setStreamingTopicIds((prev) => {
      const has = prev.has(topicId);
      if (on === has) return prev;
      const next = new Set(prev);
      if (on) next.add(topicId);
      else next.delete(topicId);
      return next;
    });
  }, []);

  const [deletingTopic, setDeletingTopic] = useState<ChatTopic | null>(null);
  const [deleting, setDeleting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [localMessages]);

  useEffect(() => {
    if (!activeTopic) return;
    setSelectedKey(modelKey(activeTopic.endpointId, activeTopic.model));
  }, [activeTopic?.id, activeTopic?.endpointId, activeTopic?.model]);

  useEffect(() => {
    const unlistens: Array<() => void> = [];
    let cancelled = false;
    const patchActiveTopicMessage = (
      topicId: string,
      messageId: string,
      patch: Partial<BranchMessage>,
    ) => {
      if (activeIdRef.current !== topicId) return;
      setLocalMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, ...patch } : m)),
      );
    };
    const wire = async () => {
      const u1 = await chatApi.onChunk((p) => {
        if (activeIdRef.current !== p.topicId) return;
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.id === p.messageId
              ? { ...m, content: m.content + p.delta, status: "streaming" }
              : m,
          ),
        );
      });
      const u2 = await chatApi.onDone((p) => {
        patchActiveTopicMessage(p.topicId, p.messageId, {
          content: p.content,
          status: "success",
        });
        markStreaming(p.topicId, false);
        void qc.invalidateQueries({ queryKey: ["chat-topics"] });
        void qc.invalidateQueries({ queryKey: ["chat-messages", p.topicId] });
      });
      const u3 = await chatApi.onError((p) => {
        const cancelledByUser = p.error.includes("已取消");
        if (cancelledByUser) {
          patchActiveTopicMessage(p.topicId, p.messageId, { status: "success" });
        } else {
          patchActiveTopicMessage(p.topicId, p.messageId, {
            content: p.error,
            status: "error",
          });
          toast.error(p.error || "生成失败");
        }
        markStreaming(p.topicId, false);
        void qc.invalidateQueries({ queryKey: ["chat-topics"] });
        void qc.invalidateQueries({ queryKey: ["chat-messages", p.topicId] });
      });
      if (cancelled) {
        u1();
        u2();
        u3();
      } else {
        unlistens.push(u1, u2, u3);
      }
    };
    void wire();
    return () => {
      cancelled = true;
      unlistens.forEach((u) => u());
    };
  }, [qc, markStreaming]);

  const ensureTopic = useCallback(async (): Promise<string | null> => {
    const parsed = parseModelKey(selectedKey);
    if (!parsed) {
      toast.error("请先选择模型");
      return null;
    }
    const stillAvailable = modelOptions.some(
      (g) =>
        g.ep.id === parsed.endpointId && g.models.includes(parsed.model),
    );
    if (!stillAvailable) {
      toast.error("当前模型已不可用，请重新选择");
      return null;
    }
    if (activeId) {
      const t = topics.find((x) => x.id === activeId);
      if (
        t &&
        (t.endpointId !== parsed.endpointId || t.model !== parsed.model)
      ) {
        await chatApi.updateTopic(activeId, {
          endpointId: parsed.endpointId,
          model: parsed.model,
        });
        await qc.invalidateQueries({ queryKey: ["chat-topics"] });
      }
      return activeId;
    }
    const created = await chatApi.createTopic({
      endpointId: parsed.endpointId,
      model: parsed.model,
    });
    await qc.invalidateQueries({ queryKey: ["chat-topics"] });
    setActiveId(created.id);
    return created.id;
  }, [activeId, selectedKey, topics, modelOptions, qc]);

  const handleNew = async () => {
    const parsed = parseModelKey(selectedKey);
    if (!parsed) {
      toast.error("请先选择模型（需先在端点管理配置并点亮模型）");
      return;
    }
    try {
      const created = await chatApi.createTopic({
        endpointId: parsed.endpointId,
        model: parsed.model,
      });
      await qc.invalidateQueries({ queryKey: ["chat-topics"] });
      setActiveId(created.id);
      setLocalMessages([]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    }
  };

  const handleRename = async (topic: ChatTopic, title: string) => {
    try {
      await chatApi.updateTopic(topic.id, { title });
      await qc.invalidateQueries({ queryKey: ["chat-topics"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "重命名失败");
    }
  };

  const handleConfirmDelete = async () => {
    if (!deletingTopic) return;
    const topicToDelete = deletingTopic;
    const nextActiveId =
      topics.find((topic) => topic.id !== topicToDelete.id)?.id ?? null;
    setDeleting(true);
    try {
      await chatApi.deleteTopic(topicToDelete.id);
      if (activeId === topicToDelete.id) {
        setActiveId(nextActiveId);
        setLocalMessages([]);
      }
      await qc.invalidateQueries({ queryKey: ["chat-topics"] });
      setDeletingTopic(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || busy) return;
    if (modelOptions.length === 0) {
      toast.error("没有可用模型，请先在端点管理配置");
      return;
    }
    try {
      const topicId = await ensureTopic();
      if (!topicId) return;
      if (streamingTopicIdsRef.current.has(topicId)) {
        toast.error("该会话正在生成中，请稍候");
        return;
      }
      markStreaming(topicId, true);
      setDraft("");
      try {
        const res = await chatApi.send(topicId, text);
        const msgs = await chatApi.listMessages(topicId);
        if (activeIdRef.current === topicId) {
          setLocalMessages(msgs);
          // 若列表尚未含 pending（竞态），本地补一条
          if (!msgs.some((m) => m.id === res.assistantMessageId)) {
            setLocalMessages((prev) => [
              ...prev,
              {
                id: res.assistantMessageId,
                topicId,
                parentId: res.userMessageId,
                role: "assistant",
                content: "",
                status: "pending",
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                siblingIndex: 0,
                siblingCount: 1,
                siblingIds: [res.assistantMessageId],
              },
            ]);
          }
        }
      } catch (e) {
        markStreaming(topicId, false);
        toast.error(e instanceof Error ? e.message : "发送失败");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "发送失败");
    }
  };

  const handleRegenerate = async (m: BranchMessage) => {
    if (!activeId || busy) return;
    const topicId = activeId;
    markStreaming(topicId, true);
    try {
      await chatApi.regenerate(topicId, m.id);
      const msgs = await chatApi.listMessages(topicId);
      if (activeIdRef.current === topicId) setLocalMessages(msgs);
    } catch (e) {
      markStreaming(topicId, false);
      toast.error(e instanceof Error ? e.message : "重生成失败");
    }
  };

  const handleSwitchSibling = async (m: BranchMessage, dir: -1 | 1) => {
    if (!activeId || busy) return;
    const next = m.siblingIds[m.siblingIndex + dir];
    if (!next) return;
    try {
      await chatApi.setActiveNode(activeId, next);
      const msgs = await chatApi.listMessages(activeId);
      setLocalMessages(msgs);
      await qc.invalidateQueries({ queryKey: ["chat-topics"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "切换分支失败");
    }
  };

  const handleAbort = async () => {
    if (!activeId || !streamingTopicIdsRef.current.has(activeId)) return;
    try {
      await chatApi.abort(activeId);
    } catch {
      /* ignore */
    }
  };

  const onModelChange = async (key: string) => {
    const prev = selectedKey;
    setSelectedKey(key);
    const parsed = parseModelKey(key);
    if (!parsed || !activeId) return;
    try {
      await chatApi.updateTopic(activeId, {
        endpointId: parsed.endpointId,
        model: parsed.model,
      });
      await qc.invalidateQueries({ queryKey: ["chat-topics"] });
    } catch (e) {
      setSelectedKey(prev);
      toast.error(e instanceof Error ? e.message : "更新模型失败");
    }
  };

  return (
    <div className="flex h-full min-h-0 bg-background">
      <TopicList
        topics={topics}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => void handleNew()}
        onRename={handleRename}
        onDelete={setDeletingTopic}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-edge px-5 py-3">
          <h1 className="text-2xl font-light tracking-tight">对话</h1>
          <div className="flex items-center gap-2">
            {modelOptions.length === 0 ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setActiveView("endpoints")}
              >
                去配置端点
              </Button>
            ) : (
              <ModelSelector
                value={selectedKey}
                onChange={(v) => void onModelChange(v)}
                groups={modelOptions}
                onConfigure={() => setActiveView("endpoints")}
              />
            )}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {localMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-mute">
              <p className="text-sm">选择模型后开始对话</p>
              <p className="text-xs">
                支持重生成与分支切换；长对话会自动压缩早期上下文
              </p>
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-4">
              {localMessages.map((m) => (
                <MessageBubble
                  key={m.id}
                  msg={m}
                  busy={busy}
                  onRegenerate={(msg) => void handleRegenerate(msg)}
                  onSwitchSibling={(msg, dir) =>
                    void handleSwitchSibling(msg, dir)
                  }
                />
              ))}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        <div className="border-t border-edge px-5 py-3">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-edge bg-surface-card p-2">
            <textarea
              className="max-h-40 min-h-[44px] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink-primary outline-none placeholder:text-ink-mute"
              placeholder="输入消息，Enter 发送，Shift+Enter 换行"
              rows={2}
              value={draft}
              disabled={modelOptions.length === 0}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            {busy ? (
              <Button
                variant="outline"
                size="icon"
                onClick={() => void handleAbort()}
                title="停止"
                aria-label="停止生成"
              >
                <SquareIcon className="size-4" />
              </Button>
            ) : (
              <Button
                size="icon"
                disabled={!draft.trim() || modelOptions.length === 0}
                onClick={() => void handleSend()}
                title="发送"
              >
                <ArrowUpIcon className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <Dialog
        open={!!deletingTopic}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeletingTopic(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              确定删除「{deletingTopic?.title || "新对话"}」吗？该会话下的消息会一并删除，且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeletingTopic(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => void handleConfirmDelete()}
            >
              {deleting ? "删除中..." : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
