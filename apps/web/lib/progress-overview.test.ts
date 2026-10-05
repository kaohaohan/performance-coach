import assert from "node:assert/strict";
import test from "node:test";
import { completionText, eventChips, layoutSparkline, prCount, topSetText, type OverviewEvent, type OverviewExercise } from "./progress-overview";

const t = ((key: string) => key) as never;

function exercise(events: OverviewEvent[]): OverviewExercise {
  return { exerciseId: "e", name: "Curl", unit: "kg", latest: { date: "2026-10-05", topSet: { load: 32.5, reps: 11, rir: 1 } }, trend: [], recentEvents: events, exposures: 1 };
}

test("topSetText shows load, reps and RIR; leaves RIR and load out when absent", () => {
  assert.equal(topSetText({ load: 32.5, reps: 11, rir: 1 }, "kg"), "32.5 kg × 11 @1");
  assert.equal(topSetText({ load: 100, reps: 5 }, "lb"), "100 lb × 5");
  assert.equal(topSetText({ load: 60, reps: 8, rir: 0.5 }, "kg"), "60 kg × 8 @0.5");
  assert.equal(topSetText({ load: null, reps: 12 }, "kg"), "12");
});

test("completionText is a rounded percentage, or a dash when nothing was scheduled", () => {
  assert.equal(completionText(0.79), "79%");
  assert.equal(completionText(0), "0%");
  assert.equal(completionText(1), "100%");
  assert.equal(completionText(null), "—");
});

test("prCount counts only Load PR and Rep PR events across rows", () => {
  const rows = [
    exercise([{ date: "2026-10-05", type: "REP_PR", load: 32.5, unit: "kg", reps: 11 }, { date: "2026-10-05", type: "LOAD_CHANGE", delta: 2.5, unit: "kg" }]),
    exercise([{ date: "2026-10-01", type: "LOAD_PR", load: 100, unit: "kg" }, { date: "2026-09-20", type: "MATCHED" }]),
    exercise([]),
  ];
  assert.equal(prCount(rows), 2);
  assert.equal(prCount([]), 0);
});

test("eventChips lists distinct PR and load-up chips only", () => {
  const events: OverviewEvent[] = [
    { date: "2026-10-05", type: "REP_PR", reps: 11, load: 32.5, unit: "kg" },
    { date: "2026-10-05", type: "LOAD_CHANGE", delta: 2.5, unit: "kg" },
    { date: "2026-09-28", type: "REP_PR", reps: 10, load: 30, unit: "kg" },
    { date: "2026-09-21", type: "LOAD_CHANGE", delta: -5, unit: "kg" },
    { date: "2026-09-14", type: "MATCHED" },
    { date: "2026-09-07", type: "REPS_DOWN", reps: 6, previousReps: 8 },
  ];
  assert.deepEqual(eventChips(t, events).map((c) => c.key), ["repPr", "loadUp"]);
  assert.deepEqual(eventChips(t, []), []);
});

test("layoutSparkline breaks the line at empty weeks instead of interpolating", () => {
  const trend = [10, null, 20, 30, null].map((v, i) => ({ weekStart: `w${i}`, estimated1rm: v }));
  const s = layoutSparkline(trend, 100, 30);
  assert.equal(s.runs.length, 2);
  assert.deepEqual(s.runs.map((r) => r.length), [1, 2]);
  // x is proportional to the week index; the highest value is the highest point.
  assert.equal(s.runs[0][0].x, 3);
  assert.ok(s.runs[1][1].y < s.runs[1][0].y && s.runs[1][1].y < s.runs[0][0].y);
  assert.deepEqual(s.last, s.runs[1][1]);
});

test("layoutSparkline handles all-empty and flat series", () => {
  assert.deepEqual(layoutSparkline([{ weekStart: "w", estimated1rm: null }, { weekStart: "x", estimated1rm: null }]).runs, []);
  assert.equal(layoutSparkline([]).last, null);
  const flat = layoutSparkline([{ weekStart: "a", estimated1rm: 50 }, { weekStart: "b", estimated1rm: 50 }], 100, 30);
  assert.equal(flat.runs[0][0].y, 15);
  assert.equal(flat.runs[0][1].y, 15);
});
