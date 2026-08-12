import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { OMP_THINKING_MODES } from "@/lib/ompConfig";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { OmpThinking } from "@/lib/ompConfig";
import { MiniField, ObjectToggleCard } from "./FormSection";

const OMP_EFFORT_LEVELS = ["minimal", "low", "medium", "high", "xhigh", "max"] as const;

/** OMP thinking 对象编辑器：开关卡片 + mode/defaultLevel + 每档「efforts 开关 + effortMap 映射值」合并行。 */
export function ThinkingObjectEditor({
  value,
  onChange,
}: {
  value: OmpThinking | null;
  onChange: (next: OmpThinking | null) => void;
}) {
  const update = (patch: Partial<OmpThinking>) => {
    if (value) onChange({ ...value, ...patch });
  };

  const toggleEffort = (level: string, on: boolean) => {
    if (!value) return;
    const set = new Set(value.efforts);
    if (on) set.add(level);
    else set.delete(level);
    update({ efforts: OMP_EFFORT_LEVELS.filter((l) => set.has(l)) });
  };

  const updateEffortMap = (key: string, val: string) => {
    if (!value) return;
    const next = { ...value.effortMap };
    if (val) next[key] = val;
    else delete next[key];
    update({ effortMap: next });
  };

  return (
    <ObjectToggleCard
      title="thinking"
      description="思考能力元数据（OMP 用它取代 Pi 的 thinkingLevelMap）"
      enabled={value !== null}
      onToggle={(enabled) =>
        onChange(
          enabled
            ? { mode: "effort", efforts: [], effortMap: {}, defaultLevel: "", supportsDisplay: false }
            : null,
        )
      }
    >
      <div className="grid gap-2.5 sm:grid-cols-2">
        <MiniField label="mode（思考模式）">
          <Select value={value?.mode || "__none__"} onValueChange={(v) => update({ mode: v === "__none__" ? "" : v })}>
            <SelectTrigger size="sm" className="h-8 w-full text-xs">
              <SelectValue placeholder="未指定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">未指定</SelectItem>
              {OMP_THINKING_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </MiniField>
        <MiniField label="defaultLevel（默认档位）">
          <Input
            value={value?.defaultLevel ?? ""}
            onChange={(e) => update({ defaultLevel: e.target.value })}
            placeholder="如 high"
            className="h-8"
          />
        </MiniField>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-ink-mute">
          档位：开关 = 加入 efforts；右侧输入 = effortMap 映射到 provider wire value（留空不映射）
        </span>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {OMP_EFFORT_LEVELS.map((level) => (
            <div key={level} className="flex items-center gap-2 rounded-md border border-edge-subtle px-2 py-1.5">
              <Switch
                checked={value?.efforts.includes(level) ?? false}
                onCheckedChange={(c) => toggleEffort(level, c)}
              />
              <span className="w-14 shrink-0 text-xs text-ink-secondary">{level}</span>
              <Input
                value={value?.effortMap[level] ?? ""}
                onChange={(e) => updateEffortMap(level, e.target.value)}
                placeholder="wire value"
                className="h-7 flex-1 text-xs"
              />
            </div>
          ))}
        </div>
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-ink-secondary">
        <Switch
          checked={value?.supportsDisplay ?? false}
          onCheckedChange={(c) => update({ supportsDisplay: c })}
        />
        supportsDisplay（支持显示 thinking 内容）
      </label>
    </ObjectToggleCard>
  );
}
