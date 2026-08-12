import { PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PiCostTier } from "@/lib/piConfig";

/** Pi cost.tiers 编辑器：分层价格数组。 */
export function CostTiersEditor({
  value,
  onChange,
}: {
  value: PiCostTier[];
  onChange: (next: PiCostTier[]) => void;
}) {
  const update = (index: number, patch: Partial<PiCostTier>) => {
    onChange(value.map((tier, i) => (i === index ? { ...tier, ...patch } : tier)));
  };
  const remove = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
  };
  const add = () => {
    onChange([...value, { inputTokensAbove: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-ink-mute">分层价格（超过 inputTokensAbove 阈值后使用该 tier）</span>
      {value.length === 0 ? (
        <p className="text-xs text-ink-mute">暂无分层</p>
      ) : (
        value.map((tier, index) => (
          <div key={index} className="flex flex-wrap items-center gap-1.5 rounded-md border border-edge px-2 py-1.5">
            <label className="flex items-center gap-1 text-xs">
              <span className="text-ink-mute">阈值</span>
              <Input
                type="number"
                value={tier.inputTokensAbove}
                onChange={(e) => update(index, { inputTokensAbove: Number(e.target.value) || 0 })}
                className="h-7 w-24"
              />
            </label>
            {(["input", "output", "cacheRead", "cacheWrite"] as const).map((key) => (
              <label key={key} className="flex items-center gap-1 text-xs">
                <span className="text-ink-mute">{key}</span>
                <Input
                  type="number"
                  step="0.01"
                  value={tier[key]}
                  onChange={(e) => update(index, { [key]: Number(e.target.value) || 0 })}
                  className="h-7 w-20"
                />
              </label>
            ))}
            <button
              type="button"
              aria-label="删除该 tier"
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
        新增分层
      </Button>
    </div>
  );
}
