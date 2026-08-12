import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { OMP_DISCOVERY_TYPES } from "@/lib/ompConfig";
import type { OmpDiscovery } from "@/lib/ompConfig";
import { MiniField, ObjectToggleCard } from "./FormSection";

/** OMP discovery 编辑器：开关卡片 + type/timeoutMs。 */
export function DiscoveryEditor({
  value,
  onChange,
}: {
  value: OmpDiscovery | null;
  onChange: (next: OmpDiscovery | null) => void;
}) {
  const update = (patch: Partial<OmpDiscovery>) => {
    if (value) onChange({ ...value, ...patch });
  };

  return (
    <ObjectToggleCard
      title="discovery"
      description="动态模型发现：启动时从该地址拉取可用模型列表"
      enabled={value !== null}
      onToggle={(enabled) => onChange(enabled ? { type: "proxy", timeoutMs: null } : null)}
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <MiniField label="type（发现适配器）">
          <Select value={value?.type || "__none__"} onValueChange={(v) => update({ type: v === "__none__" ? "" : v })}>
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue placeholder="未指定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">未指定</SelectItem>
              {OMP_DISCOVERY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MiniField>
        <MiniField label="timeoutMs（发现请求超时）">
          <Input
            type="number"
            value={value?.timeoutMs ?? ""}
            onChange={(e) => update({ timeoutMs: e.target.value === "" ? null : Number(e.target.value) || null })}
            placeholder="留空用适配器默认"
            className="h-8"
          />
        </MiniField>
      </div>
      <p className="text-xs text-ink-mute">非 proxy 类型时 provider 通常还需要配置 api 类型。</p>
    </ObjectToggleCard>
  );
}
