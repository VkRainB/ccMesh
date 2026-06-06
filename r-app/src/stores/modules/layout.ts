import { create } from "zustand";
import { persist } from "zustand/middleware";

export type NavMode = "horizontal" | "vertical";
export type SidebarState = "expanded" | "collapsed";
export type EndpointView = "list" | "grid";
export type ViewId =
  | "dashboard"
  | "endpoints"
  | "statistics"
  | "sync"
  | "logs"
  | "settings";
export type Lang = "zh" | "en";

interface LayoutState {
  navMode: NavMode;
  sidebarState: SidebarState;
  activeView: ViewId;
  lang: Lang;
  endpointView: EndpointView;
  setNavMode: (mode: NavMode) => void;
  toggleNavMode: () => void;
  setSidebarState: (state: SidebarState) => void;
  toggleSidebar: () => void;
  setActiveView: (view: ViewId) => void;
  toggleLang: () => void;
  setEndpointView: (view: EndpointView) => void;
  toggleEndpointView: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      navMode: "vertical",
      sidebarState: "expanded",
      activeView: "dashboard",
      lang: "zh",
      endpointView: "list",
      setNavMode: (navMode) => set({ navMode }),
      toggleNavMode: () =>
        set((s) => ({
          navMode: s.navMode === "horizontal" ? "vertical" : "horizontal",
        })),
      setSidebarState: (sidebarState) => set({ sidebarState }),
      toggleSidebar: () =>
        set((s) => ({
          sidebarState:
            s.sidebarState === "expanded" ? "collapsed" : "expanded",
        })),
      setActiveView: (activeView) => set({ activeView }),
      toggleLang: () => set((s) => ({ lang: s.lang === "zh" ? "en" : "zh" })),
      setEndpointView: (endpointView) => set({ endpointView }),
      toggleEndpointView: () =>
        set((s) => ({
          endpointView: s.endpointView === "list" ? "grid" : "list",
        })),
    }),
    {
      name: "layout-prefs",
      partialize: (s) => ({
        navMode: s.navMode,
        sidebarState: s.sidebarState,
        lang: s.lang,
        endpointView: s.endpointView,
      }),
    }
  )
);
