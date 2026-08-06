import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, SearchIcon, Settings2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { getModelIcon } from "@/lib/model-icons";
import { cn } from "@/lib/utils";
import type { Endpoint } from "@/services/modules/endpoint";

export type ModelOptionGroup = {
  ep: Endpoint;
  models: string[];
};

export function modelKey(endpointId: number, model: string) {
  return `${endpointId}::${model}`;
}

export function parseModelKey(
  key: string,
): { endpointId: number; model: string } | null {
  const i = key.indexOf("::");
  if (i <= 0) return null;
  const endpointId = Number(key.slice(0, i));
  const model = key.slice(i + 2);
  if (!Number.isFinite(endpointId) || !model) return null;
  return { endpointId, model };
}

function matchQuery(haystack: string, q: string) {
  return haystack.toLowerCase().includes(q);
}

type Props = {
  value: string;
  onChange: (key: string) => void;
  groups: ModelOptionGroup[];
  onConfigure: () => void;
};

/** Cherry 式轻量模型选择：搜索 + 端点分组 + 图标 + 选中竖条 + 配置入口。 */
export function ModelSelector({ value, onChange, groups, onConfigure }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const t = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  const selected = useMemo(() => {
    const parsed = parseModelKey(value);
    if (!parsed) return null;
    const ep = groups.find((g) => g.ep.id === parsed.endpointId)?.ep;
    return { ...parsed, epName: ep?.name };
  }, [value, groups]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map(({ ep, models }) => ({
        ep,
        models: models.filter(
          (m) => matchQuery(m, q) || matchQuery(ep.name, q),
        ),
      }))
      .filter((g) => g.models.length > 0);
  }, [groups, query]);

  const TriggerIcon = getModelIcon(selected?.model ?? "");

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="min-w-[180px] max-w-[320px] justify-between gap-2 px-2.5 font-normal"
        >
          <span className="flex min-w-0 items-center gap-2">
            <TriggerIcon className="size-4 shrink-0 text-ink-secondary" />
            <span className="truncate">
              {selected?.model || "选择模型"}
            </span>
          </span>
          <ChevronDownIcon
            className={cn(
              "size-3.5 shrink-0 text-ink-mute transition-transform",
              open && "rotate-180",
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="flex w-[360px] flex-col gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-2">
          <SearchIcon className="size-3.5 shrink-0 text-ink-mute" />
          <Input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索模型..."
            className="h-7 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <div className="max-h-[320px] overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-mute">
              无匹配模型
            </p>
          ) : (
            filtered.map(({ ep, models }) => (
              <div key={ep.id} className="py-1">
                <div className="px-3 py-1 text-[11px] font-medium tracking-wide text-ink-mute uppercase">
                  {ep.name}
                </div>
                <ul className="flex flex-col">
                  {models.map((m) => {
                    const key = modelKey(ep.id, m);
                    const active = key === value;
                    const Icon = getModelIcon(m);
                    return (
                      <li key={key}>
                        <button
                          type="button"
                          className={cn(
                            "relative flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors",
                            active
                              ? "bg-primary/12 text-ink-primary"
                              : "text-ink-secondary hover:bg-surface-hover hover:text-ink-primary",
                          )}
                          onClick={() => {
                            onChange(key);
                            setOpen(false);
                          }}
                        >
                          {active && (
                            <span className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary" />
                          )}
                          <Icon className="size-4 shrink-0" />
                          <span className="min-w-0 truncate">{m}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>

        <button
          type="button"
          className="flex items-center gap-2 border-t border-edge px-3 py-2.5 text-xs text-ink-secondary transition-colors hover:bg-surface-hover hover:text-ink-primary"
          onClick={() => {
            setOpen(false);
            onConfigure();
          }}
        >
          <Settings2Icon className="size-3.5" />
          配置自定义模型
        </button>
      </PopoverContent>
    </Popover>
  );
}
