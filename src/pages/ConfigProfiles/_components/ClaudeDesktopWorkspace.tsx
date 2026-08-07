import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon, FileCogIcon, RefreshCwIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  buildDefaultClaudeDesktopProfile,
  EMPTY_CLAUDE_DESKTOP_FIELDS,
  formatPathSourceLabel,
  getEditableFileText,
  mergeClaudeDesktopOperationFields,
  parseClaudeDesktopOperationFields,
  type ClaudeDesktopOperationFields,
  type EditableClaudeDesktopFile,
} from "@/lib/claudeDesktopConfig";
import { formatJson, gatewayBaseUrl, splitOneM, withOneM } from "@/lib/toolConfig";
import { cn } from "@/lib/utils";
import { useEndpoints } from "@/hooks/useEndpoints";
import { advertisedModels, endpointApi } from "@/services/modules/endpoint";
import { configApi } from "@/services/modules/config";
import {
  CLAUDE_DESKTOP_QUERY_KEYS,
  claudeDesktopConfigApi,
  type ClaudeDesktopProfileData,
  type ClaudeDesktopProfileMeta,
} from "@/services/modules/claude_desktop_config";
import { ChannelList } from "./ChannelList";
import { FormFieldLabel } from "./FormFieldLabel";
import { ModelCombobox } from "./ModelCombobox";

const JsonEditor = lazy(() => import("@/components/common/JsonEditor"));

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const MODEL_ROWS: Array<{
  key: "sonnetModel" | "opusModel" | "haikuModel";
  role: string;
}> = [
  { key: "sonnetModel", role: "Sonnet" },
  { key: "opusModel", role: "Opus" },
  { key: "haikuModel", role: "Haiku" },
];

const FILE_TABS: Array<{ value: EditableClaudeDesktopFile; label: string }> = [
  { value: "profile", label: "Profile" },
  { value: "meta", label: "_meta.json" },
  { value: "developerSettings", label: "developer_settings.json" },
  { value: "desktopConfig", label: "claude_desktop_config.json" },
];

export function ClaudeDesktopWorkspace() {
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const pathsQ = useQuery({
    queryKey: CLAUDE_DESKTOP_QUERY_KEYS.paths,
    queryFn: claudeDesktopConfigApi.resolvePaths,
  });
  const profilesQ = useQuery({
    queryKey: CLAUDE_DESKTOP_QUERY_KEYS.profiles,
    queryFn: claudeDesktopConfigApi.listProfiles,
    enabled: pathsQ.data?.supported !== false,
  });
  const cfgQ = useQuery({ queryKey: ["config"], queryFn: configApi.getConfig });
  const epQ = useEndpoints();

  const port = cfgQ.data?.port ?? 3000;
  const gateway = gatewayBaseUrl(port, "claude");
  const advertised = useMemo(() => {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const ep of epQ.data ?? []) {
      if (!ep.enabled) continue;
      for (const m of advertisedModels(ep)) {
        const k = m.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(m);
        }
      }
    }
    return out;
  }, [epQ.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [writeMode, setWriteMode] = useState<"endpoint" | "custom">("endpoint");
  const [base, setBase] = useState<unknown>({});
  const [fields, setFields] = useState<ClaudeDesktopOperationFields>(EMPTY_CLAUDE_DESKTOP_FIELDS);
  const [data, setData] = useState<ClaudeDesktopProfileData | null>(null);
  const [editableFile, setEditableFile] = useState<EditableClaudeDesktopFile>("profile");
  const [fileText, setFileText] = useState("");
  const [fileTextDirty, setFileTextDirty] = useState(false);
  const [rightEditable, setRightEditable] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [showKey, setShowKey] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ClaudeDesktopProfileMeta | null>(null);
  const [pendingApply, setPendingApply] = useState(false);

  const updateFields = (patch: Partial<ClaudeDesktopOperationFields>) =>
    setFields((f) => ({ ...f, ...patch }));

  const syncFileTextFromState = (
    nextData: ClaudeDesktopProfileData | null,
    kind: EditableClaudeDesktopFile,
    profileOverride?: unknown,
  ) => {
    if (!nextData) {
      setFileText("");
      setFileTextDirty(false);
      return;
    }
    const payload =
      kind === "profile" && profileOverride !== undefined
        ? { ...nextData, profileJson: profileOverride }
        : nextData;
    setFileText(getEditableFileText(payload, kind));
    setFileTextDirty(false);
  };

  useEffect(() => {
    if (!loaded || rightEditable || fileTextDirty || editableFile !== "profile") return;
    const merged = mergeClaudeDesktopOperationFields(base, fields);
    setFileText(JSON.stringify(merged, null, 2));
  }, [fields, base, loaded, rightEditable, fileTextDirty, editableFile]);

  const resetEditor = () => {
    setLoaded(false);
    setSelectedId(null);
    setName("");
    setBase({});
    setFields(EMPTY_CLAUDE_DESKTOP_FIELDS);
    setData(null);
    setEditableFile("profile");
    setFileText("");
    setFileTextDirty(false);
    setRightEditable(false);
    setFetchedModels([]);
  };

  const startNew = () => {
    const profileJson = buildDefaultClaudeDesktopProfile(gateway);
    setSelectedId(null);
    setName("");
    setWriteMode("endpoint");
    setBase({});
    setFields(parseClaudeDesktopOperationFields(profileJson));
    setData(null);
    setEditableFile("profile");
    setFileText(JSON.stringify(profileJson, null, 2));
    setFileTextDirty(false);
    setRightEditable(false);
    setFetchedModels([]);
    setLoaded(true);
  };

  const loadProfile = async (id: string) => {
    try {
      const next = await claudeDesktopConfigApi.getProfile(id);
      setSelectedId(id);
      setName(next.meta.name);
      setWriteMode("custom");
      setBase(next.profileJson ?? {});
      setFields(parseClaudeDesktopOperationFields(next.profileJson));
      setData(next);
      setEditableFile("profile");
      syncFileTextFromState(next, "profile");
      setRightEditable(false);
      setFetchedModels([]);
      setLoaded(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const buildProfileJson = () => {
    if (editableFile === "profile" && (rightEditable || fileTextDirty)) {
      return JSON.parse(fileText);
    }
    return mergeClaudeDesktopOperationFields(base, fields);
  };

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: CLAUDE_DESKTOP_QUERY_KEYS.paths });
    qc.invalidateQueries({ queryKey: CLAUDE_DESKTOP_QUERY_KEYS.profiles });
  };

  const saveProfile = useMutation({
    mutationFn: async () => {
      const profileJson = buildProfileJson();
      const req: Parameters<typeof claudeDesktopConfigApi.saveProfile>[0] = {
        id: selectedId,
        name,
        profileJson,
        registerInMeta: true,
        makeActive: false,
      };
      // 右栏编辑 sidecar 时随保存一并落盘。
      if (fileTextDirty && rightEditable && editableFile !== "profile") {
        const parsed = JSON.parse(fileText);
        if (editableFile === "meta") req.metaJson = parsed;
        if (editableFile === "developerSettings") req.developerSettingsJson = parsed;
        if (editableFile === "desktopConfig") req.desktopConfigJson = parsed;
      }
      return claudeDesktopConfigApi.saveProfile(req);
    },
    onSuccess: async (meta) => {
      toast.success("已直接写入 Claude Desktop 真实配置文件");
      setSelectedId(meta.id);
      invalidateAll();
      await loadProfile(meta.id);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const apply3p = useMutation({
    mutationFn: async () => {
      const profileJson = buildProfileJson();
      const meta = await claudeDesktopConfigApi.saveProfile({
        id: selectedId,
        name,
        profileJson,
        registerInMeta: true,
        makeActive: true,
      });
      const result = await claudeDesktopConfigApi.apply3pMode({
        activeProfileId: meta.id,
        writeNormalConfig: true,
        writeThreepConfig: true,
        writeDeveloperSettings: true,
      });
      return { meta, result };
    },
    onSuccess: async ({ meta, result }) => {
      setPendingApply(false);
      setSelectedId(meta.id);
      invalidateAll();
      await loadProfile(meta.id);
      const warn =
        result.warnings.length > 0 ? `（${result.warnings.slice(0, 2).join("；")}）` : "";
      toast.success(
        result.restartRequired
          ? `已启用 3P 模式并写入 ${result.writtenFiles.length} 个文件，请重启 Claude Desktop${warn}`
          : `已写入 ${result.writtenFiles.length} 个文件${warn}`,
      );
    },
    onError: (e) => {
      setPendingApply(false);
      toast.error(errMsg(e));
    },
  });

  const delProfile = useMutation({
    mutationFn: (id: string) => claudeDesktopConfigApi.deleteProfile(id),
    onSuccess: (_d, id) => {
      toast.success("已解除注册并删除真实配置文件");
      if (selectedId === id) resetEditor();
      invalidateAll();
      setPendingDelete(null);
    },
    onError: (e) => {
      toast.error(errMsg(e));
      setPendingDelete(null);
    },
  });

  const fetchModels = useMutation({
    mutationFn: () => endpointApi.fetchModels(fields.baseUrl, fields.apiKey, "claude"),
    onSuccess: (ids) => {
      setFetchedModels(ids);
      toast.success(`拉取到 ${ids.length} 个模型`);
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const modelOptions = writeMode === "custom" ? fetchedModels : advertised;
  const setModel = (key: "sonnetModel" | "opusModel" | "haikuModel", b: string, is1m: boolean) =>
    updateFields({ [key]: withOneM(b, is1m) } as Partial<ClaudeDesktopOperationFields>);

  const canSubmit = loaded && name.trim().length > 0;
  const paths = pathsQ.data;
  const pathUnsupported = paths && !paths.supported;

  const onSelectFileTab = (kind: EditableClaudeDesktopFile) => {
    if (kind === editableFile) return;
    // 切走 profile 前，把表单合并结果固化进 base，避免丢编辑。
    if (editableFile === "profile" && !rightEditable && !fileTextDirty) {
      setBase(mergeClaudeDesktopOperationFields(base, fields));
    }
    setEditableFile(kind);
    if (data) {
      const profileOverride =
        kind === "profile" ? mergeClaudeDesktopOperationFields(base, fields) : undefined;
      syncFileTextFromState(data, kind, profileOverride);
    } else if (kind === "profile") {
      setFileText(JSON.stringify(mergeClaudeDesktopOperationFields(base, fields), null, 2));
      setFileTextDirty(false);
    } else {
      setFileText("// 请先保存或选择配置文件后查看此文件");
      setFileTextDirty(false);
    }
    setRightEditable(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <PathStatusBanner
        loading={pathsQ.isLoading}
        error={pathsQ.error ? errMsg(pathsQ.error) : null}
        paths={paths}
      />

      <div className="flex min-h-0 flex-1 gap-3">
        <ChannelList
          title="配置文件"
          newLabel="新增配置文件"
          emptyLabel="暂无配置文件，点击右上角 + 新增"
          channels={profilesQ.data ?? []}
          loading={profilesQ.isLoading}
          selectedId={selectedId}
          onSelect={loadProfile}
          onNew={startNew}
          onDelete={(ch) => setPendingDelete(ch)}
        />

        <div className="flex min-h-0 min-w-0 flex-[3] flex-col gap-4 overflow-y-auto rounded-lg border border-edge bg-surface p-4">
          {pathUnsupported ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-mute">
              <FileCogIcon className="size-10 opacity-40" />
              <p className="text-sm">{paths?.warning || "当前环境不支持 Claude Desktop 配置接管"}</p>
            </div>
          ) : !loaded ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-mute">
              <FileCogIcon className="size-10 opacity-40" />
              <p className="text-sm">点击左侧「+」新增，或选择一个配置文件开始编辑</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cd-name">配置名称</Label>
                <Input
                  id="cd-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：本机网关"
                />
              </div>

              {selectedId && (
                <div className="grid grid-cols-2 gap-2 text-xs text-ink-mute">
                  <div>
                    Profile ID：<code className="text-ink-secondary">{selectedId}</code>
                  </div>
                  <div>
                    文件名：
                    <code className="text-ink-secondary">{selectedId}.json</code>
                  </div>
                  <div>
                    注册状态：
                    <span className="text-ink-secondary">
                      {data?.meta.registered ? "已注册" : "未注册 / 新建"}
                    </span>
                  </div>
                  <div>
                    当前应用：
                    <span className="text-ink-secondary">{data?.meta.active ? "是" : "否"}</span>
                  </div>
                </div>
              )}

              <Tabs
                value={writeMode}
                onValueChange={(v) => {
                  const t = v as "endpoint" | "custom";
                  setWriteMode(t);
                  if (t === "endpoint") updateFields({ baseUrl: gateway });
                }}
              >
                <TabsList>
                  <TabsTrigger value="endpoint">端点配置写入</TabsTrigger>
                  <TabsTrigger value="custom">自定义配置写入</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex flex-col gap-1.5">
                <FormFieldLabel htmlFor="cd-base" label="地址" hint="inferenceGatewayBaseUrl" />
                <Input
                  id="cd-base"
                  value={fields.baseUrl}
                  readOnly={writeMode === "endpoint"}
                  onChange={(e) => updateFields({ baseUrl: e.target.value })}
                  placeholder="https://..."
                />
                {writeMode === "endpoint" && (
                  <p className="px-1 text-xs text-ink-mute">端点模式：自动指向本机网关 {gateway}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <FormFieldLabel htmlFor="cd-key" label="秘钥" hint="inferenceGatewayApiKey" />
                <div className="relative">
                  <Input
                    id="cd-key"
                    type={showKey ? "text" : "password"}
                    value={fields.apiKey}
                    onChange={(e) => updateFields({ apiKey: e.target.value })}
                    className="pr-9"
                    placeholder="sk-..."
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? "隐藏密钥" : "查看密钥"}
                    className="absolute inset-y-0 right-0 flex items-center px-2.5 text-ink-mute hover:text-ink-secondary"
                  >
                    {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>模型映射（写入 inferenceModels；1M 对应 supports1m）</Label>
                  {writeMode === "custom" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={fetchModels.isPending || !fields.baseUrl}
                      onClick={() => fetchModels.mutate()}
                    >
                      <RefreshCwIcon
                        className={cn("size-3", fetchModels.isPending && "animate-spin")}
                      />
                      拉取模型
                    </Button>
                  )}
                </div>
                {MODEL_ROWS.map((row) => {
                  const { base: b, is1m } = splitOneM(fields[row.key]);
                  return (
                    <div key={row.key} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-sm text-ink-secondary">{row.role}</span>
                      <ModelCombobox
                        className="flex-1"
                        value={b}
                        onChange={(v) => setModel(row.key, v, is1m)}
                        options={modelOptions}
                        placeholder="模型显示名"
                      />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-ink-mute">
                        <Switch checked={is1m} onCheckedChange={(v) => setModel(row.key, b, v)} />
                        1M
                      </label>
                    </div>
                  );
                })}
              </div>

              <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink-secondary">
                <Switch
                  checked={fields.modelDiscoveryEnabled}
                  onCheckedChange={(v) => updateFields({ modelDiscoveryEnabled: v })}
                />
                启用模型发现（modelDiscoveryEnabled）
              </label>
            </>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-2 rounded-lg border border-edge bg-surface p-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <Label>配置文件</Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!loaded || !rightEditable}
                  onClick={() => {
                    const formatted = formatJson(fileText);
                    if (formatted === fileText && fileText.trim() && !fileText.trim().startsWith("{")) {
                      toast.error("JSON 格式错误，无法格式化");
                      return;
                    }
                    setFileText(formatted);
                    setFileTextDirty(true);
                  }}
                >
                  格式化
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-ink-mute">
                  <Switch
                    checked={rightEditable}
                    disabled={!loaded || (!data && editableFile !== "profile")}
                    onCheckedChange={setRightEditable}
                  />
                  可编辑
                </label>
              </div>
            </div>
            <Tabs
              value={editableFile}
              onValueChange={(v) => onSelectFileTab(v as EditableClaudeDesktopFile)}
            >
              <TabsList className="h-auto flex-wrap">
                {FILE_TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<EditorFallback />}>
              <JsonEditor
                value={fileText}
                theme={theme}
                lang="json"
                readOnly={!rightEditable}
                fill
                onChange={(text) => {
                  setFileText(text);
                  setFileTextDirty(true);
                  if (editableFile === "profile") {
                    try {
                      setFields(parseClaudeDesktopOperationFields(JSON.parse(text)));
                    } catch {
                      // 保持用户输入
                    }
                  }
                }}
              />
            </Suspense>
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-center gap-3 rounded-lg border border-edge bg-surface px-4 py-3">
        <span className="absolute left-4 hidden max-w-[40%] truncate text-xs text-ink-mute md:block">
          保存将直接写入真实 Claude Desktop 文件；启用 3P 前会自动备份
        </span>
        <Button
          variant="outline"
          disabled={!canSubmit || saveProfile.isPending || pathUnsupported}
          onClick={() => saveProfile.mutate()}
        >
          保存配置文件
        </Button>
        <Button
          disabled={!canSubmit || apply3p.isPending || saveProfile.isPending || pathUnsupported}
          onClick={() => setPendingApply(true)}
        >
          启用 3P 模式
        </Button>
      </div>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除配置文件</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-secondary">
            确定删除「<span className="font-medium">{pendingDelete?.name}</span>」吗？将从{" "}
            <code>_meta.json</code> 解除注册，并删除真实文件{" "}
            <code>{pendingDelete?.fileName || `${pendingDelete?.id}.json`}</code>。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={delProfile.isPending}
              onClick={() => pendingDelete && delProfile.mutate(pendingDelete.id)}
            >
              解除注册并删除文件
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingApply} onOpenChange={(o) => !o && setPendingApply(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>启用 3P 模式</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm text-ink-secondary">
            <p>将先保存当前配置文件，再备份并写入：</p>
            <ul className="list-inside list-disc text-xs text-ink-mute">
              <li>configLibrary/_meta.json（设为当前应用）</li>
              <li>claude_desktop_config.json（deploymentMode=3p）</li>
              <li>普通 Claude 侧 claude_desktop_config.json（如可解析）</li>
              <li>developer_settings.json（确认存在，保留原字段）</li>
            </ul>
            <p className="text-amber-700 dark:text-amber-400">完成后通常需要重启 Claude Desktop。</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingApply(false)}>
              取消
            </Button>
            <Button disabled={apply3p.isPending} onClick={() => apply3p.mutate()}>
              确认启用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PathStatusBanner({
  loading,
  error,
  paths,
}: {
  loading: boolean;
  error: string | null;
  paths: import("@/services/modules/claude_desktop_config").ClaudeDesktopPaths | undefined;
}) {
  if (loading) {
    return (
      <div className="rounded-lg border border-edge bg-surface px-3 py-2 text-xs text-ink-mute">
        正在解析 Claude Desktop 配置路径…
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        路径解析失败：{error}
      </div>
    );
  }
  if (!paths) return null;
  return (
    <div className="rounded-lg border border-edge bg-surface px-3 py-2 text-xs text-ink-secondary">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span>
          来源：<code>{formatPathSourceLabel(paths)}</code>
        </span>
        {paths.packageFamilyName && (
          <span>
            PFN：<code>{paths.packageFamilyName}</code>
          </span>
        )}
        {paths.isMsixVirtualized && <span className="text-amber-700 dark:text-amber-400">MSIX</span>}
      </div>
      <div className="mt-1 truncate text-ink-mute" title={paths.threepRootResolved || undefined}>
        3P 目录：{paths.threepRootResolved || "未解析"}
      </div>
      {paths.warning && <div className="mt-1 text-amber-700 dark:text-amber-400">{paths.warning}</div>}
    </div>
  );
}

function EditorFallback() {
  return (
    <div className="flex h-[160px] items-center justify-center text-xs text-ink-mute">
      加载编辑器…
    </div>
  );
}
