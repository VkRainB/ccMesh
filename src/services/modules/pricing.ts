import { request } from "../request";

/** USD / 百万 token；十进制字符串，最多 9 位小数。 */
export interface PriceRates {
  input: string;
  output: string;
  cacheRead: string;
  cacheWrite: string;
}

export interface PriceWindow {
  id: string;
  name: string;
  weekdays: number[];
  startMinute: number;
  endMinute: number;
  rates: PriceRates;
}

export interface ModelPricing {
  modelId: string;
  timezone: string;
  baseRates: PriceRates;
  windows: PriceWindow[];
}

export interface PricingSnapshot {
  modelId: string;
  timezone: string;
  source: "base" | "window";
  ruleId: string | null;
  ruleName: string | null;
  rates: PriceRates;
}

export interface ModelPriceQuote {
  requestedModel: string;
  modelId: string;
  baseRates: PriceRates | null;
  effectiveRates: PriceRates | null;
  timezone: string | null;
  ruleId: string | null;
  ruleName: string | null;
  source: "base" | "window" | null;
  at: number;
  nextChangeAt: number | null;
}

export interface CostBreakdown extends PriceRates {
  total: string;
}

export type CostStatus = "priced" | "unpriced" | "incomplete_usage" | "calculation_error" | "legacy_unknown";

export const pricingApi = {
  getPrices: (endpointId: number, modelIds?: string[], at?: number) =>
    request<ModelPriceQuote[]>("get_endpoint_model_prices", { endpointId, modelIds, at }),
};
