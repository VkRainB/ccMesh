import { describe, expect, it } from "vitest";

import { filterGroups } from "./modelListFilter";

const groups = [
  { name: "商01", models: ["deepseek-v4-flash", "glm-5.2"] },
  { name: "me-gpt", models: ["gpt-5.5", "gpt-image-2"] },
];

describe("filterGroups", () => {
  it("空关键字返回全部分组", () => {
    expect(filterGroups(groups, "  ")).toEqual(groups);
  });

  it("模型名命中只保留匹配条目，端点名命中保留该组全部模型", () => {
    expect(filterGroups(groups, "GLM")).toEqual([
      { name: "商01", models: ["glm-5.2"] },
    ]);
    expect(filterGroups(groups, "me-gpt")).toEqual([groups[1]]);
  });
});
