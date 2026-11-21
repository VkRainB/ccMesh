import { useEffect, useId, useRef, useState } from "react";
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

function MonthCalendar({ month, onMonthChange, onPick, startDay, endDay = startDay }: {
  month: Date;
  onMonthChange: (month: Date) => void;
  onPick: (dayMs: number) => void;
  startDay: number;
  endDay?: number;
}) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const today = startOfTodayMs();
  return <div className="flex min-w-0 flex-1 flex-col gap-2">
    <div className="flex items-center justify-between">
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="上个月"
        onClick={() => onMonthChange(new Date(y, m - 1, 1))}>
        <ChevronLeftIcon className="size-4" />
      </Button>
      <span className="text-sm font-medium">{y}年{m + 1}月</span>
      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label="下个月"
        onClick={() => onMonthChange(new Date(y, m + 1, 1))}>
        <ChevronRightIcon className="size-4" />
      </Button>
    </div>
    <div className="grid grid-cols-7 text-center text-xs text-ink-mute">
      {WEEKDAYS.map((w) => <span key={w} className="py-1">{w}</span>)}
    </div>
    <div className="grid grid-cols-7 gap-px">
      {calendarDays(y, m).map((dayMs) => {
        const day = new Date(dayMs);
        const isEndpoint = dayMs === startDay || dayMs === endDay;
        return <button key={dayMs} type="button" aria-label={ymd(dayMs)} aria-pressed={isEndpoint}
          aria-current={dayMs === today ? "date" : undefined}
          onClick={() => onPick(dayMs)}
          className={cn(
            "h-7 rounded-sm text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            day.getMonth() !== m && "text-ink-mute/50",
            dayMs >= startDay && dayMs <= endDay && !isEndpoint && "bg-primary/10 text-primary",
            isEndpoint && "bg-primary font-medium text-primary-foreground",
            !isEndpoint && "hover:bg-surface-hover",
            dayMs === today && !isEndpoint && "ring-1 ring-primary/40",
          )}>
          {day.getDate()}
        </button>;
      })}
    </div>
  </div>;
}

/** 单点本地时间在主面板内展开，确认后才更新毫秒时间戳。 */
export function DateTimePicker({ value, onChange }: { value?: number; onChange: (at: number | undefined) => void }) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => new Date());
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const parsedDay = new Date(`${date}T12:00`).getTime();
  const day = Number.isFinite(parsedDay) && ymd(parsedDay) === date ? startOfDayMs(parsedDay) : NaN;
  const at = withTimePart(day, time);
  const valid = Number.isFinite(at) && ymd(at) === date && fmtTimeInput(at) === time;

  useEffect(() => {
    if (open) panel.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return <div className="min-w-0">
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" ref={trigger} size="sm" variant="outline" aria-expanded={open}
        aria-controls={open ? id : undefined} aria-label={value == null ? "预览时间" : `预览时间 ${ymd(value)} ${fmtTimeInput(value)}`}
        onClick={() => {
          if (!open) {
            const start = value ?? Date.now();
            setMonth(new Date(start));
            setDate(ymd(start));
            setTime(fmtTimeInput(start));
          }
          setOpen(!open);
        }}>
        <CalendarDaysIcon className="size-4 text-ink-secondary" />
        {value == null ? "选择预览时间" : `${ymd(value)} ${fmtTimeInput(value)}`}
      </Button>
      {value != null && <Button size="sm" variant="ghost" onClick={() => {
        onChange(undefined);
        close();
      }}>回到当前</Button>}
    </div>
    {open && <div id={id} ref={panel} role="group" aria-label="选择报价时间"
      className="mt-2 flex flex-col gap-3 rounded-md border border-edge bg-card p-3 sm:flex-row sm:items-start">
      <div className="flex w-full max-w-64"><MonthCalendar month={month} onMonthChange={setMonth}
        onPick={(dayMs) => {
          setDate(ymd(dayMs));
          setMonth(new Date(dayMs));
        }} startDay={day} /></div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <label className="flex flex-col gap-1 text-xs text-ink-secondary">日期
            <Input className="h-8 w-32 font-mono" placeholder="YYYY-MM-DD" value={date} onChange={(e) => {
              const text = e.target.value;
              setDate(text);
              const next = new Date(`${text}T12:00`);
              if (Number.isFinite(next.getTime()) && ymd(next.getTime()) === text) setMonth(next);
            }} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-secondary">时间
            <Input className="h-8 w-24 font-mono" placeholder="HH:mm" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
        </div>
        {!valid && <p className="text-xs text-destructive">请输入有效的本机日期和时间</p>}
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={close}>取消选择</Button>
          <Button size="sm" disabled={!valid} onClick={() => {
            onChange(at);
            close();
          }}>查看报价</Button>
        </div>
      </div>
    </div>}
  </div>;
}

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

          <MonthCalendar month={viewMonth} onMonthChange={setViewMonth} onPick={pickDay}
            startDay={startOfDayMs(draftStart)} endDay={startOfDayMs(draftEnd)} />
        </div>
      </PopoverContent>
    </Popover>
  );
}
