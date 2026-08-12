import type { ReactNode } from "react";

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/**
 * 中栏表单分组：小节标题 + 可选描述 + 右侧动作区；不传 title 时只保留分隔线不渲染头部。
 * 非首个分组自动带顶部分隔线，把长表单切成可扫读的块。
 */
export function FormSection({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <section className="flex flex-col gap-3 border-edge-subtle pt-4 first:pt-0 [&:not(:first-of-type)]:border-t">
      {hasHeader && (
        <header className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            {title && <h3 className="text-[13px] font-semibold text-ink-primary">{title}</h3>}
            {description && <p className="text-xs text-ink-mute">{description}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

/** 布尔字段行：左侧标题 + 说明，右侧 Switch，替代裸 label+switch 的松散写法。 */
export function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-md border border-edge px-3 py-2 transition-colors hover:bg-surface-hover/50",
        disabled && "cursor-not-allowed opacity-60 hover:bg-transparent",
      )}
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-ink-primary">{label}</span>
        {description && <span className="text-xs text-ink-mute">{description}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </label>
  );
}

/** 紧凑字段：标签在上、控件在下，用于对象编辑器和模型高级字段的网格布局。 */
export function MiniField({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="truncate text-xs text-ink-mute" title={label}>
        {label}
      </span>
      {children}
    </label>
  );
}

/**
 * 可选对象卡片：discovery / remoteCompaction / thinking 等「整个对象可留空」的字段。
 * 头部 Switch 控制启停（替代此前悬浮的「+ 启用」文字链接），开启后展开编辑区。
 */
export function ObjectToggleCard({
  title,
  description,
  enabled,
  onToggle,
  children,
}: {
  title: string;
  description?: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <div className={cn("rounded-md border", enabled ? "border-edge" : "border-dashed border-edge")}>
      <label
        className={cn(
          "flex cursor-pointer items-center justify-between gap-3 px-3 py-2",
          !enabled && "opacity-80",
        )}
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-sm font-medium text-ink-primary">{title}</span>
          {description && <span className="text-xs text-ink-mute">{description}</span>}
        </span>
        <Switch checked={enabled} onCheckedChange={onToggle} />
      </label>
      {enabled && children && (
        <div className="flex flex-col gap-2.5 border-t border-edge px-3 py-2.5">{children}</div>
      )}
    </div>
  );
}
