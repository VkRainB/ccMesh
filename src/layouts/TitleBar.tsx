import { cn } from "@/lib/utils";
import { IS_MAC } from "@/lib/platform";
import { WindowControls } from "./WindowControls";

/**
 * 无边框窗口自定义标题栏：左侧可拖拽区，右侧窗口控制按钮。
 * macOS 改用系统原生红绿灯（位于左上角），故左侧留白避让，且不渲染自绘按钮。
 */
export function TitleBar() {
  return (
    <div
      data-tauri-drag-region
      data-app-chrome=""
      className={cn(
        "pointer-events-auto flex h-8 shrink-0 select-none items-center justify-between border-b border-edge-subtle bg-surface",
        IS_MAC ? "pl-20" : "pl-3"
      )}
    >
      <span
        data-tauri-drag-region
        className="text-xs font-medium tracking-tight text-ink-mute"
      >
        ccMesh
      </span>
      <WindowControls />
    </div>
  );
}
