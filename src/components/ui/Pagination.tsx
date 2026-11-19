import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { TabularText } from "@/components/ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** 含首尾页的页码按钮上限，奇数。超出后折叠为省略号。 */
  pagerCount?: number;
}

/** 页码序列。0 表示省略号。pagerCount 含首尾，超出后按当前位置开窗。 */
export function pageItems(current: number, totalPages: number, pagerCount = 7): number[] {
  const count = Math.max(5, pagerCount % 2 === 0 ? pagerCount - 1 : pagerCount);
  if (totalPages <= count) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const half = (count - 1) / 2;
  const showPrevMore = current > count - half;
  const showNextMore = current < totalPages - half;
  const items = [1];
  if (showPrevMore && !showNextMore) {
    items.push(0);
    for (let i = totalPages - (count - 2); i < totalPages; i++) items.push(i);
  } else if (!showPrevMore && showNextMore) {
    for (let i = 2; i < count; i++) items.push(i);
    items.push(0);
  } else {
    const offset = Math.floor(count / 2) - 1;
    items.push(0);
    for (let i = current - offset; i <= current + offset; i++) items.push(i);
    items.push(0);
  }
  items.push(totalPages);
  return items;
}

/** 受控分页：总条数 + 页码按钮，超出 pagerCount 时用省略号折叠。 */
export function Pagination({ page, pageSize, total, onPageChange, pagerCount = 7 }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-ink-secondary">
      <span>
        共 <TabularText>{total}</TabularText> 条
      </span>
      <div className="flex items-center gap-0.5">
        <Button
          variant="outline"
          size="icon-sm"
          disabled={safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="上一页"
        >
          <ChevronLeftIcon />
        </Button>
        {pageItems(safePage, totalPages, pagerCount).map((n, index) =>
          n === 0 ? (
            <span key={`ellipsis-${index}`} className="px-1 text-ink-mute" aria-hidden="true">…</span>
          ) : (
            <button
              key={n}
              type="button"
              aria-label={`第 ${n} 页`}
              aria-current={n === safePage ? "page" : undefined}
              className={cn(
                "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-1 tabular-nums",
                n === safePage ? "font-medium text-primary" : "text-ink-secondary hover:bg-surface-hover hover:text-foreground",
              )}
              onClick={() => { if (n !== safePage) onPageChange(n); }}
            >
              {n}
            </button>
          ),
        )}
        <Button
          variant="outline"
          size="icon-sm"
          disabled={safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="下一页"
        >
          <ChevronRightIcon />
        </Button>
      </div>
    </div>
  );
}
