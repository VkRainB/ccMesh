import { useEffect, useRef } from "react";
import { PanelLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ThemeToggle, Logo, LangToggle } from "@/components/common";
import { UpdateBadge, VersionPopover } from "@/components/business";
import { useLayoutStore } from "@/stores";
import { NavItem } from "./NavItem";
import { NAV_ITEMS, SETTINGS_ITEM, ABOUT_ITEM } from "./navConfig";

export function TopNav() {
  const setNavMode = useLayoutStore((s) => s.setNavMode);
  // 顶部导航横向滚动条已隐藏，监听纵向滚轮映射为左右滚动，保持横向列表可操作。
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      nav.scrollLeft += e.deltaY;
    };
    // 非被动监听才能 preventDefault 阻止页面纵向滚动。
    nav.addEventListener("wheel", onWheel, { passive: false });
    return () => nav.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <header
      data-tauri-drag-region
      className="flex h-14 shrink-0 items-center gap-4 border-b border-edge bg-surface px-6"
    >
      <div className="w-[160px] shrink-0">
        <Logo extra={<VersionPopover />} />
      </div>

      <nav
        ref={navRef}
        className="scrollbar-none flex flex-1 items-center gap-1 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => (
          <NavItem key={item.id} item={item} variant="horizontal" />
        ))}
        <NavItem item={SETTINGS_ITEM} variant="horizontal" />
        {/* 与侧边导航保持一致：有更新时在「关于」上冒红点 */}
        <div className="relative shrink-0">
          <NavItem item={ABOUT_ITEM} variant="horizontal" />
          <span className="pointer-events-none absolute right-1 top-1">
            <UpdateBadge />
          </span>
        </div>
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
