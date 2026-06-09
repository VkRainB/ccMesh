import { ZapIcon } from "lucide-react";

export function Logo({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <ZapIcon className="size-4" />
      </div>
      {!iconOnly && (
        <span className="text-base font-semibold tracking-tight whitespace-nowrap">
          ccMesh
        </span>
      )}
    </div>
  );
}
