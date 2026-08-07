import { lazy, Suspense, useEffect, type ComponentType } from "react";

import { cn } from "@/lib/utils";
import { useLayoutStore, type ViewId } from "@/stores";
import { TopNav } from "./TopNav";
import { SideNav } from "./SideNav";
import { TitleBar } from "./TitleBar";

// 6 个页面懒加载，各自拆为独立 chunk，仅在切换到对应视图时加载
const Dashboard = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.Dashboard })),
);
const Endpoints = lazy(() =>
  import("@/pages/Endpoints").then((m) => ({ default: m.Endpoints })),
);
const ConfigProfiles = lazy(() =>
  import("@/pages/ConfigProfiles").then((m) => ({ default: m.ConfigProfiles })),
);
const Chat = lazy(() => import("@/pages/Chat").then((m) => ({ default: m.Chat })));
const ToolSessions = lazy(() =>
  import("@/pages/ToolSessions").then((m) => ({ default: m.ToolSessions })),
);
const Statistics = lazy(() =>
  import("@/pages/Statistics").then((m) => ({ default: m.Statistics })),
);
const Sync = lazy(() => import("@/pages/Sync").then((m) => ({ default: m.Sync })));
const Logs = lazy(() => import("@/pages/Logs").then((m) => ({ default: m.Logs })));
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const About = lazy(() =>
  import("@/pages/About").then((m) => ({ default: m.About })),
);
const Pet = lazy(() => import("@/pages/Pet").then((m) => ({ default: m.Pet })));

const PAGES: Record<ViewId, ComponentType> = {
  dashboard: Dashboard,
  endpoints: Endpoints,
  configProfiles: ConfigProfiles,
  chat: Chat,
  toolSessions: ToolSessions,
  statistics: Statistics,
  sync: Sync,
  logs: Logs,
  settings: Settings,
  about: About,
  pet: Pet,
};

export function AppLayout() {
  const navMode = useLayoutStore((s) => s.navMode);
  const activeView = useLayoutStore((s) => s.activeView);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => {
      const store = useLayoutStore.getState();
      if (store.navMode === "vertical" && e.matches) {
        store.setSidebarState("collapsed");
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  const ActivePage = PAGES[activeView];

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div
        className={cn(
          "flex flex-1 overflow-hidden",
          navMode === "vertical" ? "flex-row" : "flex-col"
        )}
      >
        {navMode === "horizontal" ? <TopNav /> : <SideNav />}
        <main
          className={cn(
            "flex-1 min-h-0",
            activeView === "chat" || activeView === "toolSessions"
              ? "overflow-hidden p-0"
              : "overflow-y-auto p-8",
          )}
        >
          <Suspense fallback={null}>
            <ActivePage />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
