import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { TabularText } from "@/components/ui";
import { Button } from "@/components/ui/button";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

/** 受控分页：上一页/下一页 + 页码信息。 */
export function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
      <span>
        共 <TabularText>{total}</TabularText> 条 · 第 <TabularText>{page}</TabularText>/
        <TabularText>{totalPages}</TabularText> 页
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="上一页"
        >
          <ChevronLeftIcon />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="下一页"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
