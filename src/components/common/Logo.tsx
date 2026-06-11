import type { ReactNode } from "react";

import logoUrl from "@/assets/logo.png";

export function Logo({
  iconOnly = false,
  extra,
}: {
  iconOnly?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <img
        src={logoUrl}
        alt="ccMesh"
        className="size-7 shrink-0 rounded-md"
      />
      {!iconOnly && (
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="text-base font-semibold leading-tight tracking-tight whitespace-nowrap">
            ccMesh
          </span>
          {extra}
        </div>
      )}
    </div>
  );
}
