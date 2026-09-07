// Date helpers for the Coach Calendar. All dates are local-time ISO strings
// ("YYYY-MM-DD") — the same shape the API accepts for `from`/`to`/
// `scheduledDate`, so nothing here ever hands a Date object to the network
// layer. Parsing always appends "T00:00:00" so a date string is read in the
// viewer's local zone rather than UTC, which is what keeps "today" correct
// for coaches west of Greenwich.
//
// The *arithmetic* here is locale-independent and stays that way. Only the
// three label functions format for a reader, and since sub-task 6a (decision
// D3 in docs/tasks/2026-08-27-i18n-zh-tw.md) they take the active locale as
// their first argument and delegate the formatting to lib/i18n/dates.ts.
// Relative import rather than the "@/" alias so this module stays loadable
// under `node --test`.
import { dateRange, fullDate, monthYear } from "../../../lib/i18n/dates.ts";
import type { Locale } from "../../../lib/i18n/locale.ts";
import type { MessageKey } from "../../../lib/i18n/messages/en/index.ts";

export type CalendarView = "day" | "week" | "month";

// The column headers above a month grid, Sunday-first to match monthDays()
// and monthGridDays() below. Message keys rather than derived strings: the
// English day view shows Latin initials, which Chinese has no equivalent of
// (see messages/en/calendar.ts). Two sets because the two pickers have never
// used the same width.
export const WEEKDAY_NARROW_KEYS = [
  "calendar.weekdayNarrow.sun",
  "calendar.weekdayNarrow.mon",
  "calendar.weekdayNarrow.tue",
  "calendar.weekdayNarrow.wed",
  "calendar.weekdayNarrow.thu",
  "calendar.weekdayNarrow.fri",
  "calendar.weekdayNarrow.sat",
] as const satisfies readonly MessageKey[];

export const WEEKDAY_SHORT_KEYS = [
  "calendar.weekdayShort.sun",
  "calendar.weekdayShort.mon",
  "calendar.weekdayShort.tue",
  "calendar.weekdayShort.wed",
  "calendar.weekdayShort.thu",
  "calendar.weekdayShort.fri",
  "calendar.weekdayShort.sat",
] as const satisfies readonly MessageKey[];

export function todayLocalISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isValidISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

// invalidLabel is passed in rather than looked up: this module is React-free
// (so it stays testable under `node --test`), and the fallback is the one
// piece of *copy* the calendar's date helpers own. Callers hand over
// t("calendar.chooseDate").
export function displayDate(locale: Locale, date: string, invalidLabel: string): string {
  if (!isValidISODate(date)) return invalidLabel;
  return fullDate(locale, date);
}

export function monthLabel(locale: Locale, date: string): string {
  return monthYear(locale, date);
}

export function monthBounds(date: string): { start: string; end: string } {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

export function shiftMonth(date: string, amount: -1 | 1): string {
  const [year, month, day] = date.split("-").map(Number);
  const nextMonth = new Date(year, month - 1 + amount, 1);
  const nextDay = Math.min(day, new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate());
  return toISODate(new Date(nextMonth.getFullYear(), nextMonth.getMonth(), nextDay));
}

// monthDays returns the days of `date`'s month, padded at the front with
// nulls so index 0 lands on Sunday. Used by the Day view's mini month
// picker, which draws blanks rather than adjacent-month dates.
export function monthDays(date: string): Array<string | null> {
  const [year, month] = date.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const dayCount = new Date(year, month, 0).getDate();
  return [
    ...Array.from<null>({ length: firstWeekday }).fill(null),
    ...Array.from({ length: dayCount }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`),
  ];
}

function toISODate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return toISODate(new Date(year, month - 1, day + amount));
}

// weekDays returns Sunday-through-Saturday for the week containing `date`.
export function weekDays(date: string): string[] {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).getDay();
  const sunday = addDays(date, -weekday);
  return Array.from({ length: 7 }, (_, offset) => addDays(sunday, offset));
}

// monthGridDays returns the full 6x7 grid for `date`'s month, including the
// adjacent-month days that fill the leading and trailing cells. Unlike
// monthDays it has no nulls: the Month view shows real training on those
// spill-over days rather than blanks.
export function monthGridDays(date: string): string[] {
  const [year, month] = date.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const gridStart = addDays(`${year}-${String(month).padStart(2, "0")}-01`, -firstWeekday);
  return Array.from({ length: 42 }, (_, offset) => addDays(gridStart, offset));
}

export function isSameMonth(date: string, reference: string): boolean {
  return date.slice(0, 7) === reference.slice(0, 7);
}

// shiftView moves the anchor date by one unit of the current view: a day, a
// week, or a month.
export function shiftView(date: string, view: CalendarView, amount: -1 | 1): string {
  if (view === "day") return addDays(date, amount);
  if (view === "week") return addDays(date, amount * 7);
  return shiftMonth(date, amount);
}

// visibleRange is the [from, to] window to request from
// GET /api/v1/scheduled-workouts for the given view. Day still spans the
// whole month because its mini picker marks scheduled days across the month.
export function visibleRange(date: string, view: CalendarView): { start: string; end: string } {
  if (view === "week") {
    const days = weekDays(date);
    return { start: days[0], end: days[6] };
  }
  if (view === "month") {
    const grid = monthGridDays(date);
    return { start: grid[0], end: grid[grid.length - 1] };
  }
  return monthBounds(date);
}

// rangeLabel is the heading above the grid: "August 2026" for day/month,
// and an explicit span for a week that crosses a month or year boundary.
export function rangeLabel(locale: Locale, date: string, view: CalendarView, invalidLabel: string): string {
  if (view === "day") return displayDate(locale, date, invalidLabel);
  if (view === "month") return monthLabel(locale, date);

  // The three-branch hand assembly this replaced existed because asking Intl
  // for { day, year } without a month yields "2026 (day: 22)". The answer is
  // Intl's own formatRange, which elides the shared month or year itself —
  // and, unlike concatenation, does it in each language's word order. See
  // dateRange() in lib/i18n/dates.ts; the English output is unchanged.
  const days = weekDays(date);
  return dateRange(locale, days[0], days[6]);
}
