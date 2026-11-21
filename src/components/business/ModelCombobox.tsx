import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, SearchIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 候选模型 ID；可按使用场景传入入站或出站模型。 */
  options: string[];
  placeholder?: string;
  id?: string;
  /** 根容器额外 class（如 flex-1）。 */
  className?: string;
}

/**
 * 模型输入框：主输入框直接编辑值（自由输入，不参与过滤）；
 * 点击右侧 ⌄ 展开下拉，下拉**顶部独立搜索框**用于检索候选模型，互不影响。
 */
export function ModelCombobox({
  value,
  onChange,
  options,
  placeholder,
  id,
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [autoFocusSearch, setAutoFocusSearch] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const openMenu = (focusSearch: boolean) => {
    setQuery("");
    setAutoFocusSearch(focusSearch);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const list = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;

  return (
    <div
      ref={rootRef}
      className={cn("relative", className)}
      onBlur={(e) => {
        if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-8"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => openMenu(false)}
        onClick={() => setOpen(true)}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="选择模型"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openMenu(true))}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-ink-mute hover:text-ink-secondary"
      >
        <ChevronDownIcon
          className={cn("size-4 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-edge bg-surface shadow-md">
          <div className="flex items-center gap-1.5 border-b border-edge px-2.5 py-1.5">
            <SearchIcon className="size-3.5 shrink-0 text-ink-mute" />
            <input
              autoFocus={autoFocusSearch}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索模型…"
              className="w-full bg-transparent text-sm text-ink-primary outline-none placeholder:text-ink-mute"
            />
          </div>
          <ul className="max-h-48 overflow-auto py-1">
            {list.length === 0 ? (
              <li className="px-3 py-2 text-center text-xs text-ink-mute">
                无匹配模型
              </li>
            ) : (
              list.map((opt) => (
                <li key={opt}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt);
                      setOpen(false);
                    }}
                    className={cn(
                      "block w-full truncate px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover hover:text-ink-primary",
                      opt === value
                        ? "bg-surface-hover font-medium text-primary"
                        : "text-ink-secondary",
                    )}
                  >
                    {opt}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
