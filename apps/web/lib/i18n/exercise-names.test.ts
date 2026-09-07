import assert from "node:assert/strict";
import test from "node:test";
import { localizeExerciseName, matchesExerciseQuery } from "./exercise-names.ts";

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
