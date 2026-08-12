import { useState } from "react";
import { CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  calendarDays,
  fmtTimeInput,
  startOfDayMs,
  withDatePart,
  withDayFrom,
  withTimePart,
} from "@/lib/dateRange";
import {
  RANGE_OPTIONS,
  rangeMs,
  rangeValueEquals,
  rangeValueLabel,
  startOfTodayMs,
  ymd,
  type RangeValue,
} from "@/lib/range";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const DAY_MS = 86_400_000;

/** 弹层顶部的快捷项：点击即生效（value 以当天 0 点锚点换算，支持任意区间）。 */
export interface RangePreset {
  key: string;
  label: string;
  value: (todayStartMs: number) => RangeValue;
}

/** 默认快捷项：沿用全局 RANGE_OPTIONS（今日/近7天/近30天/全部）。 */
const DEFAULT_PRESETS: RangePreset[] = RANGE_OPTIONS.map((o) => ({
  key: o.key,
  label: o.label,
  value: () => ({ kind: "preset", key: o.key }),
}));

interface Props {
  value: RangeValue;
  onChange: (v: RangeValue) => void;
  /** 自定义快捷项（默认今日/近7天/近30天/全部）。 */
  presets?: RangePreset[];
  /** Popover 对齐方向（默认 end，贴筛选栏右侧）。 */
  align?: "start" | "center" | "end";
  className?: string;
}

/**
 * 时间段选择器：预设周期一键生效 + 自定义起止日期时间（手写 42 格月历，参照 cc-switch）。
 * 预设点击即 apply；自定义为草稿态，「确定」校验 start<=end 后生效。
 */
export function DateRangePicker({
  value,
  onChange,
  presets = DEFAULT_PRESETS,
  align = "end",
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(0);
  const [draftEnd, setDraftEnd] = useState(0);
  const [activeField, setActiveField] = useState<"start" | "end">("start");
  const [viewMonth, setViewMonth] = useState(() => new Date());
  const [error, setError] = useState("");

  const openWithDraft = (next: boolean) => {
    if (next) {
      // 初始化草稿：自定义沿用当前值；预设换算成毫秒区间（上界取现在）
      const now = Date.now();
      const todayStart = startOfTodayMs(now);
      let s: number;
      let e: number;
      if (value.kind === "custom") {
        s = value.startMs;
        e = value.endMs;
      } else {
        const r = rangeMs(value.key, todayStart);
        s = r.startMs ?? todayStart - 29 * DAY_MS;
        e = now;
      }
      setDraftStart(s);
      setDraftEnd(e);
      setActiveField("start");
      setViewMonth(new Date(e));
      setError("");
    }
    setOpen(next);
  };

  const pickDay = (dayMs: number) => {
    setError("");
    if (activeField === "start") {
      setDraftStart(withDayFrom(draftStart, dayMs));
      // 起点晚于终点时把终点拖到同一天，保持区间有效
      if (dayMs > startOfDayMs(draftEnd)) setDraftEnd(withDayFrom(draftEnd, dayMs));
      setActiveField("end");
    } else if (dayMs < startOfDayMs(draftStart)) {
      // 终点早于起点 → 视为重选起点
      setDraftStart(withDayFrom(draftStart, dayMs));
    } else {
      setDraftEnd(withDayFrom(draftEnd, dayMs));
    }
  };

  const apply = () => {
    if (draftStart > draftEnd) {
      setError("开始时间不能晚于结束时间");
      return;
    }
    onChange({ kind: "custom", startMs: draftStart, endMs: draftEnd });
    setOpen(false);
  };

  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  const days = calendarDays(y, m);
  const startDay = startOfDayMs(draftStart);
  const endDay = startOfDayMs(draftEnd);
  const today = startOfTodayMs();
  // 当前值命中的快捷项（custom 快捷项按毫秒区间比对），触发按钮优先显示其文案
  const activePreset = presets.find((p) => rangeValueEquals(p.value(today), value));

  return (
    <Popover open={open} onOpenChange={openWithDraft}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn("gap-2 font-normal", className)}>
          <CalendarDaysIcon className="size-4 shrink-0 text-ink-secondary" />
          {activePreset?.label ?? rangeValueLabel(value)}
        </Button>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[620px] p-4">
        {/* 快捷项：点击即生效 */}
        <div className="flex flex-wrap gap-1.5 border-b border-edge-subtle pb-3">
          {presets.map((p) => (
            <Button
              key={p.key}
              size="sm"
              variant={activePreset?.key === p.key ? "default" : "outline"}
              onClick={() => {
                onChange(p.value(startOfTodayMs()));
                setOpen(false);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>

        <div className="flex gap-4 pt-3">
          {/* 左：起止时间输入 */}
          <div className="flex w-64 shrink-0 flex-col gap-3">
            {(
              [
                ["start", "开始时间", draftStart, setDraftStart],
                ["end", "结束时间", draftEnd, setDraftEnd],
              ] as const
            ).map(([field, label, ms, setMs]) => (
              <div
                key={field}
                onClick={() => setActiveField(field)}
                className={cn(
                  "flex cursor-pointer flex-col gap-1.5 rounded-md border p-2.5 text-left transition-colors",
                  activeField === field
                    ? "border-primary ring-1 ring-primary/40"
                    : "border-edge hover:border-edge-strong",
                )}
              >
                <span className="text-xs text-ink-secondary">{label}</span>
                <div className="flex gap-1.5">
                  <Input
                    type="date"
                    className="h-8 px-2 text-xs"
                    value={ymd(ms)}
                    onChange={(e) => {
                      setError("");
                      setMs(withDatePart(ms, e.target.value));
                    }}
                    onFocus={() => setActiveField(field)}
                  />
                  <Input
                    type="time"
                    step={60}
                    className="h-8 w-24 shrink-0 px-2 text-xs"
                    value={fmtTimeInput(ms)}
                    onChange={(e) => {
                      setError("");
                      setMs(withTimePart(ms, e.target.value));
                    }}
                    onFocus={() => setActiveField(field)}
                  />
                </div>
              </div>
            ))}
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="mt-auto flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={apply}>
                确定
              </Button>
            </div>
          </div>

          {/* 右：月历 */}
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex items-center justify-between">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                aria-label="上个月"
                onClick={() => setViewMonth(new Date(y, m - 1, 1))}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <span className="text-sm font-medium">
                {y}年{m + 1}月
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                aria-label="下个月"
                onClick={() => setViewMonth(new Date(y, m + 1, 1))}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </div>
            <div className="grid grid-cols-7 text-center text-xs text-ink-mute">
              {WEEKDAYS.map((w) => (
                <span key={w} className="py-1">
                  {w}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {days.map((dayMs) => {
                const inMonth = new Date(dayMs).getMonth() === m;
                const isStart = dayMs === startDay;
                const isEnd = dayMs === endDay;
                const isEndpoint = isStart || isEnd;
                const inRange = dayMs >= startDay && dayMs <= endDay;
                return (
                  <button
                    key={dayMs}
                    type="button"
                    onClick={() => pickDay(dayMs)}
                    className={cn(
                      "h-7 rounded-sm text-xs transition-colors",
                      !inMonth && "text-ink-mute/50",
                      inRange && !isEndpoint && "bg-primary/10 text-primary",
                      isEndpoint && "bg-primary font-medium text-primary-foreground",
                      !isEndpoint && "hover:bg-surface-hover",
                      dayMs === today && !isEndpoint && "ring-1 ring-primary/40",
                    )}
                  >
                    {new Date(dayMs).getDate()}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
