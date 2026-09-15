import { Card, CardContent } from "@/components/ui/card";
import { TabularText } from "@/components/ui";
import type { CursorPlanUsage } from "@/services/modules/cursorUsage";

/** 进度条颜色：>=100% 红、>80% 橙、否则用通道主色。 */
function barClass(pct: number, normal: string) {
  if (pct >= 100) return "bg-destructive";
  if (pct > 80) return "bg-warning";
  return normal;
}

export function ChannelDonut({ planUsage }: { planUsage: CursorPlanUsage }) {
  const api = planUsage.apiPercentUsed ?? 0;
  const auto = planUsage.autoPercentUsed ?? 0;
  const rows = [
    { name: "Auto + Composer", pct: auto, normal: "bg-info" },
    { name: "API 通道", pct: api, normal: "bg-primary" },
  ];
  return (
    <Card className="h-full py-4">
      <CardContent className="flex h-full flex-col justify-center px-4">
        <h3 className="mb-4 text-xs text-ink-secondary">通道用量进度</h3>
        <div className="flex flex-col gap-5">
          {rows.map((r) => (
            <div key={r.name} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-primary">
                  {r.name}
                </span>
                <TabularText className="text-sm text-ink-secondary">
                  {r.pct.toFixed(1)}% used
                </TabularText>
              </div>
              <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={`absolute inset-y-0 left-0 rounded-full ${barClass(r.pct, r.normal)}`}
                  style={{ width: `${Math.min(100, r.pct)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
