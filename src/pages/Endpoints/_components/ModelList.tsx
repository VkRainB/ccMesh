import { useState } from "react";
import { InfoIcon } from "lucide-react";
import { toast } from "sonner";

import { SearchBox } from "@/components/common/SearchBox";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEndpoints } from "@/hooks/useEndpoints";
import { getModelIcon } from "@/lib/model-icons";
import { advertisedModels } from "@/services/modules/endpoint";

import { filterGroups } from "./modelListFilter";

/** 复制文本到剪贴板，navigator.clipboard 不可用时降级 execCommand。 */
async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

/** 按启用端点分组展示其对外可用模型（出站模型 + 映射入站名）。 */
export function ModelList() {
  const { data: endpoints } = useEndpoints();
  const [query, setQuery] = useState("");
  const allGroups = (endpoints ?? [])
    .filter((e) => e.enabled)
    .map((e) => ({
      name: e.name,
      models: advertisedModels(e),
    }))
    .filter((g) => g.models.length > 0);
  const groups = filterGroups(allGroups, query);

  const onCopy = (model: string) =>
    copyText(model)
      .then(() => toast.success(`已复制 ${model}`))
      .catch(() => toast.error("复制失败"));

  return (
    <section className="flex h-full flex-col gap-3 rounded-lg border border-edge p-4">
      <div className="relative h-9 shrink-0">
        <h2 className="flex h-full items-center gap-1.5 text-sm font-medium text-ink-secondary">
          可用模型
          <Tooltip>
            <TooltipTrigger asChild>
              <InfoIcon className="size-3.5 cursor-help text-ink-disabled" />
            </TooltipTrigger>
            <TooltipContent>按启用端点</TooltipContent>
          </Tooltip>
        </h2>
        {/* 收起仅图标；展开与端点搜索同宽（w-64），窄于标题行时不超过内容区 */}
        <div className="pointer-events-none absolute top-0 right-0 flex h-9 w-64 max-w-full items-center justify-end">
          <SearchBox
            value={query}
            onChange={setQuery}
            placeholder="搜索模型…"
            ariaLabel="搜索可用模型"
            className="w-full"
          />
        </div>
      </div>
      {allGroups.length === 0 ? (
        <p className="text-sm text-ink-mute">暂无模型（在端点中配置模型清单或锁定模型）</p>
      ) : groups.length === 0 ? (
        <p className="text-sm text-ink-mute">没有匹配的模型</p>
      ) : (
        <div className="scrollbar-none flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          {groups.map((g) => (
            <div key={g.name} className="flex flex-col gap-1.5">
              <span className="text-xs text-ink-mute">
                {g.name} <span className="text-ink-disabled">({g.models.length})</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {g.models.map((m, i) => {
                  const ModelIcon = getModelIcon(m);
                  return (
                    <Badge
                      key={`${m}-${i}`}
                      variant="muted"
                      role="button"
                      tabIndex={0}
                      onClick={() => onCopy(m)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onCopy(m);
                        }
                      }}
                      className="flex cursor-pointer select-none items-center gap-1 transition-colors hover:bg-surface-hover"
                    >
                      <ModelIcon size={14} className="shrink-0" />
                      {m}
                    </Badge>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
