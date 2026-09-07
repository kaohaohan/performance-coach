// Display-only localization of Exercise names — option B in
// docs/tasks/2026-09-07-exercise-library-i18n.md.
//
// Why a display map and not translated rows in the database: an Exercise's
// name IS its identity, not just its label.
//
//   * 0001_init_schema.up.sql:33 — UNIQUE INDEX on lower(name) for the system
//     catalog (owner_coach_id IS NULL).
//   * apps/api/internal/exercise/exercise.go:188 findVisibleByName — the API
//     resolves an Exercise by lower(name), find-or-create.
//   * apps/web/app/coach/calendar/page.tsx buildExercisesPayload — the client
//     sends `name`, never `exerciseId`.
//
// So a Chinese name on the wire would not match the English system row: it
// would silently CREATE a private duplicate and fork the catalog per language,
// with training history split across both. Names therefore stay English
// everywhere they are stored, sent, or compared, and are translated only at
// the moment they are painted. See the task doc §1 for the rejected options.
//
// React-free and locale-as-a-parameter, exactly like dates.ts and errors.ts:
// `node --test` strips TypeScript types but cannot parse JSX, so logic that
// lives in a .tsx file cannot be unit-tested in this repo. Components read the
// locale once with useLocale() and pass it in.
import type { Locale } from "./locale.ts";

// Keyed by lower(name) — the same key the database and the API match on, so a
// row whose stored name is "Back Squat", "back squat" or "BACK SQUAT" resolves
// identically here and cannot drift from server behavior.
//
// This map is display metadata, NOT the catalog. The system seed itself is
// rows in the `exercises` table and is deliberately out of scope in
// docs/mvp-specification.md:156, so it is not derivable from this repository.
// An entry that no row uses is inert; a row with no entry falls back to its
// English name, which is the pre-existing behavior. Adding a translation is
// therefore always safe and never a breaking change.
const ZH_TW: Readonly<Record<string, string>> = {
  // Confirmed present in the staging/production system catalog.
  "assisted pull-up": "輔助引體向上",
  "back squat": "背蹲舉",
  "barbell row": "槓鈴划船",
  "bench press": "臥推",
  "box squat": "箱上蹲",
  "pull-up": "引體向上",
  "romanian deadlift": "羅馬尼亞硬舉",

  // Standard barbell / bodyweight movements, pre-translated so they render in
  // 繁中 the moment such a row exists. Unused entries cost nothing.
  "bulgarian split squat": "保加利亞分腿蹲",
  "calf raise": "提踵",
  "chin-up": "反手引體向上",
  "deadlift": "硬舉",
  "dip": "雙槓撐體",
  "dumbbell row": "啞鈴划船",
  "face pull": "臉拉",
  "front squat": "前蹲舉",
  "goblet squat": "高腳杯深蹲",
  "good morning": "早安式",
  "hip thrust": "臀推",
  "incline bench press": "上斜臥推",
  "lat pulldown": "滑輪下拉",
  "leg curl": "腿彎舉",
  "leg extension": "腿伸展",
  "leg press": "腿推舉",
  "lunge": "弓箭步",
  "overhead press": "過頭推舉",
  "plank": "棒式",
  "power clean": "上膊",
  "push-up": "伏地挺身",
  "seated row": "坐姿划船",
  "shoulder press": "肩推",
  "split squat": "分腿蹲",
  "sumo deadlift": "相撲硬舉",
};

const CATALOGS: Readonly<Partial<Record<Locale, Readonly<Record<string, string>>>>> = {
  "zh-TW": ZH_TW,
};

// localizeExerciseName returns the name to PAINT. Never feed its result back
// into a request body, a duplicate-name comparison, or anything persisted —
// pass the original `name` for those. An unknown name (a coach's own private
// Exercise, or a system row this map has not caught up with) is returned
// unchanged, so the worst case is today's behavior rather than a blank.
export function localizeExerciseName(name: string, locale: Locale): string {
  const catalog = CATALOGS[locale];
  if (!catalog) return name;
  return catalog[name.trim().toLowerCase()] ?? name;
}

// matchesExerciseQuery decides whether an Exercise should survive a search box
// filtered client-side. It matches the English name OR its localized display
// name, so a coach on a 繁中 UI can type "臥推" and find the row stored as
// "Bench Press", while "bench" keeps working in either locale.
//
// Case-insensitive substring, mirroring the API's own documented search
// (exercise.go ListForCoach: "case-insensitive literal substring searches").
// An empty or whitespace-only query matches everything, which is how both the
// server and the pickers already treat it.
export function matchesExerciseQuery(name: string, query: string, locale: Locale): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  if (name.toLowerCase().includes(needle)) return true;
  return localizeExerciseName(name, locale).toLowerCase().includes(needle);
}
