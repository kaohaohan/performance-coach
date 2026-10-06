import assert from "node:assert/strict";
import test from "node:test";
import { translate, type Locale } from "./i18n/locale.ts";
import { en, type Catalog } from "./i18n/messages/en/index.ts";
import { zhTW } from "./i18n/messages/zh-TW/index.ts";
import {
  addDays, buildTimeline, eventLabel, filterSince, initialWindows, layoutChart, mergeWindows, compareToPrevious, comparisonRows, describeComparison, metricValue, niceTicks, pointLabel, pointText, rangeCutoff, setSummary, setsText, visibleLabels, windowBounds,
  type Exposure, type LogSession,
} from "./exercise-progress";

const catalogs: Record<Locale, Catalog> = { en, "zh-TW": zhTW };
const zh = ((key: string, vars?: Record<string, string | number>) => translate(catalogs, "zh-TW", key as never, vars)) as never;
const enT = ((key: string, vars?: Record<string, string | number>) => translate(catalogs, "en", key as never, vars)) as never;
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
  assert.equal(metricValue(e, "performance"), 80);
  assert.equal(metricValue(e, "estimated1rm"), 40);
  assert.equal(metricValue({ ...e, estimated1rm: undefined }, "estimated1rm"), null);
  assert.equal(metricValue(exposure("2026-09-01", null, 8), "performance"), null);
});

test("point labels are reps@RIR, RIR omitted when unknown", () => {
  assert.equal(pointLabel(exposure("2026-09-01", 80, 9)), "9 @1");
  assert.equal(pointLabel({ ...exposure("2026-09-01", 80, 9), topSet: { load: 80, reps: 9 } }), "9");
});

test("setSummary reads load × reps · RIR, bodyweight spelled out", () => {
  assert.equal(setSummary(t, { load: 350, unit: "lb", reps: 12, rir: 2 }), "350 lb × 12 · RIR 2");
  assert.equal(setSummary(t, { load: 350, unit: "lb", reps: 12 }), "350 lb × 12");
  assert.equal(setSummary(t, { load: null, reps: 12, rir: 2 }), 'athlete.set.bodyweight × 12 · RIR 2');
});

test("pointText: full text per metric", () => {
  const e = exposure("2026-09-01", 350, 12, { topSet: { load: 350, reps: 12, rir: 2 }, estimated1rm: 412, setCount: 3, volumeLoad: 12600 });
  assert.equal(pointText(t, e, "performance", "lb"), "350 lb × 12 @2");
  assert.equal(pointText(t, e, "estimated1rm", "lb"), 'progress.point.estimated1rm{"value":"412","unit":"lb","top":"350 lb × 12 @2"}');
  assert.equal(setsText(t, e, "lb"), 'progress.point.sets{"count":3} · progress.point.volume{"volume":"12,600","unit":"lb"}');
  assert.equal(setsText(t, { ...e, volumeLoad: undefined }, "lb"), 'progress.point.sets{"count":3}');
});

test("niceTicks integer mode gives whole numbers", () => {
  assert.deepEqual(niceTicks(2, 3.2, 4, true).every(Number.isInteger), true);
});

function cmp(prev: Partial<Exposure["topSet"]> & { date?: string; source?: Exposure["source"] }, cur: Partial<Exposure["topSet"]> & { date?: string }) {
  const mk = (o: typeof prev, date: string, source: Exposure["source"] = "OWN"): Exposure => {
    const topSet = { load: 100, reps: 8, rir: 1, ...o } as Exposure["topSet"];
    delete (o as { date?: string }).date;
    return exposure(date, topSet.load, topSet.reps, { topSet, source });
  };
  const c = compareToPrevious(mk(cur, cur.date ?? "2026-09-08"), mk(prev, prev.date ?? "2026-09-01", prev.source));
  assert.ok(c);
  return c;
}

test("compareToPrevious: load up, 3-column rows", () => {
  const c = compareToPrevious(exposure("2026-09-08", 350, 12), exposure("2026-09-01", 330, 12));
  assert.ok(c);
  assert.equal(c.previousDate, "2026-09-01");
  assert.deepEqual(c.load, { from: 330, to: 350, delta: 20 });
  assert.equal(c.effort, null);
  assert.deepEqual(comparisonRows(t, c, "lb").map((r) => [r.previous, r.current, r.change]), [["330 lb", "350 lb", "↑ +20 lb"], ["12", "12", "—"], ["1", "1", "—"]]);
});

test("compareToPrevious: RIR rows use effort wording, missing RIR reads not logged", () => {
  const c = compareToPrevious(exposure("2026-09-08", 350, 12, { topSet: { load: 350, reps: 12, rir: 3 } }), exposure("2026-09-01", 350, 12));
  assert.equal(c?.effort, "lower");
  assert.equal(comparisonRows(t, c!, "lb")[2].change, "progress.compare.effortDown");
  const higher = compareToPrevious(exposure("2026-09-08", 350, 12, { topSet: { load: 350, reps: 12, rir: 0 } }), exposure("2026-09-01", 350, 12));
  assert.equal(higher?.effort, "higher");
  assert.equal(comparisonRows(t, higher!, "lb")[2].change, "progress.compare.effortUp");
  const missing = compareToPrevious(exposure("2026-09-08", 350, 12, { topSet: { load: 350, reps: 12 } }), exposure("2026-09-01", 350, 12));
  assert.equal(missing?.rir.delta, null);
  assert.equal(missing?.effort, null);
  assert.deepEqual(comparisonRows(t, missing!, "lb")[2], { key: "rir", previous: "1", current: "progress.compare.notLogged", change: "progress.compare.notLogged", tone: "none" });
});

test("compareToPrevious: reps and bodyweight rows", () => {
  const c = compareToPrevious(exposure("2026-09-08", null, 10), exposure("2026-09-01", null, 12));
  assert.deepEqual(c?.load, { from: null, to: null, delta: null });
  const rows = comparisonRows(t, c!, "kg");
  assert.equal(rows[1].change, "↓ −2");
  assert.equal(rows[0].change, "—");
});

test("compareToPrevious: no previous exposure gives null", () => {
  assert.equal(compareToPrevious(exposure("2026-09-08", 350, 12), undefined), null);
});

test("compareToPrevious: sameDay and previousSource", () => {
  const sameDay = compareToPrevious(exposure("2026-09-08", 350, 12), exposure("2026-09-08", 330, 12));
  assert.equal(sameDay?.sameDay, true);
  assert.equal(sameDay?.previousSource, "OWN");
  const other = compareToPrevious(exposure("2026-09-08", 350, 12), exposure("2026-09-01", 330, 12, { source: "OTHER_COACH" }));
  assert.equal(other?.sameDay, false);
  assert.equal(other?.previousSource, "OTHER_COACH");
});

test("describeComparison (zh-TW): every plan case", () => {
  const d = (c: ReturnType<typeof cmp>, unit = "kg") => describeComparison(zh, c, unit);
  assert.equal(d(cmp({ rir: 1 }, { rir: 3 })), "同重量、同次數，以較低 effort 完成");
  assert.equal(d(cmp({ reps: 7 }, { reps: 6 })), "同重量、相同 RIR，少 1 rep");
  assert.equal(d(cmp({ load: 100, reps: 8 }, { load: 105, reps: 6 })), "重量增加 5 kg，少 2 reps，RIR 相同");
  assert.equal(d(cmp({ load: 100 }, { load: 105 })), "重量增加 5 kg，次數與 RIR 維持");
  assert.equal(d(cmp({}, {})), "與上次相同");
  assert.equal(d(cmp({ load: 140 }, { load: 130 })), "重量減少 10 kg，次數與 RIR 維持");
  assert.equal(d(cmp({ rir: 3 }, { rir: 1 })), "同重量、同次數，以較高 effort 完成");
  assert.equal(d(cmp({ reps: 6 }, { reps: 8 })), "同重量、相同 RIR，多 2 reps");
  const missing = cmp({}, { rir: undefined });
  assert.equal(missing.effort, null);
  assert.equal(d(missing), "同重量、同次數，RIR 未記錄，無法比較 effort");
  assert.ok(d(cmp({ load: 100 }, { load: 105, rir: undefined })).includes("RIR 未記錄，無法比較 effort"));
});

test("describeComparison: lb is never converted; en wording differs and stays neutral", () => {
  assert.equal(describeComparison(zh, cmp({ load: 315 }, { load: 325 }), "lb"), "重量增加 10 lb，次數與 RIR 維持");
  assert.equal(describeComparison(enT, cmp({ load: 315 }, { load: 325 }), "lb"), "Load up 10 lb; reps and RIR unchanged");
  assert.equal(describeComparison(enT, cmp({ rir: 1 }, { rir: 3 }), "kg"), "Same load, same reps; done at lower effort");
  assert.equal(describeComparison(enT, cmp({}, {}), "kg"), "Same as last time");
  assert.equal(comparisonRows(t, cmp({ load: 315 }, { load: 325 }), "lb")[0].change, "↑ +10 lb");
});

test("visibleLabels: only the selected and the latest point", () => {
  const pts = [0, 10, 20, 100, 110, 150].map((x) => ({ x }));
  assert.deepEqual([...visibleLabels(pts, 1)].sort(), [1, 5]);
  assert.deepEqual([...visibleLabels(pts, 5)], [5]);
  assert.deepEqual([...visibleLabels(pts, -1)], [5]);
  assert.deepEqual([...visibleLabels([], -1)], []);
});

test("chart: hollow for other-Coach points, no load-change guides, time-proportional x", () => {
  const chart = layoutChart([
    exposure("2026-09-01", 80, 8),
    exposure("2026-09-08", 82.5, 8, { source: "OTHER_COACH", events: [{ type: "LOAD_CHANGE", delta: 2.5, unit: "kg" }] }),
    exposure("2026-09-29", 82.5, 9),
  ], "performance");
  assert.equal(chart.points.length, 3);
  assert.deepEqual(chart.points.map((p) => p.hollow), [false, true, false]);
  assert.ok(chart.points.every((p) => !("loadChange" in p)));
  const [a, b, c] = chart.points;
  assert.ok(a.x < b.x && b.x < c.x);
  assert.ok(Math.abs((b.x - a.x) / (c.x - a.x) - 7 / 28) < 1e-9);
  assert.ok(b.y < a.y, "heavier load is higher on screen");
  assert.equal(chart.xTicks.length, 2);
});

test("chart: single point is centred, missing values are skipped, empty is empty", () => {
  const one = layoutChart([exposure("2026-09-01", 80, 8)], "performance");
  assert.equal(one.points.length, 1);
  assert.equal(one.points[0].x, (one.plot.left + one.plot.right) / 2);
  const skipped = layoutChart([exposure("2026-09-01", 80, 8, { estimated1rm: undefined }), exposure("2026-09-08", 80, 8)], "estimated1rm");
  assert.equal(skipped.points.length, 1);
  assert.equal(skipped.points[0].index, 1);
  assert.equal(layoutChart([], "performance").points.length, 0);
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

test("comparisonRows tone marks direction only: up, down, or none", () => {
  const tones = (cur: Parameters<typeof exposure>, prev: Parameters<typeof exposure>) =>
    comparisonRows(t, compareToPrevious(exposure(...cur), exposure(...prev))!, "kg").map((r) => r.tone);
  assert.deepEqual(tones(["2026-09-08", 145, 6], ["2026-09-01", 140, 6]), ["up", "none", "none"]);
  assert.deepEqual(tones(["2026-09-08", 130, 6], ["2026-09-01", 140, 6]), ["down", "none", "none"]);
  assert.deepEqual(tones(["2026-09-08", 140, 5], ["2026-09-01", 140, 6]), ["none", "down", "none"]);
  assert.deepEqual(tones(["2026-09-08", 140, 6], ["2026-09-01", 140, 6]), ["none", "none", "none"]);
  // RIR 1 -> 3 is shown as "↓ effort", so it is "down"; 1 -> 0 is "↑ effort", so "up".
  const rir = (to: number) => comparisonRows(t, compareToPrevious(exposure("2026-09-08", 140, 6, { topSet: { load: 140, reps: 6, rir: to } }), exposure("2026-09-01", 140, 6))!, "kg")[2].tone;
  assert.equal(rir(3), "down");
  assert.equal(rir(0), "up");
  const noRir = compareToPrevious(exposure("2026-09-08", 140, 6, { topSet: { load: 140, reps: 6 } }), exposure("2026-09-01", 140, 6));
  assert.equal(comparisonRows(t, noRir!, "kg")[2].tone, "none");
});
