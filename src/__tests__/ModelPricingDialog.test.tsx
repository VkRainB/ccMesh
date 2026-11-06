import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { ModelPricingDialog } from "@/pages/Endpoints/_components/ModelPricingDialog";
import { ModelPriceQuoteView } from "@/pages/Endpoints/_components/ModelPriceQuoteView";
import { endpointApi, type Endpoint } from "@/services/modules/endpoint";
import { pricingApi, type ModelPriceQuote } from "@/services/modules/pricing";

const endpoint: Endpoint = {
  id: 7, name: "channel", apiUrl: "https://example.test", apiKey: "", authMode: "bearer",
  enabled: true, useProxy: false, transformer: "openai", model: "", models: ["actual"], activeModels: [],
  modelMappings: [{ from: "alias", to: "actual" }], modelMappingsEnabled: true, modelPricing: [],
  headerOverrides: [], headerOverridesEnabled: true, remark: "", sortOrder: 0, fast: false,
  fastSortOrder: 0, testStatus: "", createdAt: "", updatedAt: "", archived: false,
};
const quote: ModelPriceQuote = {
  requestedModel: "alias", modelId: "actual", baseRates: null, effectiveRates: null,
  timezone: null, ruleId: null, ruleName: null, source: null, at: 0, nextChangeAt: null,
};

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  vi.spyOn(pricingApi, "getPrices").mockResolvedValue([quote]);
  vi.spyOn(endpointApi, "onChanged").mockResolvedValue(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("模型价格编辑", () => {
  it("四价初始为空，免费必须明确填零；保存失败及配置事件不丢编辑", async () => {
    const update = vi.spyOn(endpointApi, "update").mockRejectedValue(new Error("该模型存在重叠的价格时段"));
    const close = vi.fn();
    mount(<ModelPricingDialog open endpoint={endpoint} onOpenChange={close} />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    for (const label of ["输入", "输出", "缓存读取", "缓存创建"]) expect(screen.getByLabelText(label)).toHaveValue("");
    fireEvent.change(screen.getByLabelText("出站模型 ID（可选择或手输）"), { target: { value: "actual" } });
    fireEvent.click(screen.getByRole("button", { name: "保存价格" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("价格必须是非负十进制数");
    expect(update).not.toHaveBeenCalled();
    for (const label of ["输入", "输出", "缓存读取", "缓存创建"]) fireEvent.change(screen.getByLabelText(label), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存价格" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(7, { modelPricing: [{ modelId: "actual", timezone: "Asia/Shanghai", baseRates: { input: "0", output: "0", cacheRead: "0", cacheWrite: "0" }, windows: [] }] }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("该模型存在重叠的价格时段"));
    act(() => { const calls = vi.mocked(endpointApi.onChanged).mock.calls; calls[calls.length - 1]?.[0](); });
    expect(screen.getByLabelText("输入")).toHaveValue("0");
    expect(close).not.toHaveBeenCalled();
  });

  it("多时段保存完整四价、ISO 星期与跨午夜/24:00 边界", async () => {
    const update = vi.spyOn(endpointApi, "update").mockResolvedValue(endpoint);
    mount(<ModelPricingDialog open endpoint={endpoint} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    fireEvent.change(screen.getByLabelText("出站模型 ID（可选择或手输）"), { target: { value: "actual" } });
    fireEvent.click(screen.getByRole("button", { name: "添加时段" }));
    fireEvent.change(screen.getByLabelText("时段名称"), { target: { value: "夜间" } });
    fireEvent.change(screen.getByLabelText("开始（HH:mm）"), { target: { value: "22:00" } });
    fireEvent.change(screen.getByLabelText("结束（允许 24:00）"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "周五" }));
    fireEvent.click(screen.getByRole("button", { name: "添加时段" }));
    fireEvent.change(screen.getAllByLabelText("时段名称")[1], { target: { value: "周日" } });
    fireEvent.change(screen.getAllByLabelText("开始（HH:mm）")[1], { target: { value: "00:00" } });
    fireEvent.change(screen.getAllByLabelText("结束（允许 24:00）")[1], { target: { value: "24:00" } });
    fireEvent.click(screen.getAllByRole("button", { name: "周日" })[1]);
    for (const label of ["输入", "输出", "缓存读取", "缓存创建"]) {
      for (const input of screen.getAllByLabelText(label)) fireEvent.change(input, { target: { value: "0.123456789" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "保存价格" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    const windows = update.mock.calls[0][1].modelPricing?.[0].windows;
    expect(windows).toHaveLength(2);
    expect(windows?.[0]).toMatchObject({ name: "夜间", weekdays: [5], startMinute: 1320, endMinute: 480 });
    expect(windows?.[1]).toMatchObject({ name: "周日", weekdays: [7], startMinute: 0, endMinute: 1440,
      rates: { input: "0.123456789", output: "0.123456789", cacheRead: "0.123456789", cacheWrite: "0.123456789" } });
  });

  it("删除需要确认且保留历史说明，取消不会移除编辑项", () => {
    mount(<ModelPricingDialog open endpoint={endpoint} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    fireEvent.click(screen.getByRole("button", { name: "删除模型价格" }));
    expect(screen.getByText("删除后，新请求将显示未配置价格；历史估算成本保持不变。")).toBeInTheDocument();
    const cancel = screen.getAllByRole("button", { name: "取消" });
    fireEvent.click(cancel[cancel.length - 1]);
    expect(screen.getByLabelText("出站模型 ID（可选择或手输）")).toBeInTheDocument();
  });
});

describe("后端模型报价", () => {
  it("别名由后端解析，聚焦、事件及指定时间重新查询", async () => {
    mount(<ModelPriceQuoteView endpointId={7} modelId="alias" />);
    expect(await screen.findByText("alias → actual")).toBeInTheDocument();
    expect(screen.getByText("未配置价格")).toBeInTheDocument();
    expect(pricingApi.getPrices).toHaveBeenCalledWith(7, ["alias"], undefined);
    const before = vi.mocked(pricingApi.getPrices).mock.calls.length;
    fireEvent(window, new Event("focus"));
    await waitFor(() => expect(vi.mocked(pricingApi.getPrices).mock.calls.length).toBeGreaterThan(before));
    const eventBefore = vi.mocked(pricingApi.getPrices).mock.calls.length;
    act(() => { vi.mocked(endpointApi.onChanged).mock.calls[0][0](); });
    await waitFor(() => expect(vi.mocked(pricingApi.getPrices).mock.calls.length).toBeGreaterThan(eventBefore));
    fireEvent.change(screen.getByLabelText("预览时间"), { target: { value: "2026-11-06T12:00" } });
    await waitFor(() => expect(pricingApi.getPrices).toHaveBeenLastCalledWith(7, ["alias"], new Date("2026-11-06T12:00").getTime()));
  });

  it("下次变化仅触发后端重查，不在前端选择时段", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    vi.mocked(pricingApi.getPrices).mockResolvedValueOnce([{ ...quote, nextChangeAt: now + 1000 }]).mockResolvedValue([quote]);
    mount(<ModelPriceQuoteView endpointId={7} modelId="alias" />);
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const before = vi.mocked(pricingApi.getPrices).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(vi.mocked(pricingApi.getPrices).mock.calls.length).toBeGreaterThan(before);
    expect(pricingApi.getPrices).toHaveBeenLastCalledWith(7, ["alias"], undefined);
  });
});
