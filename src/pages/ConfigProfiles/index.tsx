import { useState } from "react";
import { Claude, ClaudeCode, Codex } from "@lobehub/icons";
import { SquareTerminalIcon, MonitorIcon } from "lucide-react";
import type { ComponentType } from "react";

import piLogoUrl from "@/assets/svg/about/pi-logo.svg";
import ompLogoUrl from "@/assets/svg/about/omp-logo.svg";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClaudeDesktopWorkspace } from "./_components/ClaudeDesktopWorkspace";
import { ClaudeWorkspace } from "./_components/ClaudeWorkspace";
import { CodexWorkspace } from "./_components/CodexWorkspace";
import { PiWorkspace } from "./_components/PiWorkspace";
import { OmpWorkspace } from "./_components/OmpWorkspace";

type Tab = "claude" | "codex" | "claude-desktop" | "pi" | "omp";

type IconComponent = ComponentType<{ size?: number; className?: string }>;

/** 品牌图标 + 右下角小角标（终端/电脑）区分 Code 与 Desktop */
function ClaudeBadgeIcon({
  icon: Icon = Claude.Color,
  badge: Badge,
}: {
  icon?: IconComponent;
  badge: IconComponent;
}) {
  return (
    <span className="relative shrink-0">
      <Icon size={14} className="size-3.5" />
      <Badge className="absolute -right-1 -bottom-1 size-[9px] rounded-[2px] bg-background p-px text-foreground" />
    </span>
  );
}

export function ConfigProfiles() {
  const [tab, setTab] = useState<Tab>("claude");

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-light tracking-tight">配置文件</h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="claude">
              <ClaudeBadgeIcon badge={SquareTerminalIcon} />
              Claude Code
            </TabsTrigger>
            <TabsTrigger value="claude-desktop">
              <ClaudeBadgeIcon icon={ClaudeCode.Color} badge={MonitorIcon} />
              Claude Desktop
            </TabsTrigger>
            <TabsTrigger value="codex">
              <Codex.Color size={14} className="shrink-0" />
              Codex
            </TabsTrigger>
            <TabsTrigger value="pi">
              <img
                src={piLogoUrl}
                alt=""
                className="size-3.5 shrink-0 rounded-[3px]"
              />
              Pi
            </TabsTrigger>
            <TabsTrigger value="omp">
              <img
                src={ompLogoUrl}
                alt=""
                className="size-3.5 shrink-0 rounded-[3px]"
              />
              OMP
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "claude" ? (
          <ClaudeWorkspace key="claude" />
        ) : tab === "codex" ? (
          <CodexWorkspace key="codex" />
        ) : tab === "claude-desktop" ? (
          <ClaudeDesktopWorkspace key="claude-desktop" />
        ) : tab === "pi" ? (
          <PiWorkspace key="pi" />
        ) : (
          <OmpWorkspace key="omp" />
        )}
      </div>
    </div>
  );
}
