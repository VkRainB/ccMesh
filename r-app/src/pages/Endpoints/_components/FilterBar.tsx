import { LayoutGridIcon, ListIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useFilterStore, useLayoutStore } from "@/stores";

export function FilterBar({ onCreate }: { onCreate: () => void }) {
  const search = useFilterStore((s) => s.search);
  const enabledOnly = useFilterStore((s) => s.enabledOnly);
  const transformer = useFilterStore((s) => s.transformer);
  const setSearch = useFilterStore((s) => s.setSearch);
  const setEnabledOnly = useFilterStore((s) => s.setEnabledOnly);
  const setTransformer = useFilterStore((s) => s.setTransformer);
  const endpointView = useLayoutStore((s) => s.endpointView);
  const toggleEndpointView = useLayoutStore((s) => s.toggleEndpointView);

  return (
    <div className="flex items-center gap-3">
      <Input
        placeholder="搜索端点…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="max-w-xs"
      />
      <Select value={transformer} onValueChange={setTransformer}>
        <SelectTrigger className="w-32">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部类型</SelectItem>
          <SelectItem value="claude">claude</SelectItem>
          <SelectItem value="openai">openai</SelectItem>
        </SelectContent>
      </Select>
      <div className="flex items-center gap-2">
        <Switch id="enabled-only" checked={enabledOnly} onCheckedChange={setEnabledOnly} />
        <Label htmlFor="enabled-only" className="text-sm">
          仅启用
        </Label>
      </div>
      <div className="flex-1" />
      <Button
        size="icon"
        variant="ghost"
        aria-label={endpointView === "list" ? "切换到网格视图" : "切换到列表视图"}
        onClick={toggleEndpointView}
      >
        {endpointView === "list" ? (
          <LayoutGridIcon className="size-4" />
        ) : (
          <ListIcon className="size-4" />
        )}
      </Button>
      <Button onClick={onCreate}>
        <PlusIcon className="size-4" /> 新建端点
      </Button>
    </div>
  );
}
