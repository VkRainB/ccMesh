import { create } from "zustand";
import { persist } from "zustand/middleware";

import {
  COMPOSER_DEFAULT_PX,
  clampComposerHeight,
} from "@/pages/Chat/_components/composerLayout";

export type NavMode = "horizontal" | "vertical";
export type SidebarState = "expanded" | "collapsed";
export type EndpointView = "list" | "grid";
export type ViewId =
  | "dashboard"
  | "endpoints"
  | "configProfiles"
  | "chat"
  | "toolSessions"
  | "statistics"
  | "sync"
  | "logs"
  | "settings"
  | "about"
  | "pet";
export type Lang = "zh" | "en";

interface LayoutState {
  navMode: NavMode;
  sidebarState: SidebarState;
  activeView: ViewId;
  lang: Lang;
  endpointView: EndpointView;
  /** Chat 会话列表是否折叠（完全隐藏）。 */
  chatTopicListCollapsed: boolean;
  /** Chat 输入区外壳高度（拖拽调整，expand 时忽略）。 */
  chatComposerHeightPx: number;
  /** Chat 输入区是否展开占大半屏（不持久化）。 */
  chatComposerExpanded: boolean;
  setNavMode: (mode: NavMode) => void;
  toggleNavMode: () => void;
  setSidebarState: (state: SidebarState) => void;
  toggleSidebar: () => void;
  setActiveView: (view: ViewId) => void;
  toggleLang: () => void;
  setEndpointView: (view: EndpointView) => void;
  toggleEndpointView: () => void;
  setChatTopicListCollapsed: (collapsed: boolean) => void;
  toggleChatTopicList: () => void;
  setChatComposerHeightPx: (px: number) => void;
  setChatComposerExpanded: (expanded: boolean) => void;
  toggleChatComposerExpanded: () => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      navMode: "vertical",
      sidebarState: "expanded",
      activeView: "dashboard",
      lang: "zh",
      endpointView: "list",
      chatTopicListCollapsed: false,
      chatComposerHeightPx: COMPOSER_DEFAULT_PX,
      chatComposerExpanded: false,
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
      setChatTopicListCollapsed: (chatTopicListCollapsed) =>
        set({ chatTopicListCollapsed }),
      toggleChatTopicList: () =>
        set((s) => ({ chatTopicListCollapsed: !s.chatTopicListCollapsed })),
      setChatComposerHeightPx: (px) =>
        set({ chatComposerHeightPx: clampComposerHeight(px) }),
      setChatComposerExpanded: (chatComposerExpanded) =>
        set({ chatComposerExpanded }),
      toggleChatComposerExpanded: () =>
        set((s) => ({ chatComposerExpanded: !s.chatComposerExpanded })),
    }),
    {
      name: "layout-prefs",
      partialize: (s) => ({
        navMode: s.navMode,
        sidebarState: s.sidebarState,
        lang: s.lang,
        endpointView: s.endpointView,
        chatTopicListCollapsed: s.chatTopicListCollapsed,
        chatComposerHeightPx: s.chatComposerHeightPx,
        // ponytail: expand is session-local; avoid cold-start fullscreen composer
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<LayoutState>;
        return {
          ...current,
          ...p,
          chatComposerHeightPx: clampComposerHeight(
            p.chatComposerHeightPx ?? current.chatComposerHeightPx,
          ),
        };
      },
    }
  )
);
