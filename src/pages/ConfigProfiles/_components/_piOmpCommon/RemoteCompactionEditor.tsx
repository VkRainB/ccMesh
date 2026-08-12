import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { OmpRemoteCompaction } from "@/lib/ompConfig";
import { MiniField, ObjectToggleCard } from "./FormSection";

const EMPTY_REMOTE_COMPACTION: OmpRemoteCompaction = {
  enabled: false,
  api: "",
  endpoint: "",
  v2StreamingEnabled: false,
  v2Endpoint: "",
  streamingEndpoint: "",
  model: "",
};

/** OMP remoteCompaction 编辑器：开关卡片 + enabled/api/endpoint/v2*/
export function RemoteCompactionEditor({
  value,
  onChange,
  title = "remoteCompaction",
}: {
  value: OmpRemoteCompaction | null;
  onChange: (next: OmpRemoteCompaction | null) => void;
  title?: string;
}) {
  const update = (patch: Partial<OmpRemoteCompaction>) => {
    if (value) onChange({ ...value, ...patch });
  };

  return (
    <ObjectToggleCard
      title={title}
      description="provider 原生上下文压缩（compaction）端点设置"
      enabled={value !== null}
      onToggle={(enabled) => onChange(enabled ? { ...EMPTY_REMOTE_COMPACTION } : null)}
    >
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-secondary">
          <Switch checked={value?.enabled ?? false} onCheckedChange={(c) => update({ enabled: c })} />
          enabled（启用原生 compaction）
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-secondary">
          <Switch
            checked={value?.v2StreamingEnabled ?? false}
            onCheckedChange={(c) => update({ v2StreamingEnabled: c })}
          />
          v2StreamingEnabled（Responses-stream V2）
        </label>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <MiniField label="api（compaction 端点协议）">
          <Input value={value?.api ?? ""} onChange={(e) => update({ api: e.target.value })} placeholder="如 openai-responses" className="h-8" />
        </MiniField>
        <MiniField label="model（compaction 模型 id）">
          <Input value={value?.model ?? ""} onChange={(e) => update({ model: e.target.value })} placeholder="留空用当前模型" className="h-8" />
        </MiniField>
        <MiniField label="endpoint（V1 compact 端点）">
          <Input value={value?.endpoint ?? ""} onChange={(e) => update({ endpoint: e.target.value })} placeholder="/responses/compact" className="h-8" />
        </MiniField>
        <MiniField label="v2Endpoint（V2 端点）">
          <Input value={value?.v2Endpoint ?? ""} onChange={(e) => update({ v2Endpoint: e.target.value })} placeholder="V2 endpoint" className="h-8" />
        </MiniField>
        <MiniField label="streamingEndpoint（无 V2 时的 streaming 端点）" className="sm:col-span-2">
          <Input value={value?.streamingEndpoint ?? ""} onChange={(e) => update({ streamingEndpoint: e.target.value })} placeholder="留空则不覆盖" className="h-8" />
        </MiniField>
      </div>
    </ObjectToggleCard>
  );
}
