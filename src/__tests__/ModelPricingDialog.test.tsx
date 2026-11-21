import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { TooltipProvider } from "@/components/ui/tooltip";
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
  return render(<QueryClientProvider client={client}><TooltipProvider>{ui}</TooltipProvider></QueryClientProvider>);
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
    fireEvent.change(screen.getByLabelText("出站模型 ID"), { target: { value: "actual" } });
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
    mount(<ModelPricingDialog open endpoint={{ ...endpoint, models: ["other"], modelMappings: [{ from: "alias", to: "actual" }] }} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    fireEvent.click(screen.getByRole("button", { name: "选择模型" }));
    fireEvent.change(screen.getByPlaceholderText("搜索模型…"), { target: { value: "act" } });
    expect(screen.queryByRole("button", { name: "other" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "actual" }));
    for (const label of ["输入", "输出", "缓存读取", "缓存创建"]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value: "0.123456789" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "添加时段" }));
    fireEvent.change(screen.getByLabelText("时段名称"), { target: { value: "夜间" } });
    fireEvent.change(screen.getByLabelText("开始（HH:mm）"), { target: { value: "22:00" } });
    fireEvent.change(screen.getByLabelText("结束（允许 24:00）"), { target: { value: "08:00" } });
    fireEvent.click(screen.getByRole("button", { name: "周五" }));
    fireEvent.click(screen.getByRole("button", { name: "复制默认价" }));
    fireEvent.click(screen.getByRole("button", { name: "添加时段" }));
    fireEvent.change(screen.getByLabelText("时段名称"), { target: { value: "周日" } });
    fireEvent.change(screen.getByLabelText("开始（HH:mm）"), { target: { value: "00:00" } });
    fireEvent.change(screen.getByLabelText("结束（允许 24:00）"), { target: { value: "24:00" } });
    fireEvent.click(screen.getByRole("button", { name: "周末" }));
    fireEvent.click(screen.getByRole("button", { name: "周六" }));
    fireEvent.click(screen.getByRole("button", { name: "复制默认价" }));
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
    expect(screen.getByText(/删除后，新请求将回退自动价/)).toBeInTheDocument();
    const cancel = screen.getAllByRole("button", { name: "取消" });
    fireEvent.click(cancel[cancel.length - 1]);
    expect(screen.getByLabelText("出站模型 ID")).toBeInTheDocument();
  });

  it("官方 DeepSeek 模板生成低谷默认价和两个高峰，已有草稿需确认", async () => {
    const update = vi.spyOn(endpointApi, "update").mockResolvedValue(endpoint);
    mount(<ModelPricingDialog open endpoint={{ ...endpoint, apiUrl: "https://api.deepseek.com/anthropic" }} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    fireEvent.change(screen.getByLabelText("出站模型 ID"), { target: { value: "deepseek-v4-pro" } });
    fireEvent.change(screen.getByLabelText("输入"), { target: { value: "9" } });
    const openPreset = () => {
      fireEvent.click(screen.getByRole("button", { name: "DeepSeek 价格快捷设置" }));
      return within(screen.getByRole("dialog", { name: "DeepSeek 价格快捷设置" }));
    };
    let preset = openPreset();
    expect(preset.getByText(/覆盖当前草稿中的默认价/)).toBeInTheDocument();
    expect(preset.getByText(/不自动排除中国法定节假日/)).toBeInTheDocument();
    expect(preset.queryByRole("button", { name: "填入 Flash" })).not.toBeInTheDocument();
    fireEvent.click(preset.getByRole("button", { name: "取消" }));
    expect(screen.getByLabelText("输入")).toHaveValue("9");
    preset = openPreset();
    fireEvent.click(preset.getByRole("button", { name: "填入 Pro" }));
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存价格" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0][1].modelPricing?.[0]).toMatchObject({
      modelId: "deepseek-v4-pro", timezone: "Asia/Shanghai",
      baseRates: { input: "0.66", output: "1.98", cacheRead: "0.022", cacheWrite: "0" },
      windows: [
        { weekdays: [1, 2, 3, 4, 5], startMinute: 540, endMinute: 720,
          rates: { input: "1.32", output: "3.96", cacheRead: "0.044", cacheWrite: "0" } },
        { weekdays: [1, 2, 3, 4, 5], startMinute: 840, endMinute: 1080,
          rates: { input: "1.32", output: "3.96", cacheRead: "0.044", cacheWrite: "0" } },
      ],
    });
  });

  it("第三方端点可手动套用 Flash，保留渠道模型 ID 且保存前不改价格", async () => {
    const update = vi.spyOn(endpointApi, "update").mockResolvedValue(endpoint);
    mount(<ModelPricingDialog open endpoint={endpoint} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    fireEvent.change(screen.getByLabelText("出站模型 ID"), { target: { value: "vendor/flash" } });
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek 价格快捷设置" }));
    const preset = within(screen.getByRole("dialog", { name: "DeepSeek 价格快捷设置" }));
    expect(preset.getByText(/第三方端点以渠道实际价格为准/)).toBeInTheDocument();
    fireEvent.click(preset.getByRole("button", { name: "填入 Flash" }));
    expect(screen.getByLabelText("出站模型 ID")).toHaveValue("vendor/flash");
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存价格" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(7, { modelPricing: [expect.objectContaining({
      modelId: "vendor/flash", baseRates: { input: "0.15", output: "0.6", cacheRead: "0.003", cacheWrite: "0" },
      windows: [expect.objectContaining({ rates: { input: "0.3", output: "1.2", cacheRead: "0.006", cacheWrite: "0" } }), expect.anything()],
    })] }));
  });

  it("空白模型使用模板 ID，不生成重复价格行", () => {
    mount(<ModelPricingDialog open endpoint={endpoint} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek 价格快捷设置" }));
    fireEvent.click(screen.getByRole("button", { name: "填入 Flash" }));
    expect(screen.getByLabelText("出站模型 ID")).toHaveValue("deepseek-flash");
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    fireEvent.click(screen.getByRole("button", { name: "DeepSeek 价格快捷设置" }));
    expect(screen.getByRole("button", { name: "Flash 已配置" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "填入 Pro" }));
    expect(screen.getByLabelText("出站模型 ID")).toHaveValue("deepseek-v4-pro");
    expect(screen.getByRole("button", { name: "deepseek-flash" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "新模型" })).not.toBeInTheDocument();
  });

  it("第三方 DeepSeek 可另从自动报价填入默认价，而不自动套用峰谷价", async () => {
    const rates = { input: "0.22", output: "1.1", cacheRead: "0.07", cacheWrite: "0.18" };
    vi.mocked(pricingApi.getPrices).mockResolvedValue([{ ...quote, requestedModel: "deepseek-flash", modelId: "deepseek-flash", source: "auto", effectiveRates: rates }]);
    mount(<ModelPricingDialog open endpoint={endpoint} onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "添加模型价格" }));
    fireEvent.change(screen.getByLabelText("出站模型 ID"), { target: { value: "deepseek-flash" } });
    expect(screen.getByLabelText("输入")).toHaveValue("");
    fireEvent.click(await screen.findByRole("button", { name: "填入默认价" }));
    expect(screen.getByLabelText("输入")).toHaveValue(rates.input);
    expect(screen.getByLabelText("缓存创建")).toHaveValue(rates.cacheWrite);
    expect(screen.queryByText("上午高峰")).not.toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "预览时间" }));
    fireEvent.change(screen.getByLabelText("日期"), { target: { value: "2026-11-06" } });
    fireEvent.click(screen.getByRole("button", { name: "2026-11-07" }));
    fireEvent.change(screen.getByLabelText("时间"), { target: { value: "29:00" } });
    expect(screen.getByRole("button", { name: "查看报价" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("时间"), { target: { value: "12:00" } });
    expect(pricingApi.getPrices).toHaveBeenLastCalledWith(7, ["alias"], undefined);
    fireEvent.click(screen.getByRole("button", { name: "查看报价" }));
    await waitFor(() => expect(pricingApi.getPrices).toHaveBeenLastCalledWith(7, ["alias"], new Date(2026, 10, 7, 12).getTime()));
    fireEvent.click(screen.getByRole("button", { name: /预览时间 2026-11-07/ }));
    fireEvent.change(screen.getByLabelText("时间"), { target: { value: "13:00" } });
    fireEvent.click(screen.getByRole("button", { name: "取消选择" }));
    expect(screen.getByRole("button", { name: /预览时间 2026-11-07 12:00/ })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "回到当前" }));
    await waitFor(() => expect(pricingApi.getPrices).toHaveBeenLastCalledWith(7, ["alias"], undefined));
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
