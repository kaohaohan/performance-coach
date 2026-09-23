import assert from "node:assert/strict";
import test from "node:test";
import { applyLoadIncrementPrefill, applyProgressionPrefill, applySetIncrementPrefill, defaultLoadIncrement, suggestBumpedLoad, suggestBumpedSetCount } from "./load-increment.ts";

test("defaultLoadIncrement follows unit", () => {
  assert.equal(defaultLoadIncrement("kg"), 2.5);
  assert.equal(defaultLoadIncrement("lb"), 5);
});

test("suggestBumpedLoad adds increment", () => {
  assert.equal(suggestBumpedLoad(80, 2.5), 82.5);
  assert.equal(suggestBumpedLoad(80, 0), 80);
  assert.equal(suggestBumpedLoad(null, 2.5), null);
});

test("applyLoadIncrementPrefill uses history before template", () => {
  const exercises = [{
    exercise: { id: "ex-1" },
    defaultLoad: "80",
    unit: "kg" as const,
    loadIncrement: 2.5,
    overrides: [{ position: 3, load: "90" }],
  }];
  const got = applyLoadIncrementPrefill(exercises, { "ex-1": 100 });
  assert.equal(got[0].defaultLoad, "102.5");
  assert.equal(got[0].overrides[0].load, "102.5");
});

test("applyLoadIncrementPrefill falls back to template without history", () => {
  const exercises = [{
    exercise: { id: "ex-1" },
    defaultLoad: "80",
    unit: "kg" as const,
    loadIncrement: 5,
    overrides: [],
  }];
  const got = applyLoadIncrementPrefill(exercises, { "ex-1": null });
  assert.equal(got[0].defaultLoad, "85");
});

test("applyLoadIncrementPrefill leaves exercises unchanged for zero increment", () => {
  const exercises = [{
    exercise: { id: "ex-1" },
    defaultLoad: "80",
    unit: "kg" as const,
    loadIncrement: 0,
    setCount: "3",
    setIncrement: 0,
    overrides: [],
  }];
  const got = applyLoadIncrementPrefill(exercises, { "ex-1": 100 });
  assert.equal(got[0].defaultLoad, "80");
});

test("applySetIncrementPrefill adds one set when enabled", () => {
  const exercises = [{ setCount: "3", setIncrement: 1 }];
  assert.deepEqual(applySetIncrementPrefill(exercises), [{ setCount: "4", setIncrement: 1 }]);
});

test("applySetIncrementPrefill leaves zero increment unchanged", () => {
  const exercises = [{ setCount: "3", setIncrement: 0 }];
  assert.deepEqual(applySetIncrementPrefill(exercises), exercises);
});

test("applyProgressionPrefill applies load and set bumps", () => {
  const exercises = [{
    exercise: { id: "ex-1" },
    defaultLoad: "80",
    unit: "kg" as const,
    loadIncrement: 2.5,
    setCount: "3",
    setIncrement: 1,
    overrides: [],
  }];
  const got = applyProgressionPrefill(exercises, { "ex-1": 100 });
  assert.equal(got[0].defaultLoad, "102.5");
  assert.equal(got[0].setCount, "4");
});

test("suggestBumpedSetCount", () => {
  assert.equal(suggestBumpedSetCount(3, 1), 4);
  assert.equal(suggestBumpedSetCount(3, 0), 3);
});
