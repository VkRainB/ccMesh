import { useEffect, useState } from "react";
import { Loader2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isSafePiOmpProviderId } from "@/lib/piOmpCommon";

/**
 * 渠道改名弹窗：输入新 id，本地校验（合法字符 / 与现有渠道不冲突），
 * 确认后由调用方发起原子迁移（拆分文件名 + 汇总文件键 + 默认引用）。
 */
export function RenameProviderDialog({
  open,
  oldId,
  existingIds,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  oldId: string;
  existingIds: string[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: (newId: string) => void;
}) {
  const [value, setValue] = useState(oldId);

  useEffect(() => {
    if (open) setValue(oldId);
  }, [open, oldId]);

  const newId = value.trim();
  const validationError = !newId
    ? null
    : !isSafePiOmpProviderId(newId)
      ? "仅支持字母、数字、点、下划线、短横线"
      : newId === oldId
        ? "新旧 id 相同"
        : existingIds.includes(newId)
          ? "已存在同名渠道"
          : null;
  const canConfirm = newId.length > 0 && !validationError && !pending;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>编辑 Provider ID</DialogTitle>
          <DialogDescription>是否要修改渠道「{oldId}」的 Provider ID？</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Input
            value={value}
            autoFocus
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && canConfirm) onConfirm(newId);
            }}
            placeholder="新的 provider id"
          />
          {validationError && <p className="px-1 text-xs text-destructive">{validationError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>取消</Button>
          <Button disabled={!canConfirm} onClick={() => onConfirm(newId)}>
            {pending && <Loader2Icon className="animate-spin" />}
            确认修改
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
