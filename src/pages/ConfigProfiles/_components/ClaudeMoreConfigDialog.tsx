import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheckIcon } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CLAUDE_USER_FLAGS_KEY,
  claudeUserConfigApi,
  type ClaudeUserFlags,
} from "@/services/modules/claude_user_config";
import { ToggleRow } from "./ToggleRow";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const FLAG_ROWS: Array<{
  key: keyof ClaudeUserFlags;
  title: string;
  description: string;
  icon: typeof BadgeCheckIcon;
  iconClassName: string;
}> = [
  {
    key: "skipOnboarding",
    title: "跳过 Claude Code 初次安装确认",
    description: "开启后跳过 Claude Code 初次安装确认",
    icon: BadgeCheckIcon,
    iconClassName: "size-4",
  },
];

export function ClaudeMoreConfigDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const flagsQ = useQuery({
    queryKey: CLAUDE_USER_FLAGS_KEY,
    queryFn: claudeUserConfigApi.getFlags,
    enabled: open,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const setFlags = useMutation({
    mutationFn: (patch: Partial<ClaudeUserFlags>) => claudeUserConfigApi.setFlags(patch),
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: CLAUDE_USER_FLAGS_KEY });
      const prev = qc.getQueryData<ClaudeUserFlags>(CLAUDE_USER_FLAGS_KEY);
      if (prev) qc.setQueryData(CLAUDE_USER_FLAGS_KEY, { ...prev, ...patch });
      return { prev };
    },
    onError: (e, _patch, ctx) => {
      if (ctx?.prev) qc.setQueryData(CLAUDE_USER_FLAGS_KEY, ctx.prev);
      toast.error(errMsg(e));
    },
    onSuccess: (flags) => {
      qc.setQueryData(CLAUDE_USER_FLAGS_KEY, flags);
    },
  });

  // 重开弹窗必须读盘：全局 staleTime=60s，且组件不卸载，refetchOnMount 不会触发。
  // 读盘中挡住开关，避免先画出缓存再跳变；拨动中的 optimistic 更新不算读盘。
  const readingDisk = flagsQ.isLoading || (flagsQ.isFetching && !setFlags.isPending);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex min-h-[240px] flex-col sm:max-w-md">
        <DialogHeader>
          <DialogTitle>更多配置</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-3">
          {readingDisk ? (
            <p className="text-sm text-ink-mute">加载中…</p>
          ) : flagsQ.isError ? (
            <p className="text-sm text-destructive">{errMsg(flagsQ.error)}</p>
          ) : (
            FLAG_ROWS.map((row) => {
              const Icon = row.icon;
              return (
                <ToggleRow
                  key={row.key}
                  icon={<Icon className={row.iconClassName} />}
                  title={row.title}
                  description={row.description}
                  checked={!!flagsQ.data?.[row.key]}
                  disabled={setFlags.isPending || !flagsQ.data}
                  onCheckedChange={(v) => setFlags.mutate({ [row.key]: v })}
                />
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
