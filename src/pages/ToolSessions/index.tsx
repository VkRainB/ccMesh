import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  FolderOpenIcon,
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
import { cn } from "@/lib/utils";
import {
  toolSessionsApi,
  type ToolSessionMeta,
} from "@/services/modules/toolSessions";
import { useLayoutStore } from "@/stores";

import { SessionItem } from "./_components/SessionItem";
import { SessionMessageItem } from "./_components/SessionMessageItem";
import {
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
  type SessionProviderGroup,
} from "./_components/utils";

const LIST_VIEW_KEY = "ccmesh.toolSessions.listViewMode";
const GROUP_EXPANSION_KEY = "ccmesh.toolSessions.groupExpansionState";

type ProviderFilter = "all" | "claude" | "codex" | "opencode";
type ListViewMode = "flat" | "grouped";

function readListViewMode(): ListViewMode {
  if (typeof window === "undefined") return "grouped";
  const stored = window.localStorage.getItem(LIST_VIEW_KEY);
  return stored === "flat" || stored === "grouped" ? stored : "grouped";
}

function readExpandedProviders(): Set<string> {
  if (typeof window === "undefined") return new Set(["claude", "codex", "opencode"]);
  try {
    const raw = window.localStorage.getItem(GROUP_EXPANSION_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    const ids = Array.isArray(parsed?.expandedProviderIds)
      ? parsed.expandedProviderIds.filter((x: unknown) => typeof x === "string")
      : ["claude", "codex", "opencode"];
    return new Set(ids);
  } catch {
    return new Set(["claude", "codex", "opencode"]);
  }
}

function ProviderIcon({ providerId, size = 22 }: { providerId: string; size?: number }) {
  if (providerId === "claude") return <ClaudeCode.Color size={size} />;
  if (providerId === "codex") return <Codex.Color size={size} />;
  if (providerId === "opencode") return <OpenCode size={size} />;
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
  const setActiveView = useLayoutStore((s) => s.setActiveView);
  const qc = useQueryClient();

  const sessionsQuery = useQuery({
    queryKey: ["tool-sessions"],
    queryFn: toolSessionsApi.list,
  });
  const sessions = sessionsQuery.data ?? [];

  const [providerFilter, setProviderFilter] = useState<ProviderFilter>("all");
  const [listViewMode, setListViewMode] = useState<ListViewMode>(readListViewMode);
  const [expandedProviders, setExpandedProviders] = useState<Set<string>>(
    readExpandedProviders,
  );
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [deleteTargets, setDeleteTargets] = useState<ToolSessionMeta[] | null>(
    null,
  );
  const [tocOpen, setTocOpen] = useState(false);
  const [activeMessageIndex, setActiveMessageIndex] = useState<number | null>(
    null,
  );
  const messageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    window.localStorage.setItem(LIST_VIEW_KEY, listViewMode);
  }, [listViewMode]);

  useEffect(() => {
    window.localStorage.setItem(
      GROUP_EXPANSION_KEY,
      JSON.stringify({ expandedProviderIds: [...expandedProviders] }),
    );
  }, [expandedProviders]);

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
      .map(({ m, index }) => ({
        index,
        preview: formatSessionMessagePreview(
          activeSession?.providerId === "codex"
            ? extractCodexPromptPreview(m.content)
            : m.content,
        ),
      }));
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
    setExpandedProviders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleChecked = (session: ToolSessionMeta, checked: boolean) => {
    const key = getSessionKey(session);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

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

  const scrollToMessage = (index: number) => {
    setActiveMessageIndex(index);
    setTocOpen(false);
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
          onToggleChecked={(checked) => toggleChecked(session, checked)}
        />
      );
    });

  const renderGrouped = (groups: SessionProviderGroup[]) =>
    groups.map((group) => {
      const expanded = expandedProviders.has(group.providerId);
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
            本机 Claude / Codex / OpenCode 工具会话（与应用内对话无关）
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
                  未找到工具会话。请确认本机已有 Claude Code / Codex / OpenCode 历史。
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
                <CardHeader className="space-y-3 border-b px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <ProviderIcon
                        providerId={activeSession.providerId}
                        size={28}
                      />
                      <h2 className="truncate text-lg font-medium">
                        {formatSessionTitle(activeSession)}
                      </h2>
                    </div>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="shrink-0"
                      onClick={() => setDeleteTargets([activeSession])}
                    >
                      <Trash2Icon className="size-3.5" />
                      删除会话
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>
                      {formatTimestamp(
                        activeSession.lastActiveAt || activeSession.createdAt,
                      )}
                    </span>
                    {activeSession.projectDir ? (
                      <button
                        type="button"
                        className="inline-flex max-w-full items-center gap-1 hover:text-foreground"
                        title={activeSession.projectDir}
                        onClick={() =>
                          void copyText(activeSession.projectDir!, "已复制路径")
                        }
                      >
                        <FolderOpenIcon className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {getBaseName(activeSession.projectDir) ||
                            activeSession.projectDir}
                        </span>
                      </button>
                    ) : null}
                    {activeSession.sourcePath ? (
                      <button
                        type="button"
                        className="inline-flex max-w-[240px] items-center gap-1 hover:text-foreground"
                        title={activeSession.sourcePath}
                        onClick={() =>
                          void copyText(
                            activeSession.sourcePath!,
                            "已复制文件名",
                          )
                        }
                      >
                        <FileTextIcon className="size-3.5 shrink-0" />
                        <span className="truncate">
                          {getBaseName(activeSession.sourcePath)}
                        </span>
                      </button>
                    ) : null}
                  </div>
                  {activeSession.resumeCommand ? (
                    <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 font-mono text-xs">
                      <code className="min-w-0 flex-1 truncate">
                        {activeSession.resumeCommand}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 shrink-0"
                        onClick={() =>
                          void copyText(
                            activeSession.resumeCommand!,
                            "已复制恢复命令",
                          )
                        }
                      >
                        <CopyIcon className="size-3.5" />
                      </Button>
                    </div>
                  ) : null}
                </CardHeader>

                <div className="flex items-center gap-2 border-b px-4 py-2">
                  <h3 className="text-sm font-medium">对话记录</h3>
                  <Badge variant="secondary" className="text-xs">
                    {messages.length}
                  </Badge>
                  {messagesQuery.isFetching ? (
                    <span className="text-xs text-muted-foreground">加载中…</span>
                  ) : null}
                </div>

                <CardContent className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  {messagesQuery.isError ? (
                    <p className="text-sm text-destructive">
                      {(messagesQuery.error as Error).message || "加载消息失败"}
                    </p>
                  ) : messages.length === 0 && !messagesQuery.isLoading ? (
                    <p className="text-sm text-muted-foreground">暂无对话记录</p>
                  ) : (
                    messages.map((message, index) => (
                      <div
                        key={`${index}-${message.ts ?? 0}`}
                        ref={(el) => {
                          if (el) messageRefs.current.set(index, el);
                          else messageRefs.current.delete(index);
                        }}
                      >
                        <SessionMessageItem
                          message={message}
                          isActive={activeMessageIndex === index}
                          searchQuery={search}
                          onCopy={(content) => void copyText(content)}
                        />
                      </div>
                    ))
                  )}
                </CardContent>

                {tocEntries.length > 0 ? (
                  <Button
                    size="icon"
                    className="absolute right-4 bottom-4 size-11 rounded-full shadow-lg"
                    onClick={() => setTocOpen(true)}
                    title="对话目录"
                  >
                    <ListIcon className="size-5" />
                  </Button>
                ) : null}
              </>
            )}
          </Card>
        </div>
      </div>

      <Dialog open={tocOpen} onOpenChange={setTocOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>对话目录</DialogTitle>
            <DialogDescription>跳转到用户消息</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-1 overflow-y-auto">
            {tocEntries.map((entry) => (
              <button
                key={entry.index}
                type="button"
                className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => scrollToMessage(entry.index)}
              >
                {entry.preview}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

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
