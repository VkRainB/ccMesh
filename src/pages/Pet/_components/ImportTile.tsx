import { FolderPlusIcon, FileArchiveIcon, PlusIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface Props {
  disabled?: boolean;
  onImportFolder: () => void;
  onImportZip: () => void;
}

/** 网格内导入入口：与宠物卡同构（2:3 竖卡 + 内边距图片区），灰色虚线边。 */
export function ImportTile({ disabled, onImportFolder, onImportZip }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          aria-label="导入宠物"
          className={cn(
            "flex aspect-[2/3] w-full cursor-pointer flex-col overflow-hidden rounded-lg",
            "border border-dashed border-edge-strong bg-surface-card",
            "transition-colors duration-200",
            "hover:border-ink-disabled hover:bg-surface-hover",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          <div className="flex min-h-0 flex-1 items-center justify-center p-3">
            <div className="flex h-full w-full items-center justify-center rounded-md bg-surface-hover">
              <span className="flex size-10 items-center justify-center rounded-full bg-surface-card text-ink-disabled">
                <PlusIcon className="size-5" aria-hidden />
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-1 px-3 pb-3">
            <p className="text-sm font-semibold text-ink-mute">导入宠物</p>
            <p className="truncate text-xs text-ink-disabled">文件夹或 ZIP</p>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        <DropdownMenuItem onClick={onImportFolder}>
          <FolderPlusIcon />
          导入文件夹
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportZip}>
          <FileArchiveIcon />
          导入 ZIP
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
