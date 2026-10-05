import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays, buildTimeline, eventLabel, filterSince, initialWindows, layoutChart, mergeWindows, metricValue, niceTicks, pointLabel, rangeCutoff, windowBounds,
  type Exposure, type LogSession,
} from "./exercise-progress";

const t = ((key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`) as never;

function exposure(date: string, load: number | null, reps: number, extra: Partial<Exposure> = {}): Exposure {
  return { date, source: "OWN", topSet: { load, reps, rir: 1 }, estimated1rm: 40, maxLoad: load ?? undefined, totalReps: reps * 3, volumeLoad: load === null ? undefined : load * reps * 3, setCount: 3, position: 1, events: [], ...extra };
}

test("windows are 184 days inclusive and contiguous", () => {
  const w0 = windowBounds("2026-10-05", 0);
  const w1 = windowBounds("2026-10-05", 1);
  assert.equal(w0.to, "2026-10-05");
  assert.equal(addDays(w0.to, -183), w0.from);
  assert.equal(w1.to, addDays(w0.from, -1));
});

test("range windows and cutoffs", () => {
  assert.equal(initialWindows("3m"), 1);
  assert.equal(initialWindows("1y"), 2);
  assert.equal(initialWindows("all"), 2);
  assert.equal(rangeCutoff("3m", "2026-10-05"), "2026-07-05");
  assert.equal(rangeCutoff("1y", "2026-10-05"), "2025-10-05");
  assert.equal(rangeCutoff("all", "2026-10-05"), null);
  assert.deepEqual(filterSince([{ date: "2026-01-01" }, { date: "2026-08-01" }], "2026-07-05"), [{ date: "2026-08-01" }]);
});

test("mergeWindows keeps sessions newest first and exposures oldest first per unit", () => {
  const session = (date: string) => ({ date }) as LogSession;
  const merged = mergeWindows([
    { sessions: [session("2026-09-01")], exposures: { kg: [exposure("2026-09-01", 80, 8)] } },
    { sessions: [session("2026-03-01")], exposures: { kg: [exposure("2026-03-01", 70, 8)], lb: [exposure("2026-03-02", 150, 5)] } },
  ]);
  assert.deepEqual(merged.sessions.map((s) => s.date), ["2026-09-01", "2026-03-01"]);
  assert.deepEqual(merged.exposures?.kg.map((e) => e.date), ["2026-03-01", "2026-09-01"]);
  assert.equal(merged.exposures?.lb.length, 1);
});

test("metrics read the engine's numbers, null when absent", () => {
  const e = exposure("2026-09-01", 80, 8);
  assert.equal(metricValue(e, "topSet"), 80);
  assert.equal(metricValue(e, "estimated1rm"), 40);
  assert.equal(metricValue(e, "load"), 80);
  assert.equal(metricValue(e, "reps"), 24);
  assert.equal(metricValue(e, "volume"), 1920);
  assert.equal(metricValue({ ...e, estimated1rm: undefined }, "estimated1rm"), null);
});

test("point labels are reps@RIR, RIR omitted when unknown", () => {
  assert.equal(pointLabel(exposure("2026-09-01", 80, 9)), "9@1");
  assert.equal(pointLabel({ ...exposure("2026-09-01", 80, 9), topSet: { load: 80, reps: 9 } }), "9");
});

test("chart: hollow for other-Coach points, dashed guide at load changes, time-proportional x", () => {
  const chart = layoutChart([
    exposure("2026-09-01", 80, 8),
    exposure("2026-09-08", 82.5, 8, { source: "OTHER_COACH", events: [{ type: "LOAD_CHANGE", delta: 2.5, unit: "kg" }] }),
    exposure("2026-09-29", 82.5, 9),
  ], "topSet");
  assert.equal(chart.points.length, 3);
  assert.deepEqual(chart.points.map((p) => p.hollow), [false, true, false]);
  assert.deepEqual(chart.points.map((p) => p.loadChange), [false, true, false]);
  const [a, b, c] = chart.points;
  assert.ok(a.x < b.x && b.x < c.x);
  assert.ok(Math.abs((b.x - a.x) / (c.x - a.x) - 7 / 28) < 1e-9);
  assert.ok(b.y < a.y, "heavier load is higher on screen");
  assert.equal(chart.xTicks.length, 2);
});

test("chart: single point is centred, missing values are skipped, empty is empty", () => {
  const one = layoutChart([exposure("2026-09-01", 80, 8)], "topSet");
  assert.equal(one.points.length, 1);
  assert.equal(one.points[0].x, (one.plot.left + one.plot.right) / 2);
  const skipped = layoutChart([exposure("2026-09-01", 80, 8, { estimated1rm: undefined }), exposure("2026-09-08", 80, 8)], "estimated1rm");
  assert.equal(skipped.points.length, 1);
  assert.equal(skipped.points[0].index, 1);
  assert.equal(layoutChart([], "topSet").points.length, 0);
});

test("niceTicks stays within the range", () => {
  const ticks = niceTicks(77.2, 91.3);
  assert.ok(ticks.length >= 2);
  assert.ok(ticks.every((v) => v >= 77.2 && v <= 91.3));
  assert.deepEqual(niceTicks(5, 5), [5]);
});

test("event labels are plain facts", () => {
  assert.equal(eventLabel(t, { type: "LOAD_PR", load: 82.5, unit: "kg" }), "progress.event.loadPr");
  assert.equal(eventLabel(t, { type: "LOAD_CHANGE", delta: 2.5, unit: "kg" }), "+2.5 kg");
  assert.equal(eventLabel(t, { type: "LOAD_CHANGE", delta: -5, unit: "lb" }), "−5 lb");
  assert.equal(eventLabel(t, { type: "REPS_DOWN", reps: 6, previousReps: 8 }), 'progress.event.repsDown{"from":8,"to":6}');
  assert.equal(eventLabel(t, { type: "REP_PR", load: 80, unit: "kg", reps: 9 }), 'progress.event.repPr{"reps":9,"load":"80","unit":"kg"}');
});

function logSession(date: string, sessionId: string | null, sets: { load: number; unit: "kg" | "lb"; reps: number }[]): LogSession {
  return {
    sessionId, scheduledWorkoutId: sessionId, status: "COMPLETED", date, source: sessionId ? "OWN" : "OTHER_COACH",
    athlete: { id: "a", name: "A" }, workoutName: null,
    exercises: [{ exerciseId: "ex", name: "Bench", position: 1, events: [], setLogs: sets.map((s, i) => ({ setNumber: i + 1, kind: "EXTRA", load: s.load, unit: s.unit, reps: s.reps })) }],
  };
}

test("timeline pairs exposures with sets per unit, newest first, never mixing units", () => {
  const sessions = [
    logSession("2026-09-08", null, [{ load: 185, unit: "lb", reps: 5 }]),
    logSession("2026-09-01", "s2", [{ load: 80, unit: "kg", reps: 8 }, { load: 80, unit: "kg", reps: 7 }]),
    logSession("2026-08-25", "s1", [{ load: 77.5, unit: "kg", reps: 8 }]),
  ];
  const kg = buildTimeline("kg", sessions, [exposure("2026-08-25", 77.5, 8), exposure("2026-09-01", 80, 8)], "ex");
  assert.deepEqual(kg.map((e) => e.exposure.date), ["2026-09-01", "2026-08-25"]);
  assert.deepEqual(kg.map((e) => e.sets.length), [2, 1]);
  assert.deepEqual(kg.map((e) => e.sessionId), ["s2", "s1"]);
  const lb = buildTimeline("lb", sessions, [exposure("2026-09-08", 185, 5)], "ex");
  assert.equal(lb.length, 1);
  assert.equal(lb[0].sessionId, null, "other-Coach session has no id to open");
  assert.equal(lb[0].sets.length, 1);
  // A date mismatch drops the sets instead of showing someone else's.
  const mismatch = buildTimeline("kg", sessions, [exposure("2026-01-01", 80, 8)], "ex");
  assert.deepEqual(mismatch[0].sets, []);
});
