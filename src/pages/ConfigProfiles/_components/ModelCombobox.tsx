import { useRef, useState } from "react";
import { ChevronDownIcon } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 可选模型列表（对外暴露的模型）。 */
  options: string[];
  placeholder?: string;
  id?: string;
  /** 根容器额外 class（如 flex-1）。 */
  className?: string;
}

/**
 * 模型输入框：支持手动输入 + 从对外模型下拉选择的轻量 combobox。
 * 比原生 datalist 样式可控；输入即过滤，点击候选填入，仍可自由输入。
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
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const q = value.trim().toLowerCase();
  const filtered = q ? options.filter((o) => o.toLowerCase().includes(q)) : options;
  const list = filtered.length > 0 ? filtered : options;

  const cancelClose = () => {
    if (blurTimer.current) {
      clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
  };

  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-8"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          cancelClose();
          setOpen(true);
        }}
        onBlur={() => {
          blurTimer.current = setTimeout(() => setOpen(false), 120);
        }}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="选择模型"
        onMouseDown={(e) => {
          e.preventDefault();
          setOpen((o) => !o);
        }}
        className="absolute inset-y-0 right-0 flex items-center px-2.5 text-ink-mute hover:text-ink-secondary"
      >
        <ChevronDownIcon className="size-4" />
      </button>
      {open && list.length > 0 && (
        <ul
          className="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-md border border-edge bg-surface py-1 shadow-md"
          onMouseDown={(e) => e.preventDefault()}
        >
          {list.map((opt) => (
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
          ))}
        </ul>
      )}
    </div>
  );
}
