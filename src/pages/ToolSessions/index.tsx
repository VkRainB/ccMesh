import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ListIcon,
  ListTreeIcon,
  RefreshCwIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { ClaudeCode, Codex, OpenCode } from "@lobehub/icons";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCache } from "@/hooks/useCache";
import { cn } from "@/lib/utils";
import {
  toolSessionsApi,
  type ToolSessionMeta,
} from "@/services/modules/toolSessions";
import { useLayoutStore } from "@/stores";

import { ClaudeTranscript } from "./_components/ClaudeMessageItem";
import { ProviderLogo, SessionItem } from "./_components/SessionItem";
import {
  codexDisplayContent,
  extractCodexPromptPreview,
  formatSessionMessagePreview,
  formatSessionTitle,
  formatTimestamp,
  getBaseName,
  getProviderLabel,
  getSessionKey,
  groupSessionsByProviderAndDirectory,
  matchesSessionSearch,
  shouldHideCodexMessageFromToc,
  sliceTailMessages,
  INITIAL_VISIBLE_MESSAGES,
  type SessionProviderGroup,
} from "./_components/utils";

const LIST_VIEW_KEY = "ccmesh.toolSessions.listViewMode";
const GROUP_EXPANSION_KEY = "ccmesh.toolSessions.groupExpansionState";

type ProviderFilter = "all" | "claude" | "codex" | "opencode" | "pi" | "omp";
type ListViewMode = "flat" | "grouped";
interface GroupExpansion { expandedProviderIds: string[] }

const DEFAULT_LIST_VIEW: ListViewMode = "grouped";
const DEFAULT_GROUP_EXPANSION: GroupExpansion = {
  expandedProviderIds: ["claude", "codex", "opencode", "pi", "omp"],
};

/** 旧版把 flat/grouped 当纯文本写入；useCache 只读 JSON。 */
function upgradeListViewMode() {
  try {
    const raw = localStorage.getItem(LIST_VIEW_KEY);
    if (raw === "flat" || raw === "grouped") {
      localStorage.setItem(LIST_VIEW_KEY, JSON.stringify(raw));
    }
  } catch {
    // 存储不可用时交给 useCache 降级。
  }
}

function parseListViewMode(value: unknown): ListViewMode {
  return value === "flat" || value === "grouped" ? value : DEFAULT_LIST_VIEW;
}

function parseGroupExpansion(value: unknown): GroupExpansion {
  if (typeof value !== "object" || value === null) return DEFAULT_GROUP_EXPANSION;
  const ids = (value as { expandedProviderIds?: unknown }).expandedProviderIds;
  if (!Array.isArray(ids)) return DEFAULT_GROUP_EXPANSION;
  return { expandedProviderIds: ids.filter((id): id is string => typeof id === "string") };
}

function ProviderIcon({ providerId, size = 22 }: { providerId: string; size?: number }) {
  if (providerId === "claude") return <ClaudeCode.Color size={size} />;
  if (providerId === "codex") return <Codex.Color size={size} />;
  if (providerId === "opencode") return <OpenCode size={size} />;
  if (providerId === "pi" || providerId === "omp") {
    return <ProviderLogo providerId={providerId} size={size} />;
  }
  return null;
}

async function copyText(text: string, ok = "已复制") {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(ok);
  } catch {
    toast.error("复制失败");
  }
}

export function ToolSessions() {
  upgradeListViewMode();
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const qc = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: ["tool-sessions"],
    queryFn: toolSessionsApi.list,
  });
  const sessions = sessionsQuery.data ?? [];

  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [listViewMode, setListViewMode] = useCache(LIST_VIEW_KEY, {
    defaultValue: DEFAULT_LIST_VIEW,
    parse: parseListViewMode,
  });
  const [groupExpansion, setGroupExpansion] = useCache(GROUP_EXPANSION_KEY, {
    defaultValue: DEFAULT_GROUP_EXPANSION,
    parse: parseGroupExpansion,
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<ToolSessionMeta[] | null>(
    null,
  );
  const [tocHover, setTocHover] = useState<{
    index: number;
    preview: string;
    top: number;
    left: number;
  } | null>(null);
  const [currentTocIndex, setCurrentTocIndex] = useState<number | null>(null);
  const messageScrollRef = useRef<HTMLDivElement>(null);
  const [messageWindow, setMessageWindow] = useState(INITIAL_VISIBLE_MESSAGES);
  const pendingScrollIndex = useRef<number | null>(null);
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (providerFilter !== "all" && s.providerId !== providerFilter) {
        return false;
      }
      return matchesSessionSearch(s, search);
    });
  }, [sessions, providerFilter, search]);

  const providerGroups = useMemo(
    () => groupSessionsByProviderAndDirectory(filteredSessions, "未知项目"),
    [filteredSessions],
  );

  const activeSession = useMemo(() => {
    if (!activeKey) return null;
    return filteredSessions.find((s) => getSessionKey(s) === activeKey) ?? null;
  }, [activeKey, filteredSessions]);

  useEffect(() => {
    if (activeKey && !activeSession && filteredSessions[0]) {
      setActiveKey(getSessionKey(filteredSessions[0]));
    } else if (!activeKey && filteredSessions[0]) {
      setActiveKey(getSessionKey(filteredSessions[0]));
    }
  }, [activeKey, activeSession, filteredSessions]);

  const messagesQuery = useQuery({
    queryKey: [
      "tool-session-messages",
      activeSession?.providerId,
      activeSession?.sourcePath,
    ],
    queryFn: () =>
      toolSessionsApi.getMessages(
        activeSession!.providerId,
        activeSession!.sourcePath!,
      ),
    enabled: !!activeSession?.providerId && !!activeSession?.sourcePath,
  });
  const messages = messagesQuery.data ?? [];
  const { items: visibleMessages, hiddenBefore } = useMemo(
    () => sliceTailMessages(messages, messageWindow),
    [messages, messageWindow],
  );

  useEffect(() => {
    setMessageWindow(INITIAL_VISIBLE_MESSAGES);
    setCurrentTocIndex(null);
    setTocHover(null);
  }, [activeKey]);

  useEffect(() => {
    const index = pendingScrollIndex.current;
    if (index == null || hiddenBefore > index) return;
    pendingScrollIndex.current = null;
    requestAnimationFrame(() => {
      messageRefs.current.get(index)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }, [hiddenBefore, visibleMessages.length]);

  const tocEntries = useMemo(() => {
    return messages
      .map((m, index) => ({ m, index }))
      .filter(({ m }) => m.role.toLowerCase() === "user")
      .filter(
        ({ m }) =>
          !(
            activeSession?.providerId === "codex" &&
            shouldHideCodexMessageFromToc(m.content)
          ),
      )
      .map(({ m, index }) => {
        const text =
          activeSession?.providerId === "codex"
            ? extractCodexPromptPreview(m.content)
            : m.content;
        return {
          index,
          preview: formatSessionMessagePreview(text),
          weight: text.trim().length,
        };
      });
  }, [messages, activeSession?.providerId]);

  const deleteMutation = useMutation({
    mutationFn: async (targets: ToolSessionMeta[]) => {
      const items = targets
        .filter((t) => t.sourcePath)
        .map((t) => ({
          providerId: t.providerId,
          sessionId: t.sessionId,
          sourcePath: t.sourcePath!,
        }));
      if (items.length === 1) {
        await toolSessionsApi.delete(items[0]);
        return [{ ...items[0], success: true }];
      }
      return toolSessionsApi.deleteMany(items);
    },
    onSuccess: (outcomes) => {
      const ok = outcomes.filter((o) => o.success).length;
      const fail = outcomes.length - ok;
      if (ok) toast.success(`已删除 ${ok} 个会话`);
      if (fail) toast.error(`${fail} 个会话删除失败`);
      setDeleteTargets(null);
      setSelectedKeys(new Set());
      setSelectionMode(false);
      void qc.invalidateQueries({ queryKey: ["tool-sessions"] });
    },
    onError: (e: Error) => toast.error(e.message || "删除失败"),
  });

  const deletableFiltered = filteredSessions.filter((s) => !!s.sourcePath);
  const selectedSessions = deletableFiltered.filter((s) =>
    selectedKeys.has(getSessionKey(s)),
  );

  const toggleProvider = (id: string) => {
    setGroupExpansion((prev) => ({
      expandedProviderIds: prev.expandedProviderIds.includes(id)
        ? prev.expandedProviderIds.filter((item) => item !== id)
        : [...prev.expandedProviderIds, id],
    }));
  };

  const toggleChecked = useCallback((sessionKey: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sessionKey);
      else next.delete(sessionKey);
      return next;
    });
  }, []);

  const toggleGroupChecked = (
    groupSessions: ToolSessionMeta[],
    checked: boolean,
  ) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const s of groupSessions) {
        if (!s.sourcePath) continue;
        const key = getSessionKey(s);
        if (checked) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const syncCurrentToc = useCallback(() => {
    const root = messageScrollRef.current;
    if (!root || tocEntries.length === 0) return;
    const edge = root.getBoundingClientRect().top + 8;
    let current = tocEntries[0].index;
    for (const entry of tocEntries) {
      const el = messageRefs.current.get(entry.index);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= edge) current = entry.index;
    }
    setCurrentTocIndex((prev) => (prev === current ? prev : current));
  }, [tocEntries]);

  useEffect(() => {
    const id = requestAnimationFrame(() => syncCurrentToc());
    return () => cancelAnimationFrame(id);
  }, [syncCurrentToc, visibleMessages.length]);

  const scrollToMessage = (index: number) => {
    setCurrentTocIndex(index);
    if (index < hiddenBefore) {
      pendingScrollIndex.current = index;
      startTransition(() => setMessageWindow(messages.length));
      return;
    }
    requestAnimationFrame(() => {
      messageRefs.current.get(index)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const renderSessionList = (items: ToolSessionMeta[]) =>
    items.map((session) => {
      const key = getSessionKey(session);
      return (
        <SessionItem
          key={key}
          session={session}
          isSelected={activeKey === key}
          selectionMode={selectionMode}
          isChecked={selectedKeys.has(key)}
          searchQuery={search}
          onSelect={setActiveKey}
          onToggleChecked={toggleChecked}
        />
      );
    });

  const renderGrouped = (groups: SessionProviderGroup[]) =>
    groups.map((group) => {
      const expanded = groupExpansion.expandedProviderIds.includes(group.providerId);
      const selectedCount = group.sessions.filter((s) =>
        selectedKeys.has(getSessionKey(s)),
      ).length;
      const selectable = group.sessions.filter((s) => s.sourcePath).length;
      const allSelected = selectable > 0 && selectedCount === selectable;
      return (
        <div key={group.providerId} className="space-y-1">
          <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
            {selectionMode ? (
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={allSelected}
                ref={(el) => {
                  if (el) {
                    el.indeterminate =
                      selectedCount > 0 && selectedCount < selectable;
                  }
                }}
                disabled={selectable === 0}
                onChange={() =>
                  toggleGroupChecked(group.sessions, !allSelected)
                }
              />
            ) : null}
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
              onClick={() => toggleProvider(group.providerId)}
            >
              {expanded ? (
                <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
              )}
              <ProviderIcon providerId={group.providerId} size={18} />
              <span className="truncate text-sm font-medium">
                {getProviderLabel(group.providerId)}
              </span>
              <Badge variant="secondary" className="ml-auto text-xs">
                {selectionMode ? `${selectedCount}/${selectable}` : group.sessions.length}
              </Badge>
            </button>
          </div>
          {expanded ? (
            <div className="space-y-1 pl-2">{renderSessionList(group.sessions)}</div>
          ) : null}
        </div>
      );
    });

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex items-center gap-3 border-b border-edge px-5 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-full"
            onClick={() => setActiveView("chat")}
            title="返回对话"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <h1 className="text-2xl font-light tracking-tight">会话管理</h1>
          <span className="text-xs text-ink-mute">
            本机 Claude / Codex / OpenCode / pi / omp 工具会话
          </span>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 p-4 md:grid-cols-[320px_1fr]">
          <Card className="flex min-h-0 flex-col overflow-hidden">
            <CardHeader className="border-b px-3 py-2">
              {searchOpen ? (
                <div className="relative">
                  <SearchIcon className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    ref={searchRef}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索会话…"
                    className="h-8 pr-8 pl-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSearchOpen(false);
                        setSearch("");
                      }
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute top-1/2 right-1 size-6 -translate-y-1/2"
                    onClick={() => {
                      setSearchOpen(false);
                      setSearch("");
                    }}
                  >
                    <XIcon className="size-3" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <CardTitle className="text-sm font-medium whitespace-nowrap">
                      会话列表
                    </CardTitle>
                    <Badge variant="secondary" className="text-xs">
                      {filteredSessions.length}
                    </Badge>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant={selectionMode ? "secondary" : "ghost"}
                          size="icon"
                          className="size-7"
                          onClick={() => {
                            if (selectionMode) {
                              setSelectionMode(false);
                              setSelectedKeys(new Set());
                            } else {
                              setSelectionMode(true);
                            }
                          }}
                        >
                          <CheckSquareIcon className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {selectionMode ? "退出批量管理" : "批量管理"}
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={listViewMode === "grouped" ? "分类视图" : "列表视图"}
                          onClick={() =>
                            setListViewMode((m) =>
                              m === "grouped" ? "flat" : "grouped",
                            )
                          }
                        >
                          {listViewMode === "grouped" ? (
                            <ListTreeIcon className="size-3.5" />
                          ) : (
                            <ListIcon className="size-3.5" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {listViewMode === "grouped" ? "分类视图" : "列表视图"}
                      </TooltipContent>
                    </Tooltip>
                    {selectionMode ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-destructive"
                            disabled={selectedSessions.length === 0}
                            onClick={() => setDeleteTargets(selectedSessions)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>批量删除</TooltipContent>
                      </Tooltip>
                    ) : null}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => setSearchOpen(true)}
                        >
                          <SearchIcon className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>搜索</TooltipContent>
                    </Tooltip>
                    <Select
                      value={providerFilter}
                      onValueChange={(v) =>
                        setProviderFilter(v as ProviderFilter)
                      }
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SelectTrigger className="h-7 w-auto gap-1 border-0 bg-transparent px-1.5 text-xs shadow-none">
                            <SelectValue />
                          </SelectTrigger>
                        </TooltipTrigger>
                        <TooltipContent>供应商筛选</TooltipContent>
                      </Tooltip>
                      <SelectContent>
                        <SelectItem value="all">全部</SelectItem>
                        <SelectItem value="claude">Claude</SelectItem>
                        <SelectItem value="codex">Codex</SelectItem>
                        <SelectItem value="opencode">OpenCode</SelectItem>
                        <SelectItem value="pi">pi</SelectItem>
                        <SelectItem value="omp">omp</SelectItem>
                      </SelectContent>
                    </Select>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={sessionsQuery.isFetching}
                          onClick={() => void sessionsQuery.refetch()}
                        >
                          <RefreshCwIcon
                            className={cn(
                              "size-3.5",
                              sessionsQuery.isFetching && "animate-spin",
                            )}
                          />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>刷新</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
              {sessionsQuery.isLoading ? (
                <p className="p-3 text-sm text-muted-foreground">加载中…</p>
              ) : sessionsQuery.isError ? (
                <p className="p-3 text-sm text-destructive">
                  {(sessionsQuery.error as Error).message || "加载失败"}
                </p>
              ) : filteredSessions.length === 0 ? (
                <p className="p-3 text-sm text-muted-foreground">
                  未找到工具会话。请确认本机已有 Claude Code / Codex / OpenCode / pi / omp 历史。
                </p>
              ) : listViewMode === "grouped" ? (
                renderGrouped(providerGroups)
              ) : (
                renderSessionList(filteredSessions)
              )}
            </CardContent>
          </Card>

          <Card className="relative flex min-h-0 flex-col overflow-hidden">
            {!activeSession ? (
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                选择左侧会话查看详情
              </div>
            ) : (
              <>
                <CardHeader className="gap-1 border-b px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <ProviderIcon providerId={activeSession.providerId} size={16} />
                    <h2
                      className="min-w-0 flex-1 truncate text-sm font-medium"
                      title={formatSessionTitle(activeSession)}
                    >
                      {formatSessionTitle(activeSession)}
                    </h2>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {messages.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-destructive hover:text-destructive"
                      aria-label="删除会话"
                      onClick={() => setDeleteTargets([activeSession])}
                    >
                      <Trash2Icon className="size-3.5" />
                    </Button>
                  </div>
                  <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="shrink-0">
                      {formatTimestamp(
                        activeSession.lastActiveAt || activeSession.createdAt,
                      )}
                    </span>
                    {activeSession.projectDir ? (
                      <button
                        type="button"
                        className="min-w-0 truncate hover:text-foreground"
                        title={activeSession.projectDir}
                        onClick={() =>
                          void copyText(activeSession.projectDir!, "已复制路径")
                        }
                      >
                        {getBaseName(activeSession.projectDir) ||
                          activeSession.projectDir}
                      </button>
                    ) : null}
                    {messagesQuery.isFetching ? <span>加载中…</span> : null}
                    {activeSession.resumeCommand ? (
                      <button
                        type="button"
                        className="ml-auto shrink-0 hover:text-foreground"
                        onClick={() =>
                          void copyText(
                            activeSession.resumeCommand!,
                            "已复制恢复命令",
                          )
                        }
                      >
                        复制恢复命令
                      </button>
                    ) : null}
                  </div>
                </CardHeader>

                <div className="flex min-h-0 flex-1">
                {tocEntries.length > 0 ? (
                  <div
                    className="flex h-full w-8 shrink-0 flex-col overflow-y-auto py-2 pl-1.5"
                    onMouseLeave={() => setTocHover(null)}
                  >
                    {(() => {
                      const hoverAt = tocHover
                        ? tocEntries.findIndex((item) => item.index === tocHover.index)
                        : -1;
                      return (
                      <div key="valley" className="my-auto flex w-full flex-col gap-0.5">
                      {tocEntries.map((entry, i) => {
                      const dist = hoverAt < 0 ? -1 : Math.abs(i - hoverAt);
                      const dark =
                        dist === 0 || (hoverAt < 0 && entry.index === currentTocIndex);
                      const extra = dist === 0 ? 42 : dist === 1 ? 22 : dist === 2 ? 10 : 0;
                      const width = Math.min(100, 46 + extra);
                      return (
                        <button
                          key={entry.index}
                          type="button"
                          aria-label={entry.preview}
                          aria-current={entry.index === currentTocIndex || undefined}
                          className="flex h-2 w-full shrink-0 items-center"
                          onClick={() => scrollToMessage(entry.index)}
                          onMouseEnter={(e) => {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setTocHover({
                              index: entry.index,
                              preview: entry.preview,
                              top: rect.top + rect.height / 2,
                              left: rect.right + 8,
                            });
                          }}
                        >
                          <span
                            className={cn(
                              "h-[3px] rounded-full transition-[width]",
                              dark ? "bg-foreground" : "bg-foreground/25",
                            )}
                            style={{ width: `${width}%` }}
                          />
                        </button>
                      );
                      })}
                      </div>
                      );
                    })()}
                  </div>
                ) : null}
                <CardContent
                  ref={messageScrollRef}
                  onScroll={syncCurrentToc}
                  className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2"
                >
                  {messagesQuery.isError ? (
                    <p className="text-sm text-destructive">
                      {(messagesQuery.error as Error).message || "加载消息失败"}
                    </p>
                  ) : messages.length === 0 && !messagesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">暂无对话记录</p>
                  ) : (
                    <>
                      {hiddenBefore > 0 ? (
                        <button
                          type="button"
                          className="w-full rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                          onClick={() =>
                            startTransition(() =>
                              setMessageWindow(messages.length),
                            )
                          }
                        >
                          加载更早的 {hiddenBefore} 条消息
                        </button>
                      ) : null}
                      <ClaudeTranscript
                        speaker={getProviderLabel(activeSession.providerId)}
                        items={visibleMessages.map((message, offset) => ({
                          index: hiddenBefore + offset,
                          role: message.role,
                          content:
                            activeSession.providerId === "codex"
                              ? codexDisplayContent(message.content)
                              : message.content,
                          ts: message.ts,
                        }))}
                        searchQuery={search}
                        registerRef={(index, el) => {
                          if (el) messageRefs.current.set(index, el);
                          else messageRefs.current.delete(index);
                        }}
                      />
                    </>
                  )}
                </CardContent>
                </div>
                {tocHover ? (
                  <div
                    className="pointer-events-none fixed z-50 max-w-xs -translate-y-1/2 rounded-md border border-edge bg-card px-2.5 py-1.5 text-xs leading-5 text-foreground shadow-level-2"
                    style={{ top: tocHover.top, left: tocHover.left }}
                  >
                    {tocHover.preview}
                  </div>
                ) : null}
              </>
            )}
          </Card>
        </div>
      </div>

      <Dialog
        open={!!deleteTargets}
        onOpenChange={(open) => {
          if (!open && !deleteMutation.isPending) setDeleteTargets(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {deleteTargets && deleteTargets.length > 1
                ? `删除 ${deleteTargets.length} 个会话`
                : "删除会话"}
            </DialogTitle>
            <DialogDescription>
              将删除本机会话数据，不可恢复。与应用内对话无关。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleteMutation.isPending}
              onClick={() => setDeleteTargets(null)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMutation.isPending || !deleteTargets?.length}
              onClick={() => {
                if (deleteTargets) deleteMutation.mutate(deleteTargets);
              }}
            >
              {deleteMutation.isPending ? "删除中…" : "确认删除"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}
