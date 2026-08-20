import type { ReactNode } from "react";

import { Switch } from "@/components/ui/switch";

export function ToggleRow({
  icon,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-edge bg-surface p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-edge">
          {icon}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium leading-none text-ink-primary">{title}</p>
          {description ? <p className="text-xs text-ink-mute">{description}</p> : null}
        </div>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}
