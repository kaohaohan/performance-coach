import assert from "node:assert/strict";
import test from "node:test";
import {
  dateRange,
  dayHeading,
  fullDate,
  monthDay,
  monthDayYear,
  monthYear,
  parseISODate,
  timeOfDay,
} from "./dates.ts";

// Every assertion names both locales with a fixed input date. Nothing here
// may depend on the host's default locale or zone: the point of D3 is that a
// coach in Taipei and a coach in Denver each see their own language, and a
// test that read `undefined` as the locale would pass on one machine and fail
// on the other.
//
// zh-TW conventions are genuinely different rather than translated word for
// word — the month/day order inverts, the year leads, and the weekday follows
// the date instead of preceding it. The expected strings below are the
// contract; a change to any of them is a visible product change.

const THURSDAY = "2026-09-03";

// --- parsing ----------------------------------------------------------

test("an ISO date is read at local midnight, not UTC", () => {
  const parsed = parseISODate(THURSDAY);
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 3);
  assert.equal(parsed.getHours(), 0);
});

test("a YYYY-MM prefix is read as the first of that month", () => {
  const parsed = parseISODate("2026-09");
  assert.equal(parsed.getMonth(), 8);
  assert.equal(parsed.getDate(), 1);
});

// The invite-code screens format `expiresAt`, which the Go API sends as a
// full ISO instant rather than a calendar day.
test("a full ISO timestamp is read as the instant it names, not its date half", () => {
  // 23:00 UTC on the 3rd is already the 4th in Taipei (UTC+8) and still the
  // 3rd in Denver (UTC-6), so slicing the string down to "2026-09-03" and
  // reading it at local midnight would show one of them the wrong day. The
  // instant is kept whole and Intl does the zone conversion.
  const late = "2026-09-03T23:00:00.000Z";
  assert.equal(parseISODate(late).getTime(), Date.parse(late));
  assert.notEqual(parseISODate(late).getTime(), parseISODate("2026-09-03").getTime());
});

// --- formats ----------------------------------------------------------

test("fullDate names the weekday in each language", () => {
  assert.equal(fullDate("en", THURSDAY), "Thursday, September 3");
  assert.equal(fullDate("zh-TW", THURSDAY), "9月3日星期四");
});

test("monthYear leads with the year in Chinese", () => {
  assert.equal(monthYear("en", THURSDAY), "September 2026");
  assert.equal(monthYear("zh-TW", THURSDAY), "2026年9月");
});

test("monthYear accepts a bare YYYY-MM, which is what the grid headings pass", () => {
  assert.equal(monthYear("en", "2026-09"), "September 2026");
  assert.equal(monthYear("zh-TW", "2026-09"), "2026年9月");
});

test("monthDay abbreviates in English and stays numeric in Chinese", () => {
  assert.equal(monthDay("en", THURSDAY), "Sep 3");
  assert.equal(monthDay("zh-TW", THURSDAY), "9月3日");
});

test("uppercasing a Chinese month/day is a no-op — call sites styling it must not rely on it", () => {
  const chinese = monthDay("zh-TW", THURSDAY);
  assert.equal(chinese.toUpperCase(), chinese);
  assert.notEqual(monthDay("en", THURSDAY).toUpperCase(), monthDay("en", THURSDAY));
});

test("monthDayYear puts the year where each language puts it", () => {
  assert.equal(monthDayYear("en", THURSDAY), "Sep 3, 2026");
  assert.equal(monthDayYear("zh-TW", THURSDAY), "2026年9月3日");
});

test("monthDayYear accepts a timestamp, which is what the invite-code screens pass", () => {
  // `expiresAt` reaches the same shape a bare "YYYY-MM-DD" would. The
  // expectation is the helper's own output for the local calendar day the
  // instant falls on, rather than a literal: no one instant is the same date
  // in every zone, and this file must not depend on the host's.
  const noon = "2026-09-03T12:00:00.000Z";
  const local = parseISODate(noon);
  const localDay = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`;
  for (const locale of ["en", "zh-TW"] as const) {
    assert.equal(monthDayYear(locale, noon), monthDayYear(locale, localDay));
  }
  assert.ok(monthDayYear("zh-TW", noon).includes("年"));
  assert.ok(!monthDayYear("zh-TW", noon).includes("Sep"));
});

test("timeOfDay uses each language's own clock convention", () => {
  // A fixed offset rather than a bare local time: the assertion is about the
  // *format*, so the instant has to be pinned independently of the host zone.
  const afternoon = new Date("2026-09-03T14:05:00Z");
  const options = { timeZone: "UTC" } as const;
  assert.equal(new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit", ...options }).format(afternoon), "2:05 PM");
  assert.equal(new Intl.DateTimeFormat("zh-TW", { hour: "numeric", minute: "2-digit", ...options }).format(afternoon), "下午2:05");
  // And that timeOfDay itself agrees with that formatter in the host zone.
  for (const locale of ["en", "zh-TW"] as const) {
    assert.equal(
      timeOfDay(locale, afternoon.toISOString()),
      new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(afternoon),
    );
  }
});

// --- week range -------------------------------------------------------

// The three cases the old hand-assembled version branched on. English output
// is unchanged from that version apart from ICU's thin spaces around the en
// dash, which is why the separator is written as an escape here rather than
// pasted in.
const THIN = "\u2009";
const DASH = "\u2013";

test("a week inside one month elides the repeated month and year", () => {
  assert.equal(dateRange("en", "2026-08-24", "2026-08-30"), `Aug 24${THIN}${DASH}${THIN}30, 2026`);
});

test("a week crossing a month keeps both months and one year", () => {
  assert.equal(dateRange("en", "2026-08-30", "2026-09-05"), `Aug 30${THIN}${DASH}${THIN}Sep 5, 2026`);
});

test("a week crossing a year keeps both years", () => {
  assert.equal(dateRange("en", "2026-12-28", "2027-01-03"), `Dec 28, 2026${THIN}${DASH}${THIN}Jan 3, 2027`);
});

test("Chinese renders a week span in its own order, never English's", () => {
  assert.equal(dateRange("zh-TW", "2026-08-24", "2026-08-30"), "2026/8/24至2026/8/30");
  assert.equal(dateRange("zh-TW", "2026-12-28", "2027-01-03"), "2026/12/28至2027/1/3");
  // The concrete regression this replaces: no fragment of English word order
  // survives into the Chinese span.
  assert.ok(!dateRange("zh-TW", "2026-08-24", "2026-08-30").includes("Aug"));
});

// --- day-card headings ------------------------------------------------

test("a week column leads with the weekday in English and the day in Chinese", () => {
  assert.equal(dayHeading("en", THURSDAY, "week"), "THU 3");
  assert.equal(dayHeading("zh-TW", THURSDAY, "week"), "3日 週四");
});

test("a month cell adds the month, in each language's own order", () => {
  assert.equal(dayHeading("en", THURSDAY, "month"), "THU, SEP 3");
  assert.equal(dayHeading("zh-TW", THURSDAY, "month"), "9月3日週四");
});

test("every weekday of a week renders in both locales", () => {
  // Sunday-first, the order monthDays()/monthGridDays() pad to.
  const week = ["2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
  assert.deepEqual(
    week.map((date) => dayHeading("en", date, "week")),
    ["SUN 30", "MON 31", "TUE 1", "WED 2", "THU 3", "FRI 4", "SAT 5"],
  );
  assert.deepEqual(
    week.map((date) => dayHeading("zh-TW", date, "week")),
    ["30日 週日", "31日 週一", "1日 週二", "2日 週三", "3日 週四", "4日 週五", "5日 週六"],
  );
});

// --- caching ----------------------------------------------------------

test("repeated formatting is stable — the formatter cache returns the same result", () => {
  // The Month view formats 42 cells per render off this cache; a cache keyed
  // wrongly would leak one locale's formatter into the other.
  assert.equal(fullDate("zh-TW", THURSDAY), "9月3日星期四");
  assert.equal(fullDate("en", THURSDAY), "Thursday, September 3");
  assert.equal(fullDate("zh-TW", THURSDAY), "9月3日星期四");
});
