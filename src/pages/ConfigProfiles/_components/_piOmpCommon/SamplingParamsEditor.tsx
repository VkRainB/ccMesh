import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Pi samplingParams 编辑器：key-value 表，值作为字符串存储（标量、null、对象统一以字符串表达）。 */
export function SamplingParamsEditor({
  value,
  onChange,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const entries = Object.entries(value);

  const update = (index: number, patch: { key?: string; value?: string }) => {
    const next = entries.map(([k, v], i) => {
      if (i !== index) return [k, v] as [string, unknown];
      const newKey = patch.key ?? k;
      const newValue = patch.value !== undefined ? parseValue(patch.value) : v;
      return [newKey, newValue] as [string, unknown];
    });
    const out: Record<string, unknown> = {};
    for (const [k, v] of next) {
      if (k) out[k] = v;
    }
    onChange(out);
  };
  const remove = (index: number) => {
    const next = entries.filter((_, i) => i !== index);
    const out: Record<string, unknown> = {};
    for (const [k, v] of next) out[k] = v;
    onChange(out);
  };
  const add = () => {
    let baseKey = "";
    let i = 0;
    while (entries.some(([k]) => k === baseKey)) {
      i += 1;
      baseKey = `key${i}`;
    }
    onChange({ ...value, [baseKey]: "" });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-ink-mute">采样参数（值支持数字/true/false/null/字符串）</span>
      {entries.length === 0 ? (
        <p className="text-xs text-ink-mute">暂无参数</p>
      ) : (
        entries.map(([k, v], index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Input
              value={k}
              onChange={(e) => update(index, { key: e.target.value })}
              placeholder="键"
              className="h-7 flex-1"
            />
            <Input
              value={formatValue(v)}
              onChange={(e) => update(index, { value: e.target.value })}
              placeholder="值（数字/true/false/null/字符串）"
              className="h-7 flex-1"
            />
            <button
              type="button"
              aria-label="删除该行"
              onClick={() => remove(index)}
              className="shrink-0 text-ink-mute hover:text-destructive"
            >
              <Trash2Icon className="size-3.5" />
            </button>
          </div>
        ))
      )}
      <Button type="button" variant="outline" size="xs" onClick={add} className="w-fit">
        <PlusIcon className="size-3" />
        新增参数
      </Button>
    </div>
  );
}

function formatValue(v: unknown): string {
  if (v === null) return "null";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function parseValue(s: string): unknown {
  const trimmed = s.trim();
  if (trimmed === "null") return null;
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  const num = Number(trimmed);
  if (trimmed !== "" && Number.isFinite(num)) return num;
  return s;
}
