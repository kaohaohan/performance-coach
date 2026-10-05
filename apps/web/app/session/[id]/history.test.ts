import assert from "node:assert/strict";
import test from "node:test";
import { lastSummary, prFor, prLabel, provisionalBadge, shortDate, type ExerciseHistory } from "./history";

const t = ((key: string, params?: Record<string, string | number>) => {
  if (key === "athlete.history.prAt") return `PR @ ${params?.load} ${params?.unit}`;
  if (key === "athlete.history.prBodyweight") return "PR";
  if (key === "athlete.set.reps") return `${params?.count} reps`;
  return key;
}) as never;

const history: ExerciseHistory = {
  last: { date: "2026-09-29", setLogs: [
    { setNumber: 1, load: 32.5, unit: "kg", reps: 9, rir: 1 },
    { setNumber: 2, load: 32.5, unit: "kg", reps: 9, rir: 1 },
    { setNumber: 3, load: 32.5, unit: "kg", reps: 8, rir: 1 },
  ] },
  maxLoad: { load: 32.5, unit: "kg", reps: 9, date: "2026-09-29" },
  bestRepsByLoad: [
    { load: 30, unit: "kg", reps: 12, date: "2026-09-22" },
    { load: 32.5, unit: "kg", reps: 9, date: "2026-09-29" },
  ],
};

test("formats the date as month/day", () => {
  assert.equal(shortDate("2026-09-29"), "9/29");
  assert.equal(shortDate("2026-01-05"), "1/5");
});

test("summarises the last exposure like the spec example", () => {
  assert.equal(lastSummary(history.last!), "32.5 kg × 9·9·8 @1");
});

test("groups by load and lists differing RIR; omits RIR when any is unknown", () => {
  assert.equal(lastSummary({ date: "d", setLogs: [
    { setNumber: 1, load: 60, unit: "kg", reps: 10, rir: 3 },
    { setNumber: 2, load: 60, unit: "kg", reps: 10, rir: 2 },
    { setNumber: 3, load: 50, unit: "kg", reps: 12, rir: 1 },
  ] }), "60 kg × 10·10 @3·2 / 50 kg × 12 @1");
  assert.equal(lastSummary({ date: "d", setLogs: [{ setNumber: 1, load: 60, unit: "kg", reps: 10 }, { setNumber: 2, load: 60, unit: "kg", reps: 9, rir: 2 }] }), "60 kg × 10·9");
  assert.equal(lastSummary({ date: "d", setLogs: [{ setNumber: 1, reps: 12, rir: 2 }, { setNumber: 2, reps: 10, rir: 1 }] }), "12·10 @2·1");
});

test("PR follows the target load, else the heaviest load", () => {
  assert.deepEqual(prFor(history, 30, "kg"), history.bestRepsByLoad[0]);
  assert.deepEqual(prFor(history, 35, "kg"), history.maxLoad);
  assert.deepEqual(prFor(history, undefined, undefined), history.maxLoad);
  // The same number in another unit is a different load.
  assert.deepEqual(prFor(history, 30, "lb"), history.maxLoad);
  assert.equal(prLabel(t, history.maxLoad!), "PR @ 32.5 kg — 9 reps");
});

test("bodyweight PR has no load", () => {
  const bw: ExerciseHistory = { last: null, maxLoad: null, bestRepsByLoad: [{ load: null, reps: 12, date: "2026-09-01" }] };
  assert.deepEqual(prFor(bw, undefined, undefined), bw.bestRepsByLoad[0]);
  assert.equal(prLabel(t, bw.bestRepsByLoad[0]), "PR — 12 reps");
});

test("no history means no PR and no badge", () => {
  const none: ExerciseHistory = { last: null, maxLoad: null, bestRepsByLoad: [] };
  assert.equal(prFor(none, 80, "kg"), null);
  assert.equal(provisionalBadge(none, { load: 80, unit: "kg", reps: 5 }), null);
  assert.equal(provisionalBadge(undefined, { load: 80, unit: "kg", reps: 5 }), null);
});

test("Rep PR: more reps than ever at a load done before", () => {
  assert.equal(provisionalBadge(history, { load: 32.5, unit: "kg", reps: 10 }), "REP_PR");
  assert.equal(provisionalBadge(history, { load: 30, unit: "kg", reps: 13 }), "REP_PR");
});

test("a load never done before, or a different unit, is not a Rep PR", () => {
  assert.equal(provisionalBadge(history, { load: 35, unit: "kg", reps: 20 }), null);
  assert.equal(provisionalBadge(history, { load: 32.5, unit: "lb", reps: 20 }), null);
});

test("Matched: same load and reps as last time's top set", () => {
  assert.equal(provisionalBadge(history, { load: 32.5, unit: "kg", reps: 9 }), "MATCHED");
  assert.equal(provisionalBadge(history, { load: 32.5, unit: "kg", reps: 8 }), null);
  assert.equal(provisionalBadge(history, { load: 32.5, unit: "lb", reps: 9 }), null);
});

test("equal to the best but not above is not a Rep PR (Matched only if it is last's top set)", () => {
  assert.equal(provisionalBadge(history, { load: 30, unit: "kg", reps: 12 }), null);
});

test("bodyweight Rep PR and Matched compare reps only", () => {
  const bw: ExerciseHistory = {
    last: { date: "2026-09-01", setLogs: [{ setNumber: 1, reps: 10, rir: 2 }] },
    maxLoad: null,
    bestRepsByLoad: [{ load: null, reps: 12, date: "2026-08-20" }],
  };
  assert.equal(provisionalBadge(bw, { reps: 13 }), "REP_PR");
  assert.equal(provisionalBadge(bw, { reps: 10 }), "MATCHED");
  assert.equal(provisionalBadge(bw, { reps: 11 }), null);
});
