import type { ReactNode } from "react";

import { TabularText } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";
import { formatTokenCompact } from "@/lib/format";

interface Props {
  label: string;
  value: number | string;
  hint?: ReactNode;
  /** true 时辅助提示在数值下方（垂直堆叠）；默认在右侧（水平）。 */
  hintBelow?: boolean;
  /** 卡片右下角的弱提示，例如失败数。 */
  corner?: ReactNode;
}

/** 跨页面业务卡片：标签 + 大号数值 + 可选提示（Statistics / Dashboard 共用）。 */
export function StatCard({ label, value, hint, hintBelow = false, corner }: Props) {
  return (
    <Card className="relative">
      <CardContent className="flex flex-col gap-1.5 px-5 py-4">
        <span className="text-xs text-ink-secondary">{label}</span>
        <div
          className={
            hintBelow
              ? "flex flex-col gap-0.5"
              : "flex items-center justify-between gap-2"
          }
        >
          <TabularText className="text-2xl text-foreground">{value}</TabularText>
          {hint}
        </div>
      </CardContent>
      {corner ? <div className="absolute right-3 bottom-2">{corner}</div> : null}
    </Card>
  );
}

/**
 * Token 辅助单位小字：仅当数值达到"万"量级（≥ 1e4）才展示折算单位，
 * 否则精确值本身已足够清晰。用作 `StatCard` 的 `hint`。
 */
export function TokenHint({ value }: { value: number }) {
  if (value < 1e4) return null;
  return (
    <span className="text-xs text-ink-secondary">{formatTokenCompact(value)}</span>
  );
}
