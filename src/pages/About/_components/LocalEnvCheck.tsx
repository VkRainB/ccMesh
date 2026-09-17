import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import {
  AlertCircleIcon,
  ArrowUpCircleIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  CopyIcon,
  DownloadIcon,
  Loader2Icon,
  RefreshCwIcon,
  StethoscopeIcon,
} from "lucide-react";
import { ClaudeCode, OpenAI, OpenCode } from "@lobehub/icons";
import { toast } from "sonner";

import piLogoUrl from "@/assets/svg/about/pi-logo.svg";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isUpdateAvailable } from "@/lib/version";
import {
  toolEnvApi,
  type ToolInstallation,
  type ToolInstallationReport,
  type ToolVersion,
} from "@/services/modules/toolEnv";
import { ToolUpgradeConfirmDialog } from "./ToolUpgradeConfirmDialog";
import { ToolInstallRow } from "./ToolInstallRow";

const TOOL_NAMES = ["claude", "codex", "opencode", "pi"] as const;
type ToolName = (typeof TOOL_NAMES)[number];
type ToolLifecycleAction = "install" | "update";

const TOOL_DISPLAY: Record<ToolName, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  pi: "Pi",
};

type ToolIconProps = { size?: number; className?: string };

const TOOL_ICON_BOX =
  "flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-raised";
const TOOL_ICON_INNER = "size-[18px] shrink-0";

const TOOL_LOBE_ICONS: Record<
  Exclude<ToolName, "pi">,
  { Icon: ComponentType<ToolIconProps>; mono?: boolean }
> = {
  claude: { Icon: ClaudeCode.Color },
  codex: { Icon: OpenAI, mono: true },
  opencode: { Icon: OpenCode, mono: true },
};

function ToolCardIcon({ toolName }: { toolName: ToolName }) {
  if (toolName === "pi") {
    return (
      <span className={TOOL_ICON_BOX}>
        <img
          src={piLogoUrl}
          alt=""
          className={cn(TOOL_ICON_INNER, "object-contain dark:invert")}
        />
      </span>
    );
  }

  const { Icon, mono } = TOOL_LOBE_ICONS[toolName];
  return (
    <span className={cn(TOOL_ICON_BOX, mono && "text-ink-primary")}>
      <Icon size={18} className={TOOL_ICON_INNER} />
    </span>
  );
}

const ENV_LABEL: Record<string, string> = {
  windows: "Win",
  wsl: "WSL",
  macos: "macOS",
  linux: "Linux",
};

const MANUAL_INSTALL = `# Claude Code
npm i -g @anthropic-ai/claude-code@latest

# Codex
npm i -g @openai/codex@latest

# OpenCode
npm i -g opencode-ai@latest

# Pi
npm i -g --ignore-scripts @earendil-works/pi-coding-agent@latest`;

const CACHE_TTL_MS = 10 * 60 * 1000;
let toolVersionsCache: { data: ToolVersion[]; at: number } | null = null;

function mergeToolVersions(prev: ToolVersion[], updated: ToolVersion[]): ToolVersion[] {
  if (prev.length === 0) return updated;
  const byName = new Map(updated.map((t) => [t.name, t]));
  const merged = prev.map((t) => byName.get(t.name) ?? t);
  const existing = new Set(prev.map((t) => t.name));
  for (const u of updated) {
    if (!existing.has(u.name)) merged.push(u);
  }
  return merged;
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function LocalEnvCheck() {
  const [toolVersions, setToolVersions] = useState<ToolVersion[]>(
    () => toolVersionsCache?.data ?? [],
  );
  const [isLoadingTools, setIsLoadingTools] = useState(
    () => toolVersionsCache === null,
  );
  const [loadingTools, setLoadingTools] = useState<Record<string, boolean>>({});
  const [toolActions, setToolActions] = useState<
    Partial<Record<ToolName, ToolLifecycleAction>>
  >({});
  const [batchAction, setBatchAction] = useState<ToolLifecycleAction | null>(null);
  const [toolDiagnostics, setToolDiagnostics] = useState<
    Partial<Record<ToolName, ToolInstallation[]>>
  >({});
  const [isDiagnosingAll, setIsDiagnosingAll] = useState(false);
  const [preflightTools, setPreflightTools] = useState<Set<ToolName>>(() => new Set());
  const [pendingUpgrade, setPendingUpgrade] = useState<{
    toolNames: ToolName[];
    plans: ToolInstallationReport[];
  } | null>(null);
  const [showManual, setShowManual] = useState(false);

  const toolVersionByName = useMemo(
    () => new Map(toolVersions.map((t) => [t.name, t])),
    [toolVersions],
  );

  const updatableToolNames = useMemo(
    () =>
      TOOL_NAMES.filter((name) => {
        const tool = toolVersionByName.get(name);
        return isUpdateAvailable(tool?.version, tool?.latest_version);
      }),
    [toolVersionByName],
  );

  const refreshToolVersions = useCallback(async (toolNames: ToolName[]) => {
    if (toolNames.length === 0) return [];
    setLoadingTools((prev) => {
      const next = { ...prev };
      for (const name of toolNames) next[name] = true;
      return next;
    });
    try {
      const updated = await toolEnvApi.getToolVersions([...toolNames]);
      setToolVersions((prev) => mergeToolVersions(prev, updated));
      toolVersionsCache = {
        data: mergeToolVersions(toolVersionsCache?.data ?? [], updated),
        at: toolVersionsCache?.at ?? 0,
      };
      return updated;
    } catch (e) {
      console.error("[LocalEnvCheck] refresh failed", e);
      return [];
    } finally {
      setLoadingTools((prev) => {
        const next = { ...prev };
        for (const name of toolNames) next[name] = false;
        return next;
      });
    }
  }, []);

  const loadAllToolVersions = useCallback(
    async (options?: { force?: boolean }) => {
      const force = options?.force ?? false;
      if (force) {
        setToolDiagnostics({});
      }
      if (
        !force &&
        toolVersionsCache &&
        Date.now() - toolVersionsCache.at < CACHE_TTL_MS
      ) {
        setToolVersions(toolVersionsCache.data);
        setIsLoadingTools(false);
        return;
      }
      setIsLoadingTools(true);
      try {
        await Promise.all(TOOL_NAMES.map((name) => refreshToolVersions([name])));
      } finally {
        if (toolVersionsCache) {
          toolVersionsCache = { ...toolVersionsCache, at: Date.now() };
        }
        setIsLoadingTools(false);
      }
    },
    [refreshToolVersions],
  );

  useEffect(() => {
    void loadAllToolVersions();
  }, [loadAllToolVersions]);

  const diagnoseToolSilently = useCallback(async (toolName: ToolName) => {
    try {
      const [report] = await toolEnvApi.probeToolInstallations([toolName]);
      setToolDiagnostics((prev) => {
        if (report?.is_conflict) return { ...prev, [toolName]: report.installs };
        if (!(toolName in prev)) return prev;
        const next = { ...prev };
        delete next[toolName];
        return next;
      });
    } catch (e) {
      console.error("[LocalEnvCheck] auto diagnose failed", e);
    }
  }, []);

  const handleDiagnoseAll = useCallback(async () => {
    setIsDiagnosingAll(true);
    try {
      const reports = await toolEnvApi.probeToolInstallations([...TOOL_NAMES]);
      const next: Partial<Record<ToolName, ToolInstallation[]>> = {};
      let conflicts = 0;
      for (const report of reports) {
        if (report.is_conflict) {
          next[report.tool as ToolName] = report.installs;
          conflicts += 1;
        }
      }
      setToolDiagnostics(next);
      if (conflicts === 0) toast.info("未发现安装冲突");
    } catch (e) {
      toast.error(`诊断失败：${errMsg(e)}`);
    } finally {
      setIsDiagnosingAll(false);
    }
  }, []);

  const executeRun = useCallback(
    async (toolNames: ToolName[], action: ToolLifecycleAction) => {
      const isBatch = toolNames.length > 1;
      if (isBatch) setBatchAction(action);

      const failures: { toolName: ToolName; detail: string; soft: boolean }[] = [];
      let succeeded = 0;

      for (const toolName of toolNames) {
        setToolActions((prev) => ({ ...prev, [toolName]: action }));
        try {
          const previous = toolVersionByName.get(toolName);
          const previousVersion = previous?.version ?? null;
          await toolEnvApi.runToolLifecycleAction([toolName], action);
          const refreshed = await refreshToolVersions([toolName]);
          const tool = refreshed.find((t) => t.name === toolName);
          if (tool?.version) {
            const latest = tool.latest_version ?? previous?.latest_version;
            if (
              action === "update" &&
              previousVersion &&
              tool.version === previousVersion &&
              isUpdateAvailable(tool.version, latest)
            ) {
              failures.push({
                toolName,
                detail: `版本仍为 ${tool.version}，最新 ${latest ?? "未知"}`,
                soft: true,
              });
              void diagnoseToolSilently(toolName);
            } else {
              succeeded += 1;
              if (action === "update") void diagnoseToolSilently(toolName);
            }
          } else {
            failures.push({
              toolName,
              detail: tool?.error?.trim() || "已安装但无法运行",
              soft: true,
            });
            void diagnoseToolSilently(toolName);
          }
        } catch (e) {
          failures.push({ toolName, detail: errMsg(e), soft: false });
        } finally {
          setToolActions((prev) => {
            const next = { ...prev };
            delete next[toolName];
            return next;
          });
        }
      }

      if (isBatch) setBatchAction(null);

      const label = action === "install" ? "安装" : "升级";
      if (failures.length === 0) {
        toast.success(`${label}完成（${succeeded} 个工具）`);
        return;
      }
      if (succeeded === 0 && failures.every((f) => f.soft)) {
        toast.warning(`${label}需人工介入`, { description: failures[0]?.detail });
      } else if (succeeded === 0) {
        toast.error(`${label}失败`, { description: failures[0]?.detail });
      } else {
        toast.warning(`部分${label}成功`, {
          description: failures.map((f) => `${TOOL_DISPLAY[f.toolName]}: ${f.detail}`).join("\n"),
        });
      }
    },
    [toolVersionByName, refreshToolVersions, diagnoseToolSilently],
  );

  const handleRunToolAction = useCallback(
    async (toolNames: ToolName[], action: ToolLifecycleAction) => {
      if (toolNames.length === 0) return;
      if (
        toolNames.some(
          (n) => preflightTools.has(n) || toolActions[n] !== undefined,
        )
      ) {
        return;
      }
      setPreflightTools((prev) => {
        const next = new Set(prev);
        toolNames.forEach((n) => next.add(n));
        return next;
      });
      try {
        if (action === "install") {
          await executeRun(toolNames, action);
          return;
        }
        try {
          const reports = await toolEnvApi.probeToolInstallations([...toolNames]);
          const needConfirm = reports.filter((r) => r.needs_confirmation);
          if (needConfirm.length === 0) {
            await executeRun(toolNames, action);
            return;
          }
          setPendingUpgrade({ toolNames, plans: needConfirm });
        } catch {
          await executeRun(toolNames, action);
        }
      } finally {
        setPreflightTools((prev) => {
          const next = new Set(prev);
          toolNames.forEach((n) => next.delete(n));
          return next;
        });
      }
    },
    [executeRun, preflightTools, toolActions],
  );

  const isAnyBusy =
    Boolean(batchAction) ||
    Object.keys(toolActions).length > 0 ||
    preflightTools.size > 0;

  const copyManual = async () => {
    try {
      await navigator.clipboard.writeText(MANUAL_INSTALL);
      toast.success("已复制安装命令");
    } catch {
      toast.error("复制失败");
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-medium text-ink-primary">本地环境检查</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleDiagnoseAll()}
            disabled={isLoadingTools || isAnyBusy || isDiagnosingAll}
          >
            {isDiagnosingAll ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <StethoscopeIcon className="size-3.5" />
            )}
            诊断安装冲突
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadAllToolVersions({ force: true })}
            disabled={isLoadingTools || isAnyBusy}
          >
            <RefreshCwIcon
              className={isLoadingTools ? "size-3.5 animate-spin" : "size-3.5"}
            />
            刷新
          </Button>
          <Button
            size="sm"
            onClick={() => void handleRunToolAction(updatableToolNames, "update")}
            disabled={isLoadingTools || isAnyBusy || updatableToolNames.length === 0}
          >
            {batchAction === "update" ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <ArrowUpCircleIcon className="size-3.5" />
            )}
            全部升级 ({updatableToolNames.length})
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {TOOL_NAMES.map((toolName) => {
          const tool = toolVersionByName.get(toolName);
          const isToolLoading =
            Boolean(loadingTools[toolName]) ||
            (isLoadingTools && !toolVersionByName.has(toolName));
          const isOutdated = isUpdateAvailable(tool?.version, tool?.latest_version);
          const installedButBroken = Boolean(tool?.installed_but_broken);
          const action: ToolLifecycleAction | null =
            isToolLoading || installedButBroken
              ? null
              : !tool?.version
                ? "install"
                : isOutdated
                  ? "update"
                  : null;
          const runningAction = toolActions[toolName];
          const conflicts = toolDiagnostics[toolName];

          return (
            <div
              key={toolName}
              className="flex min-h-[150px] flex-col gap-3 rounded-lg border border-edge-subtle bg-surface-card p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <ToolCardIcon toolName={toolName} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {TOOL_DISPLAY[toolName]}
                    </div>
                    {tool?.env_type && ENV_LABEL[tool.env_type] ? (
                      <span className="mt-1 inline-flex rounded-full border border-edge bg-surface-raised px-1.5 py-0.5 text-[9px] text-ink-secondary">
                        {ENV_LABEL[tool.env_type]}
                        {tool.wsl_distro ? ` · ${tool.wsl_distro}` : ""}
                      </span>
                    ) : null}
                  </div>
                </div>
                {isToolLoading ? (
                  <Loader2Icon className="size-4 animate-spin text-ink-mute" />
                ) : tool?.version ? (
                  isOutdated ? (
                    <span className="rounded-full border border-warning/20 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                      可升级
                    </span>
                  ) : (
                    <CheckCircle2Icon className="size-4 text-primary" />
                  )
                ) : (
                  <AlertCircleIcon className="size-4 text-warning" />
                )}
              </div>

              <div className="space-y-1.5 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-secondary">当前版本</span>
                  <span className="truncate font-mono tabular-nums text-ink-primary">
                    {isToolLoading
                      ? "加载中…"
                      : tool?.version
                        ? tool.version
                        : installedButBroken
                          ? "已安装·无法运行"
                          : "未安装"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-ink-secondary">最新版本</span>
                  <span className="truncate font-mono tabular-nums text-ink-primary">
                    {isToolLoading ? "加载中…" : tool?.latest_version ?? "未知"}
                  </span>
                </div>
                {!isToolLoading && !tool?.version && tool?.error ? (
                  <div className="truncate text-[11px] text-ink-mute">{tool.error}</div>
                ) : null}
              </div>

              {conflicts && conflicts.length > 0 ? (
                <ul className="space-y-1 rounded-md border border-warning/20 bg-warning/5 p-2">
                  {conflicts.map((inst) => (
                    <li key={inst.path}>
                      <ToolInstallRow inst={inst} />
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-auto flex justify-end">
                {action ? (
                  <Button
                    size="sm"
                    variant={action === "install" ? "outline" : "default"}
                    onClick={() => void handleRunToolAction([toolName], action)}
                    disabled={isToolLoading || isAnyBusy}
                  >
                    {runningAction ? (
                      <Loader2Icon className="size-3.5 animate-spin" />
                    ) : action === "install" ? (
                      <DownloadIcon className="size-3.5" />
                    ) : (
                      <ArrowUpCircleIcon className="size-3.5" />
                    )}
                    {action === "install" ? "安装" : "升级"}
                  </Button>
                ) : (
                  <span className="text-xs text-ink-mute">
                    {isToolLoading ? "检测中…" : "已就绪"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <button
          type="button"
          onClick={() => setShowManual((v) => !v)}
          className="flex items-center gap-1.5 text-sm text-ink-secondary hover:text-ink-primary"
        >
          <ChevronDownIcon
            className={`size-3.5 transition-transform ${showManual ? "" : "-rotate-90"}`}
          />
          手动安装命令
        </button>
        {showManual ? (
          <div className="mt-2 rounded-lg border border-edge-subtle bg-surface-card p-4">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs text-ink-mute">一键安装失败时可手动执行</p>
              <Button size="sm" variant="outline" onClick={() => void copyManual()}>
                <CopyIcon className="size-3.5" />
                复制
              </Button>
            </div>
            <pre className="overflow-x-auto rounded-md bg-surface-raised p-3 font-mono text-xs">
              {MANUAL_INSTALL}
            </pre>
          </div>
        ) : null}
      </div>

      <ToolUpgradeConfirmDialog
        open={pendingUpgrade !== null}
        plans={pendingUpgrade?.plans ?? []}
        displayName={(tool) => TOOL_DISPLAY[tool as ToolName] ?? tool}
        onConfirm={() => {
          if (pendingUpgrade) void executeRun(pendingUpgrade.toolNames, "update");
          setPendingUpgrade(null);
        }}
        onCancel={() => setPendingUpgrade(null)}
      />
    </section>
  );
}
