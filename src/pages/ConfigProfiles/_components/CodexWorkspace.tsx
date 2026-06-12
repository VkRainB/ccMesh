import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { EyeIcon, EyeOffIcon, FileCogIcon } from "lucide-react";
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
import { useEndpoints } from "@/hooks/useEndpoints";
import { useToolConfigChannels } from "@/hooks/useToolConfigChannels";
import { gatewayBaseUrl } from "@/lib/toolConfig";
import { advertisedModels } from "@/services/modules/endpoint";
import { configApi } from "@/services/modules/config";
import {
  toolConfigApi,
  type ChannelMeta,
  type CodexOperationFields,
  type CodexSnapshot,
} from "@/services/modules/tool_config";
import { ChannelList } from "./ChannelList";

const JsonEditor = lazy(() => import("@/components/common/JsonEditor"));

const EMPTY: CodexOperationFields = {
  apiKey: "",
  baseUrl: "",
  model: "",
  reviewModel: "",
};

/** 源缺失时的 config.toml 模板（来自需求文档）。 */
const DEFAULT_CODEX_TOML = `model_provider = "OpenAI"
model = "gpt-5.5"
review_model = "gpt-5.5"
model_reasoning_effort = "high"
disable_response_storage = true
model_context_window = 1000000
model_auto_compact_token_limit = 900000

[model_providers.OpenAI]
requires_openai_auth = true
wire_api = "responses"
base_url = "http://127.0.0.1:3000/v1"
name = "OpenAI"
`;

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function CodexWorkspace() {
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const channelsQ = useToolConfigChannels("codex");
  const cfgQ = useQuery({ queryKey: ["app-config"], queryFn: configApi.getConfig });
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

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [name, setName] = useState("");
  const [subTab, setSubTab] = useState<"endpoint" | "custom">("endpoint");
  const [base, setBase] = useState<CodexSnapshot>({ auth: {}, configToml: "" });
  const [fields, setFields] = useState<CodexOperationFields>(EMPTY);
  const [rightText, setRightText] = useState("");
  const [rightEditable, setRightEditable] = useState(false);
  const [goalMode, setGoalMode] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChannelMeta | null>(null);

  const authText = useMemo(() => {
    const auth: Record<string, unknown> = { ...(base.auth ?? {}) };
    if (fields.apiKey) auth.OPENAI_API_KEY = fields.apiKey;
    else delete auth.OPENAI_API_KEY;
    return JSON.stringify(auth, null, 2);
  }, [base.auth, fields.apiKey]);

  useEffect(() => {
    if (!loaded || rightEditable) return;
    let cancelled = false;
    const t = setTimeout(() => {
      toolConfigApi
        .previewCodex(base.configToml ?? "", fields, goalMode)
        .then((toml) => {
          if (!cancelled) setRightText(toml);
        })
        .catch((e) => {
          if (!cancelled) toast.error(errMsg(e));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [fields, base, goalMode, loaded, rightEditable]);

  const readGoals = (cfg: unknown): boolean =>
    Boolean((cfg as { features?: { goals?: unknown } } | null)?.features?.goals);

  const resetEditor = () => {
    setLoaded(false);
    setSelectedId(null);
    setName("");
    setFields(EMPTY);
    setGoalMode(false);
    setRightText("");
    setRightEditable(false);
  };

  const startNew = async () => {
    try {
      const { snapshot } = await toolConfigApi.extract("codex");
      const snap = (snapshot as CodexSnapshot) ?? { auth: {}, configToml: "" };
      const configToml = snap.configToml?.trim() ? snap.configToml : DEFAULT_CODEX_TOML;
      const baseSnap: CodexSnapshot = {
        auth: snap.auth ?? {},
        configToml,
        config: snap.config,
      };
      setBase(baseSnap);
      setSelectedId(null);
      setName("");
      setSubTab("endpoint");
      const f = await toolConfigApi.parseCodex(baseSnap.auth, baseSnap.configToml);
      setFields({ ...f, baseUrl: gateway });
      setGoalMode(readGoals(baseSnap.config));
      setRightEditable(false);
      setLoaded(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const loadChannel = async (id: string) => {
    try {
      const ch = await toolConfigApi.get("codex", id);
      const snap = (ch.snapshot as CodexSnapshot) ?? { auth: {}, configToml: "" };
      setBase({ auth: snap.auth ?? {}, configToml: snap.configToml ?? "", config: snap.config });
      setSelectedId(id);
      setName(ch.name);
      setSubTab("custom");
      const f = await toolConfigApi.parseCodex(snap.auth ?? {}, snap.configToml ?? "");
      setFields(f);
      setGoalMode(readGoals(snap.config));
      setRightEditable(false);
      setLoaded(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const buildAuth = (): Record<string, unknown> => {
    const auth: Record<string, unknown> = { ...(base.auth ?? {}) };
    if (fields.apiKey) auth.OPENAI_API_KEY = fields.apiKey;
    else delete auth.OPENAI_API_KEY;
    return auth;
  };

  const saveCh = useMutation({
    mutationFn: async () =>
      toolConfigApi.save("codex", {
        id: selectedId,
        name,
        snapshot: { auth: buildAuth(), configToml: rightText, config: base.config },
      }),
    onSuccess: (meta) => {
      toast.success("已保存渠道");
      setSelectedId(meta.id);
      qc.invalidateQueries({ queryKey: ["profile-channels", "codex"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const applyCfg = useMutation({
    mutationFn: async () =>
      toolConfigApi.apply("codex", { auth: buildAuth(), configToml: rightText }),
    onSuccess: () => toast.success("已应用并覆写 ~/.codex/auth.json + config.toml"),
    onError: (e) => toast.error(errMsg(e)),
  });

  const delCh = useMutation({
    mutationFn: (id: string) => toolConfigApi.remove("codex", id),
    onSuccess: (_d, id) => {
      toast.success("已删除渠道");
      if (selectedId === id) resetEditor();
      qc.invalidateQueries({ queryKey: ["profile-channels", "codex"] });
      setPendingDelete(null);
    },
    onError: (e) => {
      toast.error(errMsg(e));
      setPendingDelete(null);
    },
  });

  const canSubmit = loaded && name.trim().length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex min-h-0 flex-1 gap-3">
        <ChannelList
          channels={channelsQ.data ?? []}
          loading={channelsQ.isLoading}
          selectedId={selectedId}
          onSelect={loadChannel}
          onNew={startNew}
          onDelete={(ch) => setPendingDelete(ch)}
        />

        {/* 中栏：表单 + auth.json 预览 */}
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg border border-edge bg-surface p-4">
          {!loaded ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-mute">
              <FileCogIcon className="size-10 opacity-40" />
              <p className="text-sm">点击左侧「+」新增，或选择一个渠道开始编辑</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cx-name">渠道名称</Label>
                <Input
                  id="cx-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：渠道M"
                />
              </div>

              <Tabs
                value={subTab}
                onValueChange={(v) => {
                  const t = v as "endpoint" | "custom";
                  setSubTab(t);
                  if (t === "endpoint") setFields((f) => ({ ...f, baseUrl: gateway }));
                }}
              >
                <TabsList>
                  <TabsTrigger value="endpoint">端点配置写入</TabsTrigger>
                  <TabsTrigger value="custom">自定义配置写入</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cx-key">秘钥（auth.json · OPENAI_API_KEY）</Label>
                <div className="relative">
                  <Input
                    id="cx-key"
                    type={showKey ? "text" : "password"}
                    value={fields.apiKey}
                    onChange={(e) => setFields((f) => ({ ...f, apiKey: e.target.value }))}
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

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cx-base">地址（base_url）</Label>
                <Input
                  id="cx-base"
                  value={fields.baseUrl}
                  readOnly={subTab === "endpoint"}
                  onChange={(e) => setFields((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder="http://127.0.0.1:3000/v1"
                />
                {subTab === "endpoint" && (
                  <p className="px-1 text-xs text-ink-mute">端点模式：自动指向本机网关 {gateway}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cx-model">默认模型（model）</Label>
                <Input
                  id="cx-model"
                  list="codex-adv-models"
                  value={fields.model}
                  onChange={(e) => setFields((f) => ({ ...f, model: e.target.value }))}
                  placeholder="gpt-5.5"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cx-review">审核模型（review_model）</Label>
                <Input
                  id="cx-review"
                  list="codex-adv-models"
                  value={fields.reviewModel}
                  onChange={(e) => setFields((f) => ({ ...f, reviewModel: e.target.value }))}
                  placeholder="gpt-5.5"
                />
              </div>

              <datalist id="codex-adv-models">
                {advertised.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>

              <div className="flex flex-col gap-2">
                <Label>配置开关</Label>
                <label className="flex items-center justify-between gap-2 text-sm text-ink-secondary">
                  <span>启用 Goal mode（features.goals）</span>
                  <Switch checked={goalMode} onCheckedChange={setGoalMode} />
                </label>
                <p className="px-1 text-xs text-ink-mute">
                  远程压缩 / 写入通用配置依赖代理命名约定与通用配置库，暂未接入。
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>auth.json（随秘钥实时联动）</Label>
                <Suspense fallback={<EditorFallback />}>
                  <JsonEditor value={authText} theme={theme} readOnly height="120px" />
                </Suspense>
              </div>
            </>
          )}
        </div>

        {/* 右栏：整合 config.toml 编辑器 */}
        <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-edge bg-surface p-4">
          <div className="flex items-center justify-between">
            <Label>整合配置（config.toml · 保留注释/模板字段）</Label>
            <label className="flex items-center gap-1.5 text-xs text-ink-mute">
              <Switch
                checked={rightEditable}
                disabled={!loaded}
                onCheckedChange={setRightEditable}
              />
              可编辑
            </label>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<EditorFallback />}>
              <JsonEditor
                value={rightText}
                theme={theme}
                lang="text"
                readOnly={!rightEditable}
                height="100%"
                onChange={setRightText}
              />
            </Suspense>
          </div>
        </div>
      </div>

      {/* 底部固定操作区 */}
      <div className="flex items-center justify-end gap-3 rounded-lg border border-edge bg-surface px-4 py-3">
        <span className="mr-auto text-xs text-ink-mute">
          应用将先备份再覆写 <code>~/.codex/auth.json</code> 与 <code>config.toml</code>
        </span>
        <Button
          variant="outline"
          disabled={!canSubmit || saveCh.isPending}
          onClick={() => saveCh.mutate()}
        >
          保存渠道
        </Button>
        <Button disabled={!loaded || applyCfg.isPending} onClick={() => applyCfg.mutate()}>
          应用
        </Button>
      </div>

      <Dialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除渠道</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-secondary">
            确定删除渠道「{pendingDelete?.name}」？该操作不可恢复（不影响已应用的真实配置文件）。
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={delCh.isPending}
              onClick={() => pendingDelete && delCh.mutate(pendingDelete.id)}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditorFallback() {
  return (
    <div className="flex h-[120px] items-center justify-center text-xs text-ink-mute">
      加载编辑器…
    </div>
  );
}
