/** 按关键字过滤分组：端点名命中则保留该组全部模型，否则只留模型名命中的条目。 */
export function filterGroups(
  groups: { name: string; models: string[] }[],
  query: string,
) {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      models: g.name.toLowerCase().includes(q)
        ? g.models
        : g.models.filter((m) => m.toLowerCase().includes(q)),
    }))
    .filter((g) => g.models.length > 0);
}
