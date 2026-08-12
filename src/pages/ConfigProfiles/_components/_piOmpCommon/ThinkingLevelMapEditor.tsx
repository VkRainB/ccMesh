import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { PI_THINKING_LEVELS } from "@/lib/piConfig";

/** Pi thinkingLevelMap 编辑器：每档一个开关 + 字符串值；null 表示隐藏该档。 */
export function ThinkingLevelMapEditor({
  value,
  onChange,
}: {
  value: Record<string, string | null>;
  onChange: (next: Record<string, string | null>) => void;
}) {
  const update = (level: string, enabled: boolean, levelValue: string) => {
    const next = { ...value };
    if (!enabled) {
      next[level] = null;
    } else {
      next[level] = levelValue || level;
    }
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-ink-mute">
        思考档位映射 thinkingLevelMap：开关 = 开放该档；右侧输入 = 映射到 provider 值（关闭写入 null 隐藏该档）
      </span>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {PI_THINKING_LEVELS.map((level) => {
          const current = value[level];
          const enabled = current !== undefined && current !== null;
          const levelValue = current ?? "";
          return (
            <div key={level} className="flex items-center gap-2 rounded-md border border-edge-subtle px-2 py-1.5">
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => update(level, checked, levelValue)}
              />
              <span className="w-14 shrink-0 text-xs text-ink-secondary">{level}</span>
              <Input
                value={levelValue}
                onChange={(e) => update(level, enabled, e.target.value)}
                placeholder={level}
                disabled={!enabled}
                className="h-7 flex-1 text-xs"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
