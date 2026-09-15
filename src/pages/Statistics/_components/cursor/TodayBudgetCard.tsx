import { TabularText } from "@/components/ui";
import { Card, CardContent } from "@/components/ui/card";

import { fmtTok, fmtUsd } from "./cursorUsage";

export function TodayBudgetCard({
  cents,
  requests,
  tokens,
}: {
  cents: number;
  requests: number;
  tokens: number;
}) {
  return (
    <Card className="h-full gap-0 py-3">
      <CardContent className="flex h-full flex-col gap-2 px-5">
        <span className="text-xs text-ink-secondary">今日已用</span>
        <TabularText className="text-2xl text-info">{fmtUsd(cents)}</TabularText>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-ink-mute">请求</p>
            <TabularText className="text-sm text-foreground">{requests} 次</TabularText>
          </div>
          <div className="border-l border-edge pl-4">
            <p className="text-xs text-ink-mute">Token</p>
            <TabularText className="text-sm text-foreground">{fmtTok(tokens)}</TabularText>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
