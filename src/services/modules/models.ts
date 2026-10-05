import { request } from "../request";

export interface ModelEntry {
  id: string;
  display_name: string;
  object?: string;
  owned_by?: string;
  endpoint_id?: string;
}

export interface ModelList {
  object: string;
  data: ModelEntry[];
}

export const modelsApi = {
  getModels: (forceRefresh = false) =>
    request<ModelList>("get_models", { forceRefresh }),
};
