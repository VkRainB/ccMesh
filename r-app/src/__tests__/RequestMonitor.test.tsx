import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RequestLogTable } from "@/components/business/RequestMonitor";
import type { RequestLog } from "@/services/modules/stats";

const log: RequestLog = {
  id: 1,
  ts: Date.now(),
  endpointName: "ep-a",
  inboundFormat: "claude",
  upstreamUrl: "https://up.example",
  statusCode: 200,
  isError: false,
  inputTokens: 10,
  outputTokens: 5,
  cacheCreationTokens: 2,
  cacheReadTokens: 3,
  model: "claude-3",
  durationMs: 120,
};

describe("RequestLogTable", () => {
  it("渲染请求行、状态码与 Token 合计", () => {
    render(<RequestLogTable items={[log]} />);
    expect(screen.getByText("ep-a")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
    // Token 合计 = 10 + 5 + 2 + 3
    expect(screen.getByText("20")).toBeInTheDocument();
  });

  it("空数据显示占位", () => {
    render(<RequestLogTable items={[]} />);
    expect(screen.getByText("暂无请求记录")).toBeInTheDocument();
  });
});
