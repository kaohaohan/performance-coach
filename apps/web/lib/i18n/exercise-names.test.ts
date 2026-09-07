import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { KEPT_ENGLISH, localizeExerciseName, matchesExerciseQuery, zhTWExerciseNames } from "./exercise-names.ts";

// The load-bearing property in this file is the NEGATIVE one: an unknown name
// must come back byte-identical. Exercise names are identity (unique index on
// lower(name); find-or-create by name; the client sends `name` on the wire),
// so a helper that silently altered one would fork the catalog rather than
// merely mislabel a row.

test("localizeExerciseName translates a known system exercise into zh-TW", () => {
  assert.equal(localizeExerciseName("Back Squat", "zh-TW"), "背蹲舉");
  assert.equal(localizeExerciseName("Bench Press", "zh-TW"), "臥推");
  assert.equal(localizeExerciseName("Romanian Deadlift", "zh-TW"), "羅馬尼亞硬舉");
  assert.equal(localizeExerciseName("Assisted Pull-Up", "zh-TW"), "輔助引體向上");
});

test("localizeExerciseName leaves every name alone in English", () => {
  assert.equal(localizeExerciseName("Back Squat", "en"), "Back Squat");
  assert.equal(localizeExerciseName("Bench Press", "en"), "Bench Press");
});

test("localizeExerciseName returns an unknown name unchanged", () => {
  // A coach's own private Exercise, in either language.
  assert.equal(localizeExerciseName("Cheryl Special Warmup", "zh-TW"), "Cheryl Special Warmup");
  assert.equal(localizeExerciseName("阿翰的暖身", "zh-TW"), "阿翰的暖身");
  assert.equal(localizeExerciseName("", "zh-TW"), "");
});

test("localizeExerciseName matches the database's lower(name) key, not the exact casing", () => {
  // 0001_init_schema.up.sql indexes lower(name) and exercise.go compares
  // lower(name), so display must not be stricter than storage.
  assert.equal(localizeExerciseName("BACK SQUAT", "zh-TW"), "背蹲舉");
  assert.equal(localizeExerciseName("back squat", "zh-TW"), "背蹲舉");
  assert.equal(localizeExerciseName("  Bench Press  ", "zh-TW"), "臥推");
});

test("matchesExerciseQuery finds an English row by its Chinese display name", () => {
  assert.equal(matchesExerciseQuery("Bench Press", "臥推", "zh-TW"), true);
  assert.equal(matchesExerciseQuery("Back Squat", "背蹲", "zh-TW"), true);
  assert.equal(matchesExerciseQuery("Bench Press", "硬舉", "zh-TW"), false);
});

test("matchesExerciseQuery still matches the English name in either locale", () => {
  assert.equal(matchesExerciseQuery("Bench Press", "bench", "zh-TW"), true);
  assert.equal(matchesExerciseQuery("Bench Press", "BENCH", "en"), true);
  assert.equal(matchesExerciseQuery("Bench Press", "squat", "en"), false);
});

test("matchesExerciseQuery does not match a Chinese query while the UI is English", () => {
  // The English UI shows English names, so a Chinese needle has nothing to hit.
  assert.equal(matchesExerciseQuery("Bench Press", "臥推", "en"), false);
});

test("matchesExerciseQuery treats an empty query as match-all", () => {
  assert.equal(matchesExerciseQuery("Bench Press", "", "zh-TW"), true);
  assert.equal(matchesExerciseQuery("Bench Press", "   ", "zh-TW"), true);
});

test("matchesExerciseQuery finds a coach's own Chinese exercise by its own name", () => {
  assert.equal(matchesExerciseQuery("阿翰的暖身", "暖身", "zh-TW"), true);
});

// ---------------------------------------------------------------------------
// Seed coverage.
//
// These assertions are what make the map trustworthy rather than best-effort.
// The message catalogs get the same guarantees from the type system — zh-TW/
// coach.ts is annotated `: CoachMessages`, so a forgotten key is TS2741 and a
// stale key is TS2353. An exercise-name map cannot be typed that way: its key
// space lives in apps/api/seeds/system_exercises_v1.sql, the file that actually
// seeds the database, not in a TypeScript literal.
//
// This is the only test in apps/web that reads from disk, and it deliberately
// reaches into apps/api. Copying those 134 names into this project to buy a
// compile-time check would create the second, drifting list this test exists to
// prevent — and would put domain data in the frontend (AGENTS.md §4). The
// framing is a consumer-driven contract: apps/web asserts "I can display every
// name the API's seed declares." CI checks out the whole repo, and `next build`
// never touches this path, so no deploy depends on it.
const SEED_PATH = join(import.meta.dirname, "../../../api/seeds/system_exercises_v1.sql");

// Anchored whole-line, and bounded to the VALUES region rather than scanned
// over the whole file. An unanchored /'([^']+)', NULL/g scan fails *quietly*:
// on a future SQL-escaped name like 'Farmer''s Walk' it resyncs on the second
// quote and silently yields "s Walk" while the row count stays correct, and an
// apostrophe in a comment flips quote parity for everything after it. Requiring
// every non-blank, non-comment line in the region to match turns each of those
// into a named failure instead.
const SEED_ROW = /^\s*\(gen_random_uuid\(\), '((?:[^']|'')*)', NULL, now\(\)\),?$/;
const EXPECTED_SEED_COUNT = 134;

function seedExerciseNames(): string[] {
  const sql = readFileSync(SEED_PATH, "utf8");
  const lines = sql.split("\n");
  const start = lines.findIndex((line) => line.trim() === "VALUES");
  const end = lines.findIndex((line) => line.trim().startsWith("ON CONFLICT"));
  assert.ok(start !== -1 && end > start, `could not locate the VALUES…ON CONFLICT region in ${SEED_PATH}`);

  const names: string[] = [];
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (line.trim() === "" || line.trim().startsWith("--")) continue;
    const match = SEED_ROW.exec(line);
    // A row this parser cannot read is a failure, never a skip — silently
    // dropping it would let an untranslated exercise through.
    assert.ok(match, `${SEED_PATH}:${index + 1} is not a parseable seed row: ${line}`);
    names.push(match[1].replaceAll("''", "'"));
  }
  return names;
}

test("the seed file holds exactly one INSERT statement", () => {
  // A second statement appended later (say a muscle-groups seed) would other-
  // wise have its string literals swallowed as exercise names.
  const sql = readFileSync(SEED_PATH, "utf8");
  assert.equal(sql.match(/^INSERT INTO/gm)?.length, 1);
});

test("the seed parses to the whole catalog", () => {
  // Guards every assertion below: a parse returning nothing would make them all
  // pass while checking nothing.
  const names = seedExerciseNames();
  assert.equal(names.length, EXPECTED_SEED_COUNT);
  assert.equal(new Set(names.map((name) => name.toLowerCase())).size, names.length,
    "the seed has a case-insensitive duplicate; ON CONFLICT DO NOTHING would drop it silently");
});

test("every system exercise in the seed has a zh-TW translation", () => {
  const untranslated = seedExerciseNames().filter((name) => zhTWExerciseNames[name.toLowerCase()] === undefined);
  assert.deepEqual(untranslated, [],
    `these would render in English on a 繁中 screen: ${untranslated.join(", ")}`);
});

test("the zh-TW map carries no exercise the seed does not have", () => {
  // Catches an invented key — one that looks translated but can never match a
  // real row, e.g. "deadlift" when the catalog says "Conventional Deadlift".
  const seeded = new Set(seedExerciseNames().map((name) => name.toLowerCase()));
  const orphans = Object.keys(zhTWExerciseNames).filter((key) => !seeded.has(key));
  assert.deepEqual(orphans, [], `these map keys match no seed exercise: ${orphans.join(", ")}`);
});

test("every zh-TW key is already normalized to the lookup form", () => {
  // localizeExerciseName looks up name.trim().toLowerCase(); a key that is not
  // in that form is dead weight that can never be hit.
  const malformed = Object.keys(zhTWExerciseNames).filter((key) => key !== key.trim().toLowerCase());
  assert.deepEqual(malformed, [], `these keys can never be matched: ${malformed.join(", ")}`);
});

// Explicit ranges rather than \p{Script=Han}: tsconfig targets ES2017, which
// rejects the Unicode property escape.
const HAN = /[一-鿿㐀-䶿]/;

test("every zh-TW exercise name is actually translated", () => {
  // Stronger than "differs from the English source", which a reworded-but-still-
  // English value would pass. Brand names keep their Latin half by design
  // ("Hammer Strength 單邊划船"), so requiring *some* Han is the right bar.
  const notTranslated = seedExerciseNames().filter((name) => {
    const key = name.toLowerCase();
    return KEPT_ENGLISH[key] === undefined && !HAN.test(zhTWExerciseNames[key] ?? "");
  });
  assert.deepEqual(notTranslated, [],
    `these carry no Chinese and are not declared in KEPT_ENGLISH: ${notTranslated.join(", ")}`);
});

test("KEPT_ENGLISH holds no stale exception", () => {
  const seeded = new Set(seedExerciseNames().map((name) => name.toLowerCase()));
  for (const key of Object.keys(KEPT_ENGLISH)) {
    assert.ok(seeded.has(key), `KEPT_ENGLISH names "${key}", which is not in the seed`);
    assert.ok(!HAN.test(zhTWExerciseNames[key] ?? ""),
      `"${key}" is in KEPT_ENGLISH but now has a Chinese translation — drop the exception`);
  }
});

test("no two exercises share one zh-TW name", () => {
  // A real correctness bug, not a cosmetic one: two catalog rows rendering the
  // same Chinese string means the coach picks one and a *different* English
  // name goes on the wire. Cable Row / Seated Cable Row / One-Arm Cable Row /
  // Seated Row Machine, and Hack Squat / Hammer Strength Hack Squat, are the
  // pairs a hurried translation pass would collapse.
  const byTranslation = new Map<string, string[]>();
  for (const name of seedExerciseNames()) {
    const translated = zhTWExerciseNames[name.toLowerCase()] ?? name;
    byTranslation.set(translated, [...(byTranslation.get(translated) ?? []), name]);
  }
  const collisions = [...byTranslation.entries()].filter(([, sources]) => sources.length > 1);
  assert.deepEqual(collisions, [],
    collisions.map(([zh, sources]) => `"${zh}" ← ${sources.join(" / ")}`).join("; "));
});
