import { PanelLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle, Logo, LangToggle } from "@/components/common";
import { VersionPopover } from "@/components/business";
import { useLayoutStore } from "@/stores";
import { NavItem } from "./NavItem";
import { NAV_ITEMS, SETTINGS_ITEM } from "./navConfig";

export function TopNav() {
  const setNavMode = useLayoutStore((s) => s.setNavMode);

  return (
    <header
      data-tauri-drag-region
      className="flex h-14 shrink-0 items-center gap-4 border-b border-edge bg-surface px-6"
    >
      <div className="w-[160px] shrink-0">
        <Logo extra={<VersionPopover />} />
      </div>

      <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.id} item={item} variant="horizontal" />
        ))}
        <NavItem item={SETTINGS_ITEM} variant="horizontal" />
      </nav>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          aria-label="切换为侧边导航"
          onClick={() => setNavMode("vertical")}
        >
          <PanelLeftIcon className="size-4" />
        </Button>
        <ThemeToggle />
        <LangToggle />
      </div>
    </header>
  );
}
