import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDownIcon,
  EyeIcon,
  EyeOffIcon,
  FileCogIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { useTheme } from "next-themes";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEndpoints } from "@/hooks/useEndpoints";
import { cn } from "@/lib/utils";
import {
  addOmpModel,
  applyFieldsToOmpProvider,
  emptyOmpModel,
  formatProviderJson,
  OMP_API_TYPES,
  parseOmpProviderFields,
  parseProviderJsonText,
  removeOmpModel,
  toggleOmpModelInput,
  updateOmpModel,
  type OmpModelFields,
  type OmpProviderFields,
} from "@/lib/ompConfig";
import {
  buildPiOmpApplyItems,
  formatOmpDefaultSelector,
  getProviderModelIds,
  isSafePiOmpProviderId,
  normalizePiOmpProviderId,
  type PiOmpProviderMeta,
} from "@/lib/piOmpCommon";
import { gatewayBaseUrl } from "@/lib/toolConfig";
import { advertisedModels, endpointApi } from "@/services/modules/endpoint";
import { configApi } from "@/services/modules/config";
import {
  OMP_QUERY_KEYS,
  ompConfigApi,
  type OmpConfigPaths,
  type OmpProviderData,
  type OmpWorkspaceState,
} from "@/services/modules/omp_config";
import { FormFieldLabel } from "./FormFieldLabel";
import { ModelCombobox } from "./ModelCombobox";
import {
  EditorFallback,
  FileTabStrip,
  fileBaseName,
  type RightFileTab,
} from "./_piOmpCommon/FileTabStrip";
import { ProviderList, sortProviders, upsertProviderMeta } from "./_piOmpCommon/ProviderList";
import { RenameProviderDialog } from "./_piOmpCommon/RenameProviderDialog";
import { FormSection, MiniField, SwitchRow } from "./_piOmpCommon/FormSection";
import { KeyValueEditor } from "./_piOmpCommon/KeyValueEditor";
import { ThinkingObjectEditor } from "./_piOmpCommon/ThinkingObjectEditor";
import { DiscoveryEditor } from "./_piOmpCommon/DiscoveryEditor";
import { RemoteCompactionEditor } from "./_piOmpCommon/RemoteCompactionEditor";

const JsonEditor = lazy(() => import("@/components/common/JsonEditor"));

const errMsg = (error: unknown) => (error instanceof Error ? error.message : String(error));

const OMP_THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max", "auto", "inherit"] as const;

function ompFileTabs(paths: OmpConfigPaths | undefined) {
  return [
    { value: "provider" as const, label: "Profile" },
    { value: "models" as const, label: fileBaseName(paths?.modelsPath, "models.yml") },
    { value: "settings" as const, label: fileBaseName(paths?.settingsPath, "config.yml") },
  ];
}

const EMPTY_FIELDS: OmpProviderFields = {
  baseUrl: "",
  apiKey: "",
  api: "openai-completions",
  headers: {},
  remoteCompaction: null,
  authHeader: false,
  auth: "apiKey",
  discovery: null,
  models: [],
  disableStrictTools: false,
  transport: "",
  subTab: "endpoint",
};

export function OmpWorkspace() {
  const queryClient = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const workspaceQuery = useQuery({
    queryKey: OMP_QUERY_KEYS.workspace(),
    queryFn: () => ompConfigApi.sync(),
  });

  const cfgQ = useQuery({ queryKey: ["config"], queryFn: configApi.getConfig });
  const epQ = useEndpoints();
  const port = cfgQ.data?.port ?? 3000;
  const gateway = gatewayBaseUrl(port, "codex");
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

  const [providers, setProviders] = useState<PiOmpProviderMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [providerText, setProviderText] = useState("{}");
  const [modelsText, setModelsText] = useState("");
  const [settingsText, setSettingsText] = useState("");
  const [rightTab, setRightTab] = useState<RightFileTab>("provider");
  const [rightEditable, setRightEditable] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PiOmpProviderMeta | null>(null);
  const [defaultProvider, setDefaultProvider] = useState("");
  const [defaultModel, setDefaultModel] = useState("");
  const [thinkingLevel, setThinkingLevel] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [expandedModel, setExpandedModel] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<(() => void) | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [fields, setFields] = useState<OmpProviderFields>(EMPTY_FIELDS);

  /** 上次从服务端同步的默认选择；本地 setQueryData（开关/排序/保存）不会改它。 */
  const lastSyncedDefault = useRef<string | null>(null);

  useEffect(() => {
    const workspace = workspaceQuery.data;
    if (!workspace) return;
    const sortedProviders = sortProviders(workspace.providers);
    setProviders(sortedProviders);
    // 只有磁盘上的默认选择真的变化时才覆盖本地状态，避免缓存写入把未应用的默认模型静默重置
    const syncedDefault = JSON.stringify([
      workspace.defaultSelection.provider ?? "",
      workspace.defaultSelection.model ?? "",
      workspace.defaultSelection.thinkingLevel ?? "",
    ]);
    if (lastSyncedDefault.current !== syncedDefault) {
      lastSyncedDefault.current = syncedDefault;
      setDefaultProvider(workspace.defaultSelection.provider ?? "");
      setDefaultModel(workspace.defaultSelection.model ?? "");
      setThinkingLevel(workspace.defaultSelection.thinkingLevel ?? "");
    }
    setModelsText(workspace.modelsText);
    setSettingsText(workspace.settingsText);
    if (selectedId && !sortedProviders.some((provider) => provider.id === selectedId)) {
      resetEditor();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceQuery.data]);

  const selectedProvider = providers.find((provider) => provider.id === selectedId) ?? null;

  const providerModelIds = useMemo(() => {
    try {
      return getProviderModelIds(parseProviderJsonText(providerText));
    } catch {
      return [];
    }
  }, [providerText]);

  useEffect(() => {
    if (!loaded) return;
    if (providerModelIds.length === 0) return;
    if (!providerModelIds.includes(defaultModel) && defaultProvider === providerId) {
      setDefaultModel(providerModelIds[0]);
    }
  }, [defaultModel, defaultProvider, loaded, providerId, providerModelIds]);

  const updateWorkspaceCache = (nextProviders: PiOmpProviderMeta[]) => {
    queryClient.setQueryData<OmpWorkspaceState>(OMP_QUERY_KEYS.workspace(), (oldWorkspace) => {
      if (!oldWorkspace) return oldWorkspace;
      return { ...oldWorkspace, providers: nextProviders };
    });
  };

  const resetEditor = () => {
    setLoaded(false);
    setSelectedId(null);
    setProviderId("");
    setEnabled(true);
    setProviderText("{}");
    setRightTab("provider");
    setRightEditable(false);
    setShowKey(false);
    setExpandedModel(null);
    setDirty(false);
    setFetchedModels([]);
    setFields(EMPTY_FIELDS);
  };

  const startNew = () => {
    const nextIndex = providers.length + 1;
    const nextProviderId = `custom-${nextIndex}`;
    const initialFields: OmpProviderFields = {
      ...EMPTY_FIELDS,
      baseUrl: gateway,
      models: [emptyOmpModel()],
    };
    setSelectedId(null);
    setLoaded(true);
    setProviderId(nextProviderId);
    setEnabled(true);
    setExpandedModel(0);
    setFields(initialFields);
    setProviderText(formatProviderJson(applyFieldsToOmpProvider({}, initialFields)));
    setRightTab("provider");
    setRightEditable(false);
    setShowKey(false);
    setDirty(false);
    setFetchedModels([]);
  };

  const loadProvider = async (nextProviderId: string) => {
    try {
      const providerData: OmpProviderData = await ompConfigApi.getProvider(nextProviderId);
      const parsedFields = parseOmpProviderFields(providerData.providerJson, gateway);
      setSelectedId(providerData.meta.id);
      setLoaded(true);
      setProviderId(providerData.meta.id);
      setEnabled(providerData.meta.enabled);
      setProviderText(providerData.providerText || formatProviderJson(providerData.providerJson));
      setFields(parsedFields);
      setModelsText(providerData.modelsText);
      setSettingsText(providerData.settingsText);
      setRightTab("provider");
      setRightEditable(false);
      setShowKey(false);
      setExpandedModel(null);
      setDirty(false);
      setFetchedModels([]);
      if (providerData.defaultSelection.provider === providerData.meta.id) {
        setDefaultProvider(providerData.meta.id);
        setDefaultModel(providerData.defaultSelection.model ?? "");
        setThinkingLevel(providerData.defaultSelection.thinkingLevel ?? "");
      }
    } catch (error) {
      toast.error(errMsg(error));
    }
  };

  /** 有未保存修改时先弹确认，避免误触丢编辑内容。 */
  const guardUnsaved = (action: () => void) => {
    if (loaded && dirty) {
      setPendingNavigation(() => action);
    } else {
      action();
    }
  };

  const onSelectFileTab = (nextTab: RightFileTab) => {
    if (nextTab === rightTab) return;
    setRightTab(nextTab);
    setRightEditable(false);
  };

  const updateField = (patch: Partial<OmpProviderFields>) => {
    setDirty(true);
    setFields((current) => {
      const next = { ...current, ...patch };
      try {
        const base = parseProviderJsonText(providerText);
        setProviderText(formatProviderJson(applyFieldsToOmpProvider(base, next)));
      } catch {
        // providerText 非法时仅更新表单
      }
      return next;
    });
  };

  const onProviderTextChange = (text: string) => {
    setDirty(true);
    setProviderText(text);
    try {
      setFields(parseOmpProviderFields(parseProviderJsonText(text), gateway));
    } catch {
      // 非法 JSON 保留输入
    }
  };

  const switchSubTab = (nextTab: "endpoint" | "custom") => {
    if (nextTab === "endpoint") {
      updateField({ subTab: "endpoint", baseUrl: gateway });
    } else {
      updateField({ subTab: "custom" });
    }
  };

  const addModel = () => {
    const nextModels = addOmpModel(fields.models);
    updateField({ models: nextModels });
    setExpandedModel(nextModels.length - 1);
  };

  const updateModel = (index: number, patch: Partial<OmpModelFields>) => {
    updateField({ models: updateOmpModel(fields.models, index, patch) });
  };

  const removeModel = (index: number) => {
    updateField({ models: removeOmpModel(fields.models, index) });
    setExpandedModel((current) => {
      if (current === null) return null;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    });
  };

  const toggleInput = (index: number, inputType: "text" | "image", checked: boolean) => {
    updateField({ models: toggleOmpModelInput(fields.models, index, inputType, checked) });
  };

  const updateProviderEnabled = (nextProviderId: string, nextEnabled: boolean) => {
    const nextProviders = providers.map((provider) =>
      provider.id === nextProviderId ? { ...provider, enabled: nextEnabled } : provider,
    );
    setProviders(nextProviders);
    updateWorkspaceCache(nextProviders);
    if (selectedId === nextProviderId || (!selectedId && providerId === nextProviderId)) {
      setEnabled(nextEnabled);
    }
    if (!nextEnabled && defaultProvider === nextProviderId) {
      setDefaultProvider("");
      setDefaultModel("");
      setThinkingLevel("");
    }
  };

  /** 编辑器内的启用开关：同步列表状态并标记未保存。 */
  const updateEditorEnabled = (nextEnabled: boolean) => {
    setDirty(true);
    updateProviderEnabled(selectedId ?? providerId, nextEnabled);
  };

  const saveCurrentProvider = async () => {
    const normalizedProviderId = normalizePiOmpProviderId(providerId);
    if (!isSafePiOmpProviderId(normalizedProviderId)) {
      throw new Error("provider id 仅支持字母、数字、点、下划线、短横线");
    }
    if (selectedId && normalizedProviderId !== selectedId) {
      throw new Error("已保存渠道暂不支持修改 provider id；请新建渠道");
    }
    const providerJson = parseProviderJsonText(providerText);
    return ompConfigApi.saveProvider({
      id: normalizedProviderId,
      name: normalizedProviderId,
      enabled,
      order: selectedProvider?.order ?? providers.length,
      providerJson,
    });
  };

  const saveMutation = useMutation({
    mutationFn: saveCurrentProvider,
    onSuccess: (meta) => {
      const nextProviders = sortProviders(upsertProviderMeta(providers, meta));
      setProviders(nextProviders);
      updateWorkspaceCache(nextProviders);
      setSelectedId(meta.id);
      setProviderId(meta.id);
      setEnabled(meta.enabled);
      setDirty(false);
      toast.success("已保存拆分渠道，点击「应用」后才会写入真实汇总文件");
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      let nextProviders = providers;
      let savedMeta: PiOmpProviderMeta | null = null;
      if (loaded) {
        if (!canSave) {
          throw new Error("当前渠道表单无效（ID 或 Profile JSON 有误），请修正后再应用");
        }
        savedMeta = await saveCurrentProvider();
        nextProviders = sortProviders(upsertProviderMeta(providers, savedMeta));
      }
      const result = await ompConfigApi.apply({
        items: buildPiOmpApplyItems(nextProviders),
        defaultProvider: defaultProvider || null,
        defaultModel: defaultModel || null,
        thinkingLevel: thinkingLevel || null,
      });
      return { result, savedMeta };
    },
    onSuccess: ({ result, savedMeta }) => {
      if (savedMeta) {
        setSelectedId(savedMeta.id);
        setProviderId(savedMeta.id);
        setEnabled(savedMeta.enabled);
        setDirty(false);
      }
      const nextProviders = sortProviders(result.providers);
      setProviders(nextProviders);
      setDefaultProvider(result.defaultSelection.provider ?? "");
      setDefaultModel(result.defaultSelection.model ?? "");
      setThinkingLevel(result.defaultSelection.thinkingLevel ?? "");
      queryClient.setQueryData<OmpWorkspaceState>(OMP_QUERY_KEYS.workspace(), (oldWorkspace) =>
        oldWorkspace
          ? { ...oldWorkspace, paths: result.paths, providers: nextProviders, defaultSelection: result.defaultSelection }
          : oldWorkspace,
      );
      toast.success(`已应用 ${result.enabledCount} 个启用渠道`);
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (deleteId: string) => ompConfigApi.deleteProvider(deleteId),
    onSuccess: (workspace, deleteId) => {
      const nextProviders = sortProviders(workspace.providers);
      setProviders(nextProviders);
      setDefaultProvider(workspace.defaultSelection.provider ?? "");
      setDefaultModel(workspace.defaultSelection.model ?? "");
      setThinkingLevel(workspace.defaultSelection.thinkingLevel ?? "");
      queryClient.setQueryData(OMP_QUERY_KEYS.workspace(), workspace);
      if (selectedId === deleteId) resetEditor();
      setPendingDelete(null);
      toast.success("已删除渠道并清理真实配置引用");
    },
    onError: (error) => {
      setPendingDelete(null);
      toast.error(errMsg(error));
    },
  });

  const handleReorderProviders = (nextProviders: PiOmpProviderMeta[]) => {
    setProviders(nextProviders);
    updateWorkspaceCache(nextProviders);
  };

  /** 原子改名：后端一次迁移拆分文件名、汇总文件键、默认引用，返回最新 workspace。 */
  const renameMutation = useMutation({
    mutationFn: (args: { oldId: string; newId: string }) =>
      ompConfigApi.renameProvider(args.oldId, args.newId),
    onSuccess: (workspace, { newId }) => {
      const nextProviders = sortProviders(workspace.providers);
      setProviders(nextProviders);
      setDefaultProvider(workspace.defaultSelection.provider ?? "");
      setDefaultModel(workspace.defaultSelection.model ?? "");
      setThinkingLevel(workspace.defaultSelection.thinkingLevel ?? "");
      queryClient.setQueryData(OMP_QUERY_KEYS.workspace(), workspace);
      setRenameOpen(false);
      void loadProvider(newId);
      toast.success("已改名并迁移拆分文件、汇总键与默认引用");
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  /** 自定义模式：从当前地址拉取 /v1/models 作为模型 id 候选；anthropic 类 api 优先 x-api-key 鉴权。 */
  const fetchModelsMutation = useMutation({
    mutationFn: () =>
      endpointApi.fetchModels(
        fields.baseUrl,
        fields.apiKey,
        fields.api.includes("anthropic") ? "claude" : "codex",
      ),
    onSuccess: (ids) => {
      setFetchedModels(ids);
      if (ids.length > 0) toast.success(`拉取到 ${ids.length} 个模型`);
      else toast.error("未拉取到模型，请检查地址与秘钥");
    },
    onError: (error) => toast.error(errMsg(error)),
  });

  const setSelectedProviderAsDefault = () => {
    if (!enabled || providerModelIds.length === 0) return;
    const nextDefaultModel =
      defaultProvider === providerId && providerModelIds.includes(defaultModel)
        ? defaultModel
        : providerModelIds[0];
    setDefaultProvider(providerId);
    setDefaultModel(nextDefaultModel);
  };

  /** 放弃修改：已保存渠道重新加载磁盘版本，新建渠道回到空态。 */
  const discardChanges = () => {
    if (selectedId) void loadProvider(selectedId);
    else resetEditor();
  };

  const providerTextIsValid = useMemo(() => {
    try {
      parseProviderJsonText(providerText);
      return true;
    } catch {
      return false;
    }
  }, [providerText]);

  const canSave = loaded && isSafePiOmpProviderId(providerId) && providerTextIsValid;
  const selectedProviderCanBeDefault = loaded && enabled && providerModelIds.length > 0;
  /** 端点模式用网关公布的模型；自定义模式用从该地址拉取的模型。 */
  const modelOptions = fields.subTab === "custom" ? fetchedModels : advertised;
  const fileTabs = useMemo(() => ompFileTabs(workspaceQuery.data?.paths), [workspaceQuery.data?.paths]);
  const rightText = rightTab === "provider" ? providerText : rightTab === "models" ? modelsText : settingsText;
  const rightLanguage = rightTab === "provider" ? "json" : "text";
  const canEditRight = loaded && rightTab === "provider";
  const currentSelector = defaultProvider && defaultModel
    ? formatOmpDefaultSelector(defaultProvider, defaultModel, thinkingLevel)
    : "";

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 gap-3">
        <ProviderList
          providers={providers}
          loading={workspaceQuery.isLoading}
          selectedId={selectedId}
          onSelect={(id) => guardUnsaved(() => void loadProvider(id))}
          onNew={() => guardUnsaved(startNew)}
          onDelete={setPendingDelete}
          onToggle={updateProviderEnabled}
          onReorder={handleReorderProviders}
        />

        <div className="flex min-h-0 min-w-0 flex-[3] flex-col gap-4 overflow-y-auto rounded-lg border border-edge bg-surface p-4">
          {!loaded ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-mute">
              <FileCogIcon className="size-10 opacity-40" />
              <p className="text-sm">选择左侧渠道开始编辑，或新建一个拆分渠道</p>
              <Button type="button" variant="outline" size="sm" onClick={startNew}>
                <PlusIcon className="size-3.5" />
                新建渠道
              </Button>
            </div>
          ) : (
            <>
              <FormSection
                title="渠道信息"
                description="Provider ID 同时作为拆分文件名与列表显示名"
                actions={
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-secondary">
                    <Switch checked={enabled} onCheckedChange={updateEditorEnabled} />
                    启用
                  </label>
                }
              >
                <div className="flex flex-col gap-1.5">
                  <FormFieldLabel htmlFor="omp-provider-id" label="Provider ID" hint="仅字母、数字、点、下划线、短横线；已保存渠道点「编辑」修改" />
                  <div className="flex items-center gap-2">
                    <Input
                      id="omp-provider-id"
                      value={providerId}
                      readOnly={Boolean(selectedId)}
                      onChange={(event) => {
                        setDirty(true);
                        setProviderId(event.target.value);
                      }}
                      placeholder="remote-gpt"
                      className={cn("flex-1", selectedId && "text-ink-mute")}
                    />
                    {selectedId && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={dirty}
                        title={dirty ? "有未保存的修改，请先保存或放弃" : "修改 Provider ID"}
                        onClick={() => setRenameOpen(true)}
                      >
                        编辑
                      </Button>
                    )}
                  </div>
                  {!isSafePiOmpProviderId(providerId) && (
                    <p className="px-1 text-xs text-destructive">仅支持字母、数字、点、下划线、短横线</p>
                  )}
                </div>
              </FormSection>

              <FormSection>
                <Tabs value={fields.subTab} onValueChange={(value) => switchSubTab(value as "endpoint" | "custom")}>
                  <TabsList>
                    <TabsTrigger value="endpoint">端点配置写入</TabsTrigger>
                    <TabsTrigger value="custom">自定义配置写入</TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="flex flex-col gap-1.5">
                  <FormFieldLabel htmlFor="omp-base-url" label="地址 *" hint="provider.baseUrl；端点模式指向本机网关" />
                  <Input
                    id="omp-base-url"
                    value={fields.baseUrl}
                    readOnly={fields.subTab === "endpoint"}
                    onChange={(event) => updateField({ baseUrl: event.target.value })}
                    placeholder="https://..."
                  />
                  {fields.subTab === "endpoint" && (
                    <p className="px-1 text-xs text-ink-mute">端点模式：自动指向本机网关 {gateway}；如需不带 /v1 的地址请切到自定义模式</p>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <FormFieldLabel htmlFor="omp-api" label="API 类型" hint="决定请求协议格式" />
                    <Select value={fields.api || "__none__"} onValueChange={(value) => updateField({ api: value === "__none__" ? "" : value })}>
                      <SelectTrigger id="omp-api" className="w-full">
                        <SelectValue placeholder="未指定" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">未指定</SelectItem>
                        {OMP_API_TYPES.map((apiType) => (
                          <SelectItem key={apiType} value={apiType}>{apiType}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <FormFieldLabel htmlFor="omp-transport" label="transport" hint="流式传输覆盖；目前仅支持 pi-native" />
                    <Select
                      value={fields.transport || "__none__"}
                      onValueChange={(value) => updateField({ transport: value === "__none__" ? "" : value })}
                    >
                      <SelectTrigger id="omp-transport" className="w-full">
                        <SelectValue placeholder="默认（不覆盖）" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">默认（不覆盖）</SelectItem>
                        <SelectItem value="pi-native">pi-native</SelectItem>
                        {fields.transport && fields.transport !== "pi-native" && (
                          <SelectItem value={fields.transport}>{fields.transport}</SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </FormSection>

              <FormSection title="鉴权">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <FormFieldLabel htmlFor="omp-auth" label="鉴权模式 (auth)" hint="apiKey=需要秘钥；none=免 key；oauth=OAuth 流程" />
                    <Select value={fields.auth} onValueChange={(value) => updateField({ auth: value as "apiKey" | "none" | "oauth" })}>
                      <SelectTrigger id="omp-auth" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="apiKey">apiKey（默认）</SelectItem>
                        <SelectItem value="none">none（免 key）</SelectItem>
                        <SelectItem value="oauth">oauth</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {fields.auth === "apiKey" && (
                    <div className="flex flex-col gap-1.5">
                      <FormFieldLabel htmlFor="omp-api-key" label="秘钥 *" hint="provider.apiKey；普通字符串先查环境变量；!cmd 执行命令" />
                      <div className="relative">
                        <Input
                          id="omp-api-key"
                          type={showKey ? "text" : "password"}
                          value={fields.apiKey}
                          onChange={(event) => updateField({ apiKey: event.target.value })}
                          className="pr-9"
                          placeholder="MY_API_KEY 或 sk-..."
                        />
                        <button
                          type="button"
                          onClick={() => setShowKey((value) => !value)}
                          aria-label={showKey ? "隐藏密钥" : "查看密钥"}
                          className="absolute inset-y-0 right-0 flex items-center px-2.5 text-ink-mute hover:text-ink-secondary"
                        >
                          {showKey ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <FormFieldLabel label="请求头 (headers)" hint="附加请求头；值解析规则同 apiKey" />
                  <KeyValueEditor
                    value={fields.headers}
                    onChange={(next) => updateField({ headers: next })}
                    keyPlaceholder="Header 名"
                    valuePlaceholder="值（环境变量名 / !cmd / 字面量）"
                    addLabel="新增 header"
                  />
                </div>

                <SwitchRow
                  label="authHeader"
                  description="为非标准 API 注入 Authorization: Bearer <key>"
                  checked={fields.authHeader}
                  onCheckedChange={(c) => updateField({ authHeader: c })}
                />
                <SwitchRow
                  label="disableStrictTools"
                  description="provider 级禁用 strict tool schema，服务兼容性差的代理"
                  checked={fields.disableStrictTools}
                  onCheckedChange={(c) => updateField({ disableStrictTools: c })}
                />
              </FormSection>

              <FormSection title="高级能力" description="整个对象可留空；开启后写入 provider JSON">
                <DiscoveryEditor value={fields.discovery} onChange={(next) => updateField({ discovery: next })} />
                <RemoteCompactionEditor value={fields.remoteCompaction} onChange={(next) => updateField({ remoteCompaction: next })} />
              </FormSection>

              <FormSection
                title="模型列表"
                description={fields.models.length > 0 ? `共 ${fields.models.length} 个模型` : "provider.models[]"}
                actions={
                  <div className="flex items-center gap-2">
                    {fields.subTab === "custom" && (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        disabled={fetchModelsMutation.isPending || !fields.baseUrl}
                        onClick={() => fetchModelsMutation.mutate()}
                      >
                        <RefreshCwIcon className={cn("size-3", fetchModelsMutation.isPending && "animate-spin")} />
                        拉取模型
                      </Button>
                    )}
                    <Button type="button" variant="outline" size="xs" onClick={addModel}>
                      <PlusIcon className="size-3" />
                      新增模型
                    </Button>
                  </div>
                }
              >
                {fields.models.length === 0 ? (
                  <button
                    type="button"
                    onClick={addModel}
                    className="rounded-md border border-dashed border-edge px-3 py-4 text-center text-xs text-ink-mute transition-colors hover:border-edge-strong hover:text-ink-secondary"
                  >
                    暂无模型，点击添加；端点模式下可从网关公布的模型中挑选 id
                  </button>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {fields.models.map((model, modelIndex) => (
                      <li key={modelIndex} className="rounded-md border border-edge">
                        <div className="flex items-center gap-2 px-2.5 py-2">
                          <ModelCombobox
                            className="min-w-0 flex-1"
                            value={model.id}
                            onChange={(value) => updateModel(modelIndex, { id: value })}
                            options={modelOptions}
                            placeholder="模型 id *（如 gpt-5.5）"
                          />
                          <Input
                            value={model.name}
                            onChange={(event) => updateModel(modelIndex, { name: event.target.value })}
                            placeholder="显示名（可留空同 id）"
                            className="w-40 shrink-0"
                          />
                          <label className="flex shrink-0 cursor-pointer items-center gap-1 text-xs text-ink-mute">
                            <Switch checked={model.reasoning} onCheckedChange={(c) => updateModel(modelIndex, { reasoning: c })} />
                            推理
                          </label>
                          <button
                            type="button"
                            aria-label={expandedModel === modelIndex ? "收起高级字段" : "展开高级字段"}
                            aria-expanded={expandedModel === modelIndex}
                            onClick={() => setExpandedModel(expandedModel === modelIndex ? null : modelIndex)}
                            className="shrink-0 rounded p-1 text-ink-mute transition-colors hover:bg-surface-hover hover:text-ink-secondary"
                          >
                            <ChevronDownIcon className={cn("size-4 transition-transform", expandedModel === modelIndex && "rotate-180")} />
                          </button>
                          <button
                            type="button"
                            aria-label="删除模型"
                            className="shrink-0 rounded p-1 text-ink-mute transition-colors hover:bg-surface-hover hover:text-destructive"
                            onClick={() => removeModel(modelIndex)}
                          >
                            <Trash2Icon className="size-3.5" />
                          </button>
                        </div>
                        {expandedModel === modelIndex && <ModelAdvancedFields model={model} modelIndex={modelIndex} updateModel={updateModel} toggleInput={toggleInput} />}
                      </li>
                    ))}
                  </ul>
                )}
              </FormSection>

              <FormSection
                title="默认模型"
                description="写入 config.yml 的 modelRoles.default，「应用」后生效"
                actions={
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    disabled={!selectedProviderCanBeDefault}
                    onClick={setSelectedProviderAsDefault}
                  >
                    设为默认
                  </Button>
                }
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <MiniField label="默认模型（当前渠道）">
                    <ModelCombobox
                      value={defaultProvider === providerId ? defaultModel : ""}
                      onChange={(nextModel) => {
                        setDefaultProvider(providerId);
                        setDefaultModel(nextModel);
                      }}
                      options={providerModelIds}
                      placeholder={selectedProviderCanBeDefault ? "选择当前渠道模型" : "当前渠道没有可选模型"}
                    />
                  </MiniField>
                  <MiniField label="thinkingLevel（默认推理档位）">
                    <Select
                      value={thinkingLevel || "__none__"}
                      onValueChange={(value) => setThinkingLevel(value === "__none__" ? "" : value)}
                    >
                      <SelectTrigger className="w-full"><SelectValue placeholder="留空" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">留空</SelectItem>
                        {OMP_THINKING_LEVELS.map((level) => (
                          <SelectItem key={level} value={level}>{level}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </MiniField>
                </div>
                {!selectedProviderCanBeDefault && (
                  <p className="text-xs text-ink-mute">只有启用且 provider.models 中声明了具体模型的渠道才能设为默认。</p>
                )}
                <p className="text-xs text-ink-mute">
                  当前默认：
                  {currentSelector ? (
                    <span className="font-medium text-ink-secondary">{currentSelector}</span>
                  ) : (
                    "未设置"
                  )}
                  {defaultProvider && defaultProvider !== providerId && `（来自渠道 ${defaultProvider}）`}
                </p>
              </FormSection>
            </>
          )}
        </div>

        <div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-2 overflow-hidden rounded-lg border border-edge bg-surface p-4">
          <div className="flex min-w-0 flex-col gap-2 overflow-hidden">
            <div className="flex items-center justify-between gap-2">
              <Label>配置文件</Label>
              <div className="flex shrink-0 items-center gap-3">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!canEditRight || !rightEditable}
                  onClick={() => {
                    try {
                      onProviderTextChange(formatProviderJson(parseProviderJsonText(providerText)));
                    } catch {
                      toast.error("JSON 格式错误，无法格式化");
                    }
                  }}
                >
                  格式化
                </Button>
                <label
                  className="flex items-center gap-1.5 text-xs text-ink-mute"
                  title={canEditRight ? undefined : "仅 Profile 页支持编辑；汇总文件由「应用」生成"}
                >
                  <Switch checked={rightEditable} disabled={!canEditRight} onCheckedChange={setRightEditable} />
                  可编辑
                </label>
              </div>
            </div>
            <FileTabStrip value={rightTab} tabs={fileTabs} onChange={onSelectFileTab} />
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<EditorFallback />}>
              <JsonEditor
                value={rightText}
                theme={theme}
                lang={rightLanguage}
                readOnly={!canEditRight || !rightEditable}
                fill
                highlightPatterns={rightTab === "settings" ? ["default", "defaultProvider", "defaultModel", "thinkingLevel"] : []}
                onChange={(nextText) => {
                  if (rightTab === "provider") onProviderTextChange(nextText);
                }}
              />
            </Suspense>
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-center gap-3 rounded-lg border border-edge bg-surface px-4 py-3">
        <span className="absolute left-4 hidden text-xs text-ink-mute md:block">
          应用后写入 models.yml / config.yml
        </span>
        {dirty && <span className="absolute right-4 hidden text-xs text-amber-500 sm:block">有未保存的修改</span>}
        <Button variant="ghost" disabled={!loaded || !dirty} onClick={discardChanges}>
          放弃修改
        </Button>
        <Button variant="outline" disabled={!canSave || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending && <Loader2Icon className="animate-spin" />}
          保存渠道
        </Button>
        <Button
          disabled={applyMutation.isPending || saveMutation.isPending || (loaded && !canSave)}
          onClick={() => applyMutation.mutate()}
        >
          {applyMutation.isPending && <Loader2Icon className="animate-spin" />}
          应用
        </Button>
      </div>

      <RenameProviderDialog
        open={renameOpen}
        oldId={selectedId ?? providerId}
        existingIds={providers.map((provider) => provider.id)}
        pending={renameMutation.isPending}
        onCancel={() => setRenameOpen(false)}
        onConfirm={(newId) => renameMutation.mutate({ oldId: selectedId ?? providerId, newId })}
      />

      <Dialog open={pendingNavigation !== null} onOpenChange={(open) => !open && setPendingNavigation(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>未保存的修改</DialogTitle>
            <DialogDescription>
              当前渠道「{providerId}」有未保存的修改，离开后修改将丢失。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingNavigation(null)}>留在当前</Button>
            <Button
              variant="destructive"
              onClick={() => {
                pendingNavigation?.();
                setPendingNavigation(null);
              }}
            >
              放弃修改并离开
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除渠道</DialogTitle>
            <DialogDescription>
              将删除拆分文件，并从真实汇总文件中移除「{pendingDelete?.name}」。
              如果它是当前默认渠道，也会清理默认模型字段。该操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>取消</Button>
            <Button
              variant="destructive"
              disabled={!pendingDelete || deleteMutation.isPending}
              onClick={() => pendingDelete && deleteMutation.mutate(pendingDelete.id)}
            >
              {deleteMutation.isPending && <Loader2Icon className="animate-spin" />}
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ModelAdvancedFields({
  model,
  modelIndex,
  updateModel,
  toggleInput,
}: {
  model: OmpModelFields;
  modelIndex: number;
  updateModel: (index: number, patch: Partial<OmpModelFields>) => void;
  toggleInput: (index: number, inputType: "text" | "image", checked: boolean) => void;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-edge bg-surface-raised/30 px-3 py-3">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <MiniField label="上下文窗口 contextWindow">
          <Input
            type="number"
            value={model.contextWindow}
            onChange={(e) => updateModel(modelIndex, { contextWindow: Number(e.target.value) || 0 })}
            className="h-8"
          />
        </MiniField>
        <MiniField label="最大输出 maxTokens">
          <Input
            type="number"
            value={model.maxTokens ?? ""}
            onChange={(e) => updateModel(modelIndex, { maxTokens: e.target.value === "" ? null : Number(e.target.value) || null })}
            placeholder="留空用默认"
            className="h-8"
          />
        </MiniField>
        <MiniField label="单模型 api（留空继承 provider）">
          <Input value={model.api} onChange={(e) => updateModel(modelIndex, { api: e.target.value })} placeholder="留空继承" className="h-8" />
        </MiniField>
        <MiniField label="单模型 baseUrl（留空继承 provider）">
          <Input value={model.baseUrl} onChange={(e) => updateModel(modelIndex, { baseUrl: e.target.value })} placeholder="留空继承" className="h-8" />
        </MiniField>
        <MiniField label="premiumMultiplier（premium 计费倍数）">
          <Input
            type="number"
            step="0.01"
            value={model.premiumMultiplier ?? ""}
            onChange={(e) => updateModel(modelIndex, { premiumMultiplier: e.target.value === "" ? null : Number(e.target.value) || null })}
            placeholder="留空"
            className="h-8"
          />
        </MiniField>
        <MiniField label="contextPromotionTarget（promotion 切换模型）">
          <Input value={model.contextPromotionTarget} onChange={(e) => updateModel(modelIndex, { contextPromotionTarget: e.target.value })} placeholder="模型 id" className="h-8" />
        </MiniField>
        <MiniField label="compactionModel（专用 compaction 模型）">
          <Input value={model.compactionModel} onChange={(e) => updateModel(modelIndex, { compactionModel: e.target.value })} placeholder="模型 id" className="h-8" />
        </MiniField>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-ink-secondary">
        <label className="flex cursor-pointer items-center gap-1.5" title="input 含 image；text 恒开启">
          <Switch checked={model.input.includes("image")} onCheckedChange={(c) => toggleInput(modelIndex, "image", c)} />
          图片输入
        </label>
        <label className="flex cursor-pointer items-center gap-1.5" title="supportsTools=false 明确禁用工具；关闭则省略该字段（默认可用）">
          <Switch
            checked={model.supportsTools === false}
            onCheckedChange={(c) => updateModel(modelIndex, { supportsTools: c ? false : null })}
          />
          禁用工具调用
        </label>
        <label className="flex cursor-pointer items-center gap-1.5" title="omitMaxOutputTokens：出站请求省略 max output tokens 字段">
          <Switch
            checked={model.omitMaxOutputTokens}
            onCheckedChange={(c) => updateModel(modelIndex, { omitMaxOutputTokens: c })}
          />
          请求省略 maxTokens
        </label>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-mute">成本（美元 / 百万 token）</span>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["input", "output", "cacheRead", "cacheWrite"] as const).map((key) => (
            <MiniField key={key} label={key}>
              <Input
                type="number"
                step="0.01"
                value={model.cost[key]}
                onChange={(e) => updateModel(modelIndex, { cost: { ...model.cost, [key]: Number(e.target.value) || 0 } })}
                className="h-8"
              />
            </MiniField>
          ))}
        </div>
      </div>

      <ThinkingObjectEditor value={model.thinking} onChange={(next) => updateModel(modelIndex, { thinking: next })} />
      <RemoteCompactionEditor
        title="模型级 remoteCompaction"
        value={model.remoteCompaction}
        onChange={(next) => updateModel(modelIndex, { remoteCompaction: next })}
      />

      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-mute">模型请求头 (headers)</span>
        <KeyValueEditor
          value={model.headers}
          onChange={(next) => updateModel(modelIndex, { headers: next })}
          keyPlaceholder="Header 名"
          valuePlaceholder="值"
          addLabel="新增 header"
        />
      </div>
    </div>
  );
}
