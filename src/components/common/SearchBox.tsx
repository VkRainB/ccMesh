import { useId, useState } from "react";
import { Search, X } from "lucide-react";
import { motion } from "motion/react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SearchBoxProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  /** 展开态输入框的额外 className（如覆盖默认宽度 w-64） */
  className?: string;
  ariaLabel?: string;
}

/**
 * Morph 搜索框：收起态为图标按钮，点击后弹簧展开为带搜索图标 + X 清除的输入框。
 * 交互复刻自 octopus 的 toolbar 搜索框；受控，过滤逻辑由调用方负责。
 */
export function SearchBox({
  value,
  onChange,
  placeholder,
  className,
  ariaLabel = "搜索",
}: SearchBoxProps) {
  // ponytail: useId 保证多实例 layoutId 不冲突，调用方无需传入。
  const layoutId = useId();
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <motion.button
        type="button"
        layoutId={layoutId}
        aria-label={ariaLabel}
        onClick={() => setExpanded(true)}
        className={buttonVariants({
          variant: "ghost",
          size: "icon",
          className:
            "pointer-events-auto h-9 w-9 shrink-0 rounded-xl text-muted-foreground transition-none hover:bg-transparent hover:text-foreground",
        })}
      >
        <motion.span layout="position">
          <Search className="size-4 transition-colors duration-300" />
        </motion.span>
      </motion.button>
    );
  }

  return (
    <motion.div
      layoutId={layoutId}
      className={cn(
        "pointer-events-auto flex h-9 w-64 shrink-0 items-center gap-2 rounded-xl border border-input bg-surface-raised px-3",
        className,
      )}
      transition={{ type: "spring", stiffness: 400, damping: 30 }}
    >
      <motion.span layout="position">
        <Search className="size-4 shrink-0 text-muted-foreground" />
      </motion.span>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus
        className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
      />
      <button
        type="button"
        aria-label="清除搜索"
        onClick={() => {
          onChange("");
          setExpanded(false);
        }}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </motion.div>
  );
}
