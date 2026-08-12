import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** key-value 字符串表编辑器，用于 headers 等结构化字段。空键值对自动忽略。 */
export function KeyValueEditor({
  value,
  onChange,
  keyPlaceholder = "键",
  valuePlaceholder = "值",
  addLabel = "新增一行",
}: {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}) {
  const entries = Object.entries(value);
  const update = (index: number, patch: { key?: string; value?: string }) => {
    const next = entries.map(([k, v], i) =>
      i === index
        ? [patch.key ?? k, patch.value ?? v]
        : [k, v],
    ) as Array<[string, string]>;
    const out: Record<string, string> = {};
    for (const [k, v] of next) {
      if (k) out[k] = v;
    }
    onChange(out);
  };
  const remove = (index: number) => {
    const next = entries.filter((_, i) => i !== index);
    const out: Record<string, string> = {};
    for (const [k, v] of next) out[k] = v;
    onChange(out);
  };
  const add = () => {
    // 找一个不冲突的临时空键
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
      {entries.length === 0 ? (
        <p className="text-xs text-ink-mute">暂无条目</p>
      ) : (
        entries.map(([k, v], index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Input
              value={k}
              onChange={(e) => update(index, { key: e.target.value })}
              placeholder={keyPlaceholder}
              className="h-7 flex-1"
            />
            <Input
              value={v}
              onChange={(e) => update(index, { value: e.target.value })}
              placeholder={valuePlaceholder}
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
        {addLabel}
      </Button>
    </div>
  );
}
