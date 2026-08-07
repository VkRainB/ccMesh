import { useState } from "react";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClaudeDesktopWorkspace } from "./_components/ClaudeDesktopWorkspace";
import { ClaudeWorkspace } from "./_components/ClaudeWorkspace";
import { CodexWorkspace } from "./_components/CodexWorkspace";

type Tab = "claude" | "codex" | "claude-desktop";

export function ConfigProfiles() {
  const [tab, setTab] = useState<Tab>("claude");

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-light tracking-tight">配置文件</h1>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            <TabsTrigger value="claude">Claude Code</TabsTrigger>
            <TabsTrigger value="codex">Codex</TabsTrigger>
            <TabsTrigger value="claude-desktop">Claude Desktop</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="min-h-0 flex-1">
        {tab === "claude" ? (
          <ClaudeWorkspace key="claude" />
        ) : tab === "codex" ? (
          <CodexWorkspace key="codex" />
        ) : (
          <ClaudeDesktopWorkspace key="claude-desktop" />
        )}
      </div>
    </div>
  );
}
