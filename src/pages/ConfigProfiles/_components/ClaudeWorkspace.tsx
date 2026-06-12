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
import {
  applyClaudeToggles,
  CLAUDE_TOGGLE_DEFS,
  claudeOperationFragment,
  DEFAULT_CLAUDE_TOGGLES,
  gatewayBaseUrl,
  mergeClaudeSettings,
  parseClaudeFields,
  parseClaudeToggles,
  splitOneM,
  withOneM,
  type ClaudeToggles,
} from "@/lib/toolConfig";
import { advertisedModels } from "@/services/modules/endpoint";
import { configApi } from "@/services/modules/config";
import {
  toolConfigApi,
  type ChannelMeta,
  type ClaudeOperationFields,
} from "@/services/modules/tool_config";
import { ChannelList } from "./ChannelList";
import { ModelCombobox } from "./ModelCombobox";

const JsonEditor = lazy(() => import("@/components/common/JsonEditor"));

const EMPTY: ClaudeOperationFields = {
  baseUrl: "",
  apiKey: "",
  sonnetModel: "",
  opusModel: "",
  haikuModel: "",
  defaultModel: "",
};

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const MODEL_ROWS: Array<{ key: "sonnetModel" | "opusModel" | "haikuModel"; role: string }> = [
  { key: "sonnetModel", role: "Sonnet" },
  { key: "opusModel", role: "Opus" },
  { key: "haikuModel", role: "Haiku" },
];

export function ClaudeWorkspace() {
  const qc = useQueryClient();
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const channelsQ = useToolConfigChannels("claude");
  const cfgQ = useQuery({ queryKey: ["app-config"], queryFn: configApi.getConfig });
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
  const [subTab, setSubTab] = useState<"endpoint" | "custom">("endpoint");
  const [base, setBase] = useState<unknown>({});
  const [fields, setFields] = useState<ClaudeOperationFields>(EMPTY);
  const [toggles, setToggles] = useState<ClaudeToggles>(DEFAULT_CLAUDE_TOGGLES);
  const [rightText, setRightText] = useState("");
  const [rightEditable, setRightEditable] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<ChannelMeta | null>(null);

  const [opText, setOpText] = useState("");

  const syncOp = (f: ClaudeOperationFields) =>
    setOpText(JSON.stringify(claudeOperationFragment(f), null, 2));

  /** 表单改字段：同时回写操作字段编辑器文本（避免编辑器只读反映）。 */
  const updateFields = (patch: Partial<ClaudeOperationFields>) =>
    setFields((f) => {
      const next = { ...f, ...patch };
      syncOp(next);
      return next;
    });

  /** 用户直接编辑操作字段编辑器：解析回填表单；非法 JSON 时保留输入不回填。 */
  const onOpChange = (text: string) => {
    setOpText(text);
    try {
      setFields(parseClaudeFields(JSON.parse(text)));
    } catch {
      // 保持用户输入，待 JSON 合法后再回填表单
    }
  };

  useEffect(() => {
    if (!loaded || rightEditable) return;
    const merged = applyClaudeToggles(mergeClaudeSettings(base, fields), toggles);
    setRightText(JSON.stringify(merged, null, 2));
  }, [fields, base, toggles, loaded, rightEditable]);

  const resetEditor = () => {
    setLoaded(false);
    setSelectedId(null);
    setName("");
    setFields(EMPTY);
    setToggles(DEFAULT_CLAUDE_TOGGLES);
    setOpText("");
    setRightText("");
    setRightEditable(false);
  };

  const startNew = async () => {
    try {
      const { snapshot } = await toolConfigApi.extract("claude");
      setSelectedId(null);
      setName("");
      setSubTab("endpoint");
      setBase(snapshot ?? {});
      const f = { ...parseClaudeFields(snapshot), baseUrl: gateway };
      setFields(f);
      syncOp(f);
      setToggles(parseClaudeToggles(snapshot));
      setRightEditable(false);
      setLoaded(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const loadChannel = async (id: string) => {
    try {
      const ch = await toolConfigApi.get("claude", id);
      setSelectedId(id);
      setName(ch.name);
      setSubTab("custom");
      setBase(ch.snapshot ?? {});
      const f = parseClaudeFields(ch.snapshot);
      setFields(f);
      syncOp(f);
      setToggles(parseClaudeToggles(ch.snapshot));
      setRightEditable(false);
      setLoaded(true);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const buildSnapshot = () =>
    rightEditable
      ? JSON.parse(rightText)
      : applyClaudeToggles(mergeClaudeSettings(base, fields), toggles);

  const saveCh = useMutation({
    mutationFn: async () =>
      toolConfigApi.save("claude", { id: selectedId, name, snapshot: buildSnapshot() }),
    onSuccess: (meta) => {
      toast.success("已保存渠道");
      setSelectedId(meta.id);
      qc.invalidateQueries({ queryKey: ["profile-channels", "claude"] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const applyCfg = useMutation({
    mutationFn: async () => toolConfigApi.apply("claude", buildSnapshot()),
    onSuccess: () => toast.success("已应用并覆写 ~/.claude/settings.json"),
    onError: (e) => toast.error(errMsg(e)),
  });

  const delCh = useMutation({
    mutationFn: (id: string) => toolConfigApi.remove("claude", id),
    onSuccess: (_d, id) => {
      toast.success("已删除渠道");
      if (selectedId === id) resetEditor();
      qc.invalidateQueries({ queryKey: ["profile-channels", "claude"] });
      setPendingDelete(null);
    },
    onError: (e) => {
      toast.error(errMsg(e));
      setPendingDelete(null);
    },
  });

  const setModel = (key: "sonnetModel" | "opusModel" | "haikuModel", b: string, is1m: boolean) =>
    updateFields({ [key]: withOneM(b, is1m) } as Partial<ClaudeOperationFields>);

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

        {/* 中栏：表单 + 操作字段编辑器 */}
        <div className="flex min-h-0 min-w-0 flex-[3] flex-col gap-4 overflow-y-auto rounded-lg border border-edge bg-surface p-4">
          {!loaded ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-mute">
              <FileCogIcon className="size-10 opacity-40" />
              <p className="text-sm">点击左侧「+」新增，或选择一个渠道开始编辑</p>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ch-name">渠道名称</Label>
                <Input
                  id="ch-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：渠道A"
                />
              </div>

              <Tabs
                value={subTab}
                onValueChange={(v) => {
                  const t = v as "endpoint" | "custom";
                  setSubTab(t);
                  if (t === "endpoint") updateFields({ baseUrl: gateway });
                }}
              >
                <TabsList>
                  <TabsTrigger value="endpoint">端点配置写入</TabsTrigger>
                  <TabsTrigger value="custom">自定义配置写入</TabsTrigger>
                </TabsList>
              </Tabs>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cl-base">地址（ANTHROPIC_BASE_URL）</Label>
                <Input
                  id="cl-base"
                  value={fields.baseUrl}
                  readOnly={subTab === "endpoint"}
                  onChange={(e) => updateFields({ baseUrl: e.target.value })}
                  placeholder="https://..."
                />
                {subTab === "endpoint" && (
                  <p className="px-1 text-xs text-ink-mute">端点模式：自动指向本机网关 {gateway}</p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cl-key">秘钥（ANTHROPIC_API_KEY）</Label>
                <div className="relative">
                  <Input
                    id="cl-key"
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
                <Label>模型映射（显示名只影响 /model 菜单；1M 为上下文能力声明）</Label>
                {MODEL_ROWS.map((row) => {
                  const { base: b, is1m } = splitOneM(fields[row.key]);
                  return (
                    <div key={row.key} className="flex items-center gap-2">
                      <span className="w-16 shrink-0 text-sm text-ink-secondary">{row.role}</span>
                      <ModelCombobox
                        className="flex-1"
                        value={b}
                        onChange={(v) => setModel(row.key, v, is1m)}
                        options={advertised}
                        placeholder="模型显示名"
                      />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-ink-mute">
                        <Switch
                          checked={is1m}
                          onCheckedChange={(v) => setModel(row.key, b, v)}
                        />
                        1M
                      </label>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="cl-default">默认兜底模型（ANTHROPIC_MODEL，可留空）</Label>
                <ModelCombobox
                  id="cl-default"
                  value={fields.defaultModel}
                  onChange={(v) => updateFields({ defaultModel: v })}
                  options={advertised}
                  placeholder="通常可留空"
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>配置开关</Label>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {CLAUDE_TOGGLE_DEFS.map((def) => (
                    <label
                      key={def.key}
                      className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-ink-secondary"
                    >
                      <Switch
                        checked={toggles[def.key]}
                        onCheckedChange={(v) =>
                          setToggles((t) => ({ ...t, [def.key]: v }))
                        }
                      />
                      {def.label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>操作字段（与表单双向联动，可直接编辑）</Label>
                <Suspense fallback={<EditorFallback />}>
                  <JsonEditor
                    value={opText}
                    theme={theme}
                    height="160px"
                    onChange={onOpChange}
                  />
                </Suspense>
              </div>
            </>
          )}
        </div>

        {/* 右栏：整合配置编辑器 */}
        <div className="flex min-h-0 min-w-0 flex-[2] flex-col gap-2 rounded-lg border border-edge bg-surface p-4">
          <div className="flex items-center justify-between">
            <Label>整合配置（完整 settings.json）</Label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!loaded || !rightEditable}
                onClick={() => {
                  try {
                    setRightText(JSON.stringify(JSON.parse(rightText), null, 2));
                  } catch {
                    toast.error("JSON 格式错误，无法格式化");
                  }
                }}
              >
                格式化
              </Button>
              <label className="flex items-center gap-1.5 text-xs text-ink-mute">
                <Switch
                  checked={rightEditable}
                  disabled={!loaded}
                  onCheckedChange={setRightEditable}
                />
                可编辑
              </label>
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <Suspense fallback={<EditorFallback />}>
              <JsonEditor
                value={rightText}
                theme={theme}
                readOnly={!rightEditable}
                fill
                onChange={setRightText}
              />
            </Suspense>
          </div>
        </div>
      </div>

      {/* 底部固定操作区 */}
      <div className="relative flex items-center justify-center gap-3 rounded-lg border border-edge bg-surface px-4 py-3">
        <span className="absolute left-4 hidden text-xs text-ink-mute md:block">
          应用将先备份再覆写 <code>~/.claude/settings.json</code>
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
    <div className="flex h-[160px] items-center justify-center text-xs text-ink-mute">
      加载编辑器…
    </div>
  );
}
