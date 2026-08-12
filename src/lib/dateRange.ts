/**
 * 日期范围选择器的纯日期逻辑（月历网格、日期/时间部件合成）。
 * 与组件分离，便于单测（见 src/__tests__/dateRange.test.ts）。
 */

/** 42 格月历（周日起始、固定 6 行，GitHub 日历风格），返回每格当天 0 点毫秒。 */
export function calendarDays(year: number, monthIndex: number): number[] {
  const firstDow = new Date(year, monthIndex, 1).getDay();
  return Array.from({ length: 42 }, (_, i) =>
    new Date(year, monthIndex, 1 - firstDow + i).getTime(),
  );
}

/** 当天 0 点。 */
export function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** 换日保时：取 dayMs 的年月日 + ms 的时分。 */
export function withDayFrom(ms: number, dayMs: number): number {
  const t = new Date(ms);
  const d = new Date(dayMs);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    t.getHours(),
    t.getMinutes(),
  ).getTime();
}

/** 应用 input[type=date] 的值（YYYY-MM-DD），保留时分。无效输入原样返回。 */
export function withDatePart(ms: number, date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return ms;
  const t = new Date(ms);
  return new Date(+m[1], +m[2] - 1, +m[3], t.getHours(), t.getMinutes()).getTime();
}

/** 应用 input[type=time] 的值（HH:mm），保留年月日。无效输入原样返回。 */
export function withTimePart(ms: number, time: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!m) return ms;
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), +m[1], +m[2]).getTime();
}

/** input[type=time] 的值 HH:mm。 */
export function fmtTimeInput(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
