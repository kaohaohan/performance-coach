// Display-only localization of Exercise names — option B in
// docs/tasks/2026-09-07-exercise-library-i18n.md.
//
// Why a display map and not translated rows in the database: an Exercise's
// name IS its identity, not just its label.
//
//   * 0001_init_schema.up.sql:33 — UNIQUE INDEX on lower(name) for the
//     system catalog (owner_coach_id IS NULL).
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
// COMPLETENESS IS ENFORCED. Every name in apps/api/seeds/system_exercises_v1.sql
// must appear here exactly once, and no key here may name a row the seed does
// not have — exercise-names.test.ts reads that seed and fails on either. That
// mirrors what the message catalogs get from the type system
// (Record<keyof typeof en, string>): a forgotten translation is a red build,
// not a silently English string on a 繁中 screen.
//
// Order below follows the seed file's own equipment blocks, so the two files
// can be diffed against each other by eye.
//
// Proper nouns keep the brand/person in English and translate the movement
// (founder decision, 2026-09-07): a Taiwanese lifter says "Hammer Strength",
// not a transliteration of it.
const ZH_TW: Readonly<Record<string, string>> = {
  // ── 槓鈴 Barbell ──
  "back squat": "背蹲舉",
  "front squat": "前蹲舉",
  "box squat": "箱上蹲",
  "pause squat": "停頓蹲",
  "zercher squat": "Zercher 深蹲",
  "barbell split squat": "槓鈴分腿蹲",
  "barbell reverse lunge": "槓鈴後跨弓箭步",
  "conventional deadlift": "傳統硬舉",
  "sumo deadlift": "相撲硬舉",
  "romanian deadlift": "羅馬尼亞硬舉",
  "stiff-leg deadlift": "直腿硬舉",
  "barbell hip thrust": "槓鈴臀推",
  "barbell glute bridge": "槓鈴臀橋",
  "bench press": "臥推",
  "incline bench press": "上斜臥推",
  "close-grip bench press": "窄握臥推",
  "floor press": "地板臥推",
  "overhead press": "過頭推舉",
  "push press": "借力推舉",
  "barbell row": "槓鈴划船",
  "pendlay row": "Pendlay 划船",
  "good morning": "早安式",
  "hang high pull": "懸垂高拉",
  "clean pull": "高翻拉",
  "snatch-grip deadlift": "抓舉握硬舉",

  // ── 啞鈴 Dumbbell ──
  "dumbbell bench press": "啞鈴臥推",
  "incline dumbbell bench press": "上斜啞鈴臥推",
  "dumbbell floor press": "啞鈴地板臥推",
  "dumbbell fly": "啞鈴飛鳥",
  "dumbbell shoulder press": "啞鈴肩推",
  "arnold press": "Arnold 推舉",
  "dumbbell lateral raise": "啞鈴側平舉",
  "dumbbell front raise": "啞鈴前平舉",
  "dumbbell rear delt raise": "啞鈴後三角平舉",
  "one-arm dumbbell row": "單手啞鈴划船",
  "chest-supported dumbbell row": "胸靠啞鈴划船",
  "dumbbell pullover": "啞鈴仰臥拉舉",
  "dumbbell goblet squat": "啞鈴高腳杯深蹲",
  "dumbbell front squat": "啞鈴前蹲舉",
  "dumbbell split squat": "啞鈴分腿蹲",
  "dumbbell bulgarian split squat": "啞鈴保加利亞分腿蹲",
  "dumbbell reverse lunge": "啞鈴後跨弓箭步",
  "dumbbell walking lunge": "啞鈴行走弓箭步",
  "dumbbell romanian deadlift": "啞鈴羅馬尼亞硬舉",
  "single-leg dumbbell romanian deadlift": "單腿啞鈴羅馬尼亞硬舉",
  "dumbbell step-up": "啞鈴登階",
  "dumbbell hip thrust": "啞鈴臀推",
  "dumbbell biceps curl": "啞鈴二頭彎舉",
  "hammer curl": "錘式彎舉",
  "dumbbell triceps extension": "啞鈴三頭伸展",

  // ── 纜繩 Cable ──
  "cable chest press": "纜繩胸推",
  "cable fly": "纜繩飛鳥",
  "cable incline fly": "纜繩上斜飛鳥",
  "cable row": "纜繩划船",
  "seated cable row": "坐姿纜繩划船",
  "one-arm cable row": "單手纜繩划船",
  "cable lat pulldown": "纜繩滑輪下拉",
  "straight-arm pulldown": "直臂下拉",
  "cable face pull": "纜繩臉拉",
  "cable lateral raise": "纜繩側平舉",
  "cable front raise": "纜繩前平舉",
  "cable rear delt fly": "纜繩後三角飛鳥",
  "cable biceps curl": "纜繩二頭彎舉",
  "cable hammer curl": "纜繩錘式彎舉",
  "cable triceps pushdown": "纜繩三頭下壓",
  "cable overhead triceps extension": "纜繩過頭三頭伸展",
  "cable pull-through": "纜繩前拉",
  "cable wood chop": "纜繩劈砍",
  "cable pallof press": "纜繩 Pallof 推",
  "cable hip abduction": "纜繩髖外展",
  "cable hip adduction": "纜繩髖內收",

  // ── 徒手 Bodyweight ──
  "push-up": "伏地挺身",
  "incline push-up": "上斜伏地挺身",
  "decline push-up": "下斜伏地挺身",
  "pull-up": "引體向上",
  "chin-up": "反手引體向上",
  "neutral-grip pull-up": "中立握引體向上",
  "inverted row": "反向划船",
  "bodyweight squat": "徒手深蹲",
  "split squat": "分腿蹲",
  "bulgarian split squat": "保加利亞分腿蹲",
  "reverse lunge": "後跨弓箭步",
  "walking lunge": "行走弓箭步",
  "step-up": "登階",
  "single-leg squat": "單腿深蹲",
  "pistol squat": "手槍蹲",
  "glute bridge": "臀橋",
  "single-leg glute bridge": "單腿臀橋",
  "nordic hamstring curl": "北歐腿彎舉",
  "calf raise": "提踵",
  "single-leg calf raise": "單腿提踵",
  "plank": "棒式",
  "side plank": "側棒式",
  "dead bug": "死蟲式",
  "bird dog": "鳥狗式",

  // ── 器械 Machine ──
  "leg press": "腿推舉",
  "hack squat": "哈克深蹲",
  "pendulum squat": "鐘擺深蹲",
  "belt squat": "腰帶深蹲",
  "leg extension": "腿伸展",
  "seated leg curl": "坐姿腿彎舉",
  "lying leg curl": "俯臥腿彎舉",
  "standing leg curl": "站姿腿彎舉",
  "hip abduction machine": "髖外展機",
  "hip adduction machine": "髖內收機",
  "glute drive": "臀推機",
  "chest press machine": "胸推機",
  "incline chest press machine": "上斜胸推機",
  "shoulder press machine": "肩推機",
  "lat pulldown machine": "滑輪下拉機",
  "seated row machine": "坐姿划船機",
  "high row machine": "高位划船機",
  "low row machine": "低位划船機",
  "pec deck": "蝴蝶機",
  "reverse pec deck": "反向蝴蝶機",
  "assisted pull-up": "輔助引體向上",
  "biceps curl machine": "二頭彎舉機",
  "triceps extension machine": "三頭伸展機",
  "seated calf raise": "坐姿提踵",
  "standing calf raise": "站姿提踵",

  // ── Hammer Strength — 器材品牌保留英文，動作部分翻譯 ──
  "hammer strength iso-lateral bench press": "Hammer Strength 單邊臥推",
  "hammer strength iso-lateral incline press": "Hammer Strength 單邊上斜推",
  "hammer strength iso-lateral decline press": "Hammer Strength 單邊下斜推",
  "hammer strength iso-lateral shoulder press": "Hammer Strength 單邊肩推",
  "hammer strength iso-lateral wide chest": "Hammer Strength 單邊寬握胸推",
  "hammer strength iso-lateral row": "Hammer Strength 單邊划船",
  "hammer strength iso-lateral high row": "Hammer Strength 單邊高位划船",
  "hammer strength iso-lateral low row": "Hammer Strength 單邊低位划船",
  "hammer strength iso-lateral front lat pulldown": "Hammer Strength 單邊滑輪下拉",
  "hammer strength ground base jammer": "Hammer Strength 推舉架",
  "hammer strength ground base squat": "Hammer Strength 深蹲架",
  "hammer strength ground base high pull": "Hammer Strength 高拉架",
  "hammer strength linear leg press": "Hammer Strength 直線腿推舉",
  "hammer strength hack squat": "Hammer Strength 哈克深蹲",
};

const CATALOGS: Readonly<Partial<Record<Locale, Readonly<Record<string, string>>>>> = {
  "zh-TW": ZH_TW,
};

// localizeExerciseName returns the name to PAINT. Never feed its result back
// into a request body, a duplicate-name comparison, or anything persisted —
// pass the original `name` for those. An unknown name is returned unchanged:
// that is the correct behavior for a Coach's own private Exercise (which the
// seed does not contain and this map must never translate), and it is also
// the safe fallback if the catalog ever gains a row ahead of this map.
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

// zhTWExerciseNames exposes the map to exercise-names.test.ts so it can assert
// 1:1 coverage against the seed. Not for rendering — use localizeExerciseName.
export const zhTWExerciseNames: Readonly<Record<string, string>> = ZH_TW;

// KEPT_ENGLISH is the deliberate escape hatch for a catalog name that has no
// Chinese form at all — key is lower(name), value is the reason.
//
// It is empty, and that is the point of shipping it. The test asserts every
// translation contains at least one Han character; without a named exception
// list, the first legitimately all-English name would get "fixed" by deleting
// that assertion, losing the copy-pasted-English net for all 134 at once.
// Adding an entry here is additive and reviewable; weakening the test is not.
//
// Note this is NOT the hatch for brand names: the founder's rule is brand in
// English, movement translated ("Hammer Strength 單邊划船"), which already
// contains Han and needs no exception. Precedent for genuinely untranslated
// terms is in messages/zh-TW/coach.ts, which documents RPE / kg / lb as-is.
export const KEPT_ENGLISH: Readonly<Record<string, string>> = {};
