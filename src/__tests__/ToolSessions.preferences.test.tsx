import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToolSessions } from "@/pages/ToolSessions";

const viewKey = "ccmesh.toolSessions.listViewMode";
const groupKey = "ccmesh.toolSessions.groupExpansionState";
const mockedInvoke = vi.mocked(invoke);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToolSessions />
    </QueryClientProvider>,
  );
}

describe("会话列表偏好", () => {
  beforeEach(() => {
    localStorage.removeItem(viewKey);
    localStorage.removeItem(groupKey);
    mockedInvoke.mockReset();
    mockedInvoke.mockImplementation(async (command) => {
      if (command === "list_tool_sessions") {
        return [{ providerId: "claude", sessionId: "s1", title: "可见会话", sourcePath: "C:/a.jsonl" }];
      }
      if (command === "get_tool_session_messages") return [];
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.removeItem(viewKey);
    localStorage.removeItem(groupKey);
  });

  it("旧的纯文本视图模式仍按列表展示，切换与分组展开写回 JSON", async () => {
    localStorage.setItem(viewKey, "flat");
    localStorage.setItem(groupKey, JSON.stringify({ expandedProviderIds: [] }));
    renderPage();

    expect(await screen.findAllByText("可见会话")).toHaveLength(2);
    expect(localStorage.getItem(viewKey)).toBe(JSON.stringify("flat"));

    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(JSON.parse(localStorage.getItem(viewKey)!)).toBe("grouped");
    expect(screen.getAllByText("可见会话")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Claude/ }));
    expect(screen.getAllByText("可见会话")).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(groupKey)!)).toEqual({ expandedProviderIds: ["claude"] });
  });
});
