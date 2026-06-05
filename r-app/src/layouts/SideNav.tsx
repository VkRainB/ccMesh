import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PanelTopIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ThemeToggle, Logo, LangToggle } from "@/components/common";
import { UpdateBadge } from "@/components/business";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useLayoutStore } from "@/stores";
import { NavItem } from "./NavItem";
import { NAV_ITEMS, SETTINGS_ITEM } from "./navConfig";

export function SideNav() {
  const sidebarState = useLayoutStore((s) => s.sidebarState);
  const toggleSidebar = useLayoutStore((s) => s.toggleSidebar);
  const setNavMode = useLayoutStore((s) => s.setNavMode);
  const collapsed = sidebarState === "collapsed";

  return (
    <nav
      className={cn(
        "flex shrink-0 flex-col border-r border-edge bg-surface transition-[width] duration-200 ease-in-out",
        collapsed ? "w-14" : "w-[220px]"
      )}
    >
      <div className="flex h-14 shrink-0 items-center border-b border-edge-subtle px-4">
        <Logo iconOnly={collapsed} />
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="flex flex-col gap-1">
          {NAV_ITEMS.map((item) => (
            <NavItem
              key={item.id}
              item={item}
              variant="vertical"
              collapsed={collapsed}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-edge px-2 py-2">
        <div className="relative">
          <NavItem item={SETTINGS_ITEM} variant="vertical" collapsed={collapsed} />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2">
            <UpdateBadge />
          </span>
        </div>
        <div
          className={cn(
            "flex gap-1 pt-1",
            collapsed ? "flex-col items-center" : "items-center justify-between"
          )}
        >
          <div className={cn("flex gap-1", collapsed && "flex-col")}>
            <ThemeToggle />
            <LangToggle />
          </div>
          <div className={cn("flex gap-1", collapsed && "flex-col")}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="切换为顶部导航"
                  onClick={() => setNavMode("horizontal")}
                >
                  <PanelTopIcon className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">切换为顶部导航</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
                  onClick={toggleSidebar}
                >
                  {collapsed ? (
                    <ChevronRightIcon className="size-4" />
                  ) : (
                    <ChevronLeftIcon className="size-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                {collapsed ? "展开侧边栏" : "折叠侧边栏"}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>
    </nav>
  );
}
