// Locale-aware date formatting — decision D3 in
// docs/tasks/2026-08-27-i18n-zh-tw.md. Every `Intl.DateTimeFormat("en-US", …)`
// that renders *display* copy resolves through here instead, so a 繁中 UI stops
// showing English weekday and month names.
//
// React-free, like locale.ts and errors.ts and for the same reason: `node --test`
// strips TypeScript types but cannot parse JSX, so anything living in a .tsx
// file is untestable in this repo. `locale` is therefore a parameter, never a
// hook call — components read it once with useLocale() and pass it in.
//
// Two things deliberately do NOT live here:
//
//  * The relative labels (Yesterday / Today / Tomorrow) planned in
//    docs/tasks/2026-08-27-today-relative-date-labels.md. Those are
//    message-catalog keys with an absolute fallback; whichever task lands
//    second wraps these functions rather than adding a second formatter.
//  * `fallbackWorkoutName` in app/coach/calendar/page.tsx. It generates a
//    *persisted* workout name, which is data rather than display copy — see
//    decision D4.
import type { Locale } from "./locale.ts";

// Intl.DateTimeFormat construction is the expensive half of formatting, and
// the calendar's Month view formats 42 day cells on every render. Options are
// fixed per call site, so a small cache keyed by locale + options is enough;
// it never grows past the handful of shapes below.
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const cacheKey = `${locale}\u0000${JSON.stringify(options)}`;
  const cached = formatters.get(cacheKey);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, options);
  formatters.set(cacheKey, created);
  return created;
}

// parseISODate reads a local-time "YYYY-MM-DD" the way the whole calendar
// does: appending "T00:00:00" so the string is interpreted in the viewer's
// zone rather than UTC, which is what keeps "today" correct for coaches west
// of Greenwich. A "YYYY-MM" prefix is accepted and read as the first of that
// month, for the month-heading call sites.
//
// A full ISO *timestamp* — anything carrying a "T", which is how the API
// sends an invite code's `expiresAt` — names an instant rather than a
// calendar day, so it is parsed as-is and then rendered in the viewer's
// zone. That distinction is not pedantry: a code expiring at 23:00 UTC has
// already rolled into the next day for a coach in Taipei, and the next day
// is the date to show them. Slicing the string down to its date half would
// show the UTC day instead, which is a different day.
export function parseISODate(date: string): Date {
  if (date.includes("T")) return new Date(date);
  const day = date.length === 7 ? `${date}-01` : date;
  return new Date(`${day}T00:00:00`);
}

// fullDate is the long-form heading: the athlete's Today title and the
// calendar's selected-day label.
//   en    → "Thursday, September 3"
//   zh-TW → "9月3日星期四"
export function fullDate(locale: Locale, date: string): string {
  return formatter(locale, { weekday: "long", month: "long", day: "numeric" }).format(parseISODate(date));
}

// monthYear is the month heading above a grid. Takes "YYYY-MM" or a full date.
//   en    → "September 2026"
//   zh-TW → "2026年9月"
export function monthYear(locale: Locale, date: string): string {
  return formatter(locale, { month: "long", year: "numeric" }).format(parseISODate(date.slice(0, 7)));
}

// monthDay is the compact date used in list rows.
//   en    → "Sep 3"
//   zh-TW → "9月3日"
//
// Worth noting for callers that style it: English abbreviates to three Latin
// letters that survive `uppercase` and letter-spacing, Chinese does not.
// `.toUpperCase()` on "9月3日" is a no-op and tracking pushes CJK glyphs apart.
export function monthDay(locale: Locale, date: string): string {
  return formatter(locale, { month: "short", day: "numeric" }).format(parseISODate(date));
}

// monthDayYear is monthDay plus the year, for dates far enough from today
// that the year matters (a client's join date, an invite code's expiry).
// Both expiry call sites pass a full ISO timestamp, which parseISODate
// handles — see its note on why that is not the same as its date half.
//   en    → "Sep 3, 2026"
//   zh-TW → "2026年9月3日"
export function monthDayYear(locale: Locale, date: string): string {
  return formatter(locale, { year: "numeric", month: "short", day: "numeric" }).format(parseISODate(date));
}

// timeOfDay formats a full ISO timestamp, not a date string — the calendar's
// only caller is the "Draft saved at …" chip.
//   en    → "2:05 PM"
//   zh-TW → "下午2:05"
export function timeOfDay(locale: Locale, iso: string): string {
  return formatter(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

// dateRange is the week heading: one span, with the shared month or year
// elided when both ends agree.
//   en    → "Aug 24 – 30, 2026" / "Aug 30 – Sep 5, 2026" / "Dec 28, 2026 – Jan 3, 2027"
//   zh-TW → "2026/8/24至2026/8/30"
//
// formatRange does the eliding, which is why this replaced the hand-assembled
// version calendar-date.ts carried. That version existed because asking Intl
// for { day, year } without a month yields "2026 (day: 22)" — true, but the
// answer is formatRange rather than string concatenation, and concatenation
// could only ever have produced English word order ("9月22日 – 28, 2026").
// The English output is unchanged apart from the thin spaces ICU puts either
// side of the en dash.
export function dateRange(locale: Locale, startDate: string, endDate: string): string {
  return formatter(locale, { year: "numeric", month: "short", day: "numeric" }).formatRange(
    parseISODate(startDate),
    parseISODate(endDate),
  );
}

// DayHeadingDensity mirrors day-card.tsx's Density: a week column has room
// for the weekday and the day number, a month cell adds the month so a
// spill-over day from the adjacent month is not ambiguous.
export type DayHeadingDensity = "week" | "month";

// The week heading is the one format Intl has no pattern for — it is a
// bespoke two-part compaction, so the word order is spelled out per locale.
// English leads with the weekday; Chinese names the day first and qualifies
// it with the weekday, the same order as the month heading Intl produces
// ("9月3日週四").
const WEEK_HEADING: Record<Locale, (weekday: string, dayOfMonth: number) => string> = {
  en: (weekday, dayOfMonth) => `${weekday.toUpperCase()} ${dayOfMonth}`,
  "zh-TW": (weekday, dayOfMonth) => `${dayOfMonth}日 ${weekday}`,
};

// dayHeading is the label on a calendar day card.
//   en    → "THU 3"   / "THU, SEP 3"
//   zh-TW → "3日 週四" / "9月3日週四"
//
// The uppercasing stays in the string rather than relying only on the
// component's `uppercase` class, matching what the card rendered before. It
// is a no-op on Chinese, which is the point: the helper needs no branch for
// it, but day-card.tsx does drop its letter-spacing for CJK.
export function dayHeading(locale: Locale, date: string, density: DayHeadingDensity): string {
  const parsed = parseISODate(date);
  if (density === "month") {
    return formatter(locale, { weekday: "short", month: "short", day: "numeric" }).format(parsed).toUpperCase();
  }
  const weekday = formatter(locale, { weekday: "short" }).format(parsed);
  return WEEK_HEADING[locale](weekday, parsed.getDate());
}
