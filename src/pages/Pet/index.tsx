import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { usePets } from "@/hooks/usePets";
import { petApi, type PetListItem } from "@/services/modules/pet";

import { PetGrid } from "./_components/PetGrid";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 宠物资产页：列表 / 选中 / 导入 / 保存激活宠物。 */
export function Pet() {
  const qc = useQueryClient();
  const pets = usePets();
  const activeQ = useQuery({
    queryKey: ["pets", "active"],
    queryFn: petApi.getActive,
  });

  const [selectedDirId, setSelectedDirId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PetListItem | null>(null);
  const dirty =
    selectedDirId != null && selectedDirId !== (activeQ.data ?? null);

  useEffect(() => {
    if (activeQ.isFetching) return; // refetch 期间 activeQ.data 可能是陈旧缓存，跳过初始化
    if (activeQ.data !== undefined && selectedDirId === null) {
      setSelectedDirId(activeQ.data);
    }
  }, [activeQ.data, activeQ.isFetching, selectedDirId]);

  useEffect(() => {
    if (pets.isFetching) return; // 导入/删除后 refetch 未完成前 pets.data 仍是旧列表，跳过校验
    if (!pets.data || selectedDirId == null) return;
    if (!pets.data.some((p) => p.dirId === selectedDirId)) {
      setSelectedDirId(activeQ.data ?? null);
    }
  }, [pets.data, pets.isFetching, selectedDirId, activeQ.data]);

  const importMut = useMutation({
    mutationFn: (kind: "folder" | "zip") =>
      kind === "folder" ? petApi.pickAndImportFolder() : petApi.pickAndImportZip(),
    onSuccess: (item) => {
      if (!item) return;
      toast.success(`已导入 ${item.displayName}`);
      setSelectedDirId(item.dirId);
      qc.invalidateQueries({ queryKey: ["pets"] });
    },
    onError: (e) => toast.error(`导入失败：${errMsg(e)}`),
  });

  const saveMut = useMutation({
    mutationFn: (dirId: string) => petApi.setActive(dirId),
    onSuccess: () => {
      toast.success("宠物已切换");
      qc.invalidateQueries({ queryKey: ["pets", "active"] });
    },
    onError: (e) => toast.error(`保存失败：${errMsg(e)}`),
  });

  const deleteMut = useMutation({
    mutationFn: (dirId: string) => petApi.remove(dirId),
    onSuccess: (_d, dirId) => {
      const name = pendingDelete?.displayName ?? dirId;
      toast.success(`已删除 ${name}`);
      setPendingDelete(null);
      if (selectedDirId === dirId) {
        setSelectedDirId(null);
      }
      qc.invalidateQueries({ queryKey: ["pets"] });
      qc.invalidateQueries({ queryKey: ["pets", "active"] });
    },
    onError: (e) => toast.error(`删除失败：${errMsg(e)}`),
  });

  const deletingActive =
    pendingDelete != null && pendingDelete.dirId === (activeQ.data ?? null);

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-5xl flex-col gap-5">
      <header className="shrink-0">
        <h1 className="text-2xl font-light tracking-tight text-ink-primary">
          精灵宠物
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {pets.isLoading ? (
          <p className="text-sm text-ink-mute">加载中…</p>
        ) : pets.isError ? (
          <p className="text-sm text-ink-mute">
            加载失败：
            {pets.error instanceof Error
              ? pets.error.message
              : String(pets.error)}
          </p>
        ) : (
          <PetGrid
            pets={pets.data ?? []}
            selectedDirId={selectedDirId}
            importing={importMut.isPending}
            onSelect={setSelectedDirId}
            onDelete={setPendingDelete}
            onImportFolder={() => importMut.mutate("folder")}
            onImportZip={() => importMut.mutate("zip")}
          />
        )}
      </div>

      <footer className="sticky bottom-0 z-10 mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-edge-subtle bg-background pt-4 pb-1">
        <Button
          variant="outline"
          size="sm"
          disabled={pets.isFetching}
          onClick={() => pets.refetch()}
        >
          <RefreshCwIcon
            className={`size-4 ${pets.isFetching ? "animate-spin" : ""}`}
          />
          刷新列表
        </Button>
        <Button
          size="sm"
          disabled={!selectedDirId || !dirty || saveMut.isPending}
          onClick={() => selectedDirId && saveMut.mutate(selectedDirId)}
        >
          保存
        </Button>
      </footer>

      <Dialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除宠物</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-ink-secondary">
            确定删除宠物「
            <span className="font-medium">{pendingDelete?.displayName}</span>
            」吗？此操作不可恢复。
            {deletingActive ? "同时将取消桌面宠物激活。" : null}
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPendingDelete(null)}
              disabled={deleteMut.isPending}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              disabled={deleteMut.isPending}
              onClick={() =>
                pendingDelete && deleteMut.mutate(pendingDelete.dirId)
              }
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
