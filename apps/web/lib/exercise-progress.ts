import type { Translate } from "@/lib/i18n";

// Exercise Progress view model: GET /training-log
// (docs/go-backend-api-contract-v0.1.md §3.10). Everything here is pure so it
// can be unit-tested. Nothing grades or labels progress: events come from the
// server's comparison engine and are shown as objective facts.
export type Unit = "kg" | "lb";
export type Source = "OWN" | "OTHER_COACH";
export type EventType = "LOAD_PR" | "REP_PR" | "LOAD_CHANGE" | "MATCHED" | "REPS_DOWN";

export type ProgressEvent = { type: EventType; load?: number; unit?: Unit; reps?: number; previousReps?: number; delta?: number };
export type LogSet = { setNumber: number; kind: "PLANNED" | "EXTRA"; load: number | null; unit?: Unit; reps: number; rir?: number };
export type LogExercise = { exerciseId: string; name: string; position: number; setLogs: LogSet[]; events: ProgressEvent[] };
// OTHER_COACH sessions arrive with sessionId, scheduledWorkoutId and
// workoutName null.
export type LogSession = {
  sessionId: string | null;
  scheduledWorkoutId: string | null;
  status: "ACTIVE" | "COMPLETED";
  date: string;
  source: Source;
  athlete: { id: string; name: string };
  workoutName: string | null;
  exercises: LogExercise[];
};
export type Exposure = {
  date: string;
  source: Source;
  topSet: { load: number | null; reps: number; rir?: number };
  estimated1rm?: number;
  maxLoad?: number;
  totalReps: number;
  volumeLoad?: number;
  setCount: number;
  position: number;
  events: ProgressEvent[];
};
export type TrainingLog = { sessions: LogSession[]; exposures?: Record<string, Exposure[]> };

export type Metric = "topSet" | "estimated1rm" | "load" | "reps" | "volume";
export const METRICS: Metric[] = ["topSet", "estimated1rm", "load", "reps", "volume"];
export type RangeKey = "3m" | "1y" | "all";
export const RANGES: RangeKey[] = ["3m", "1y", "all"];

// The API serves at most 184 days per request.
export const WINDOW_DAYS = 184;
// "All" pages back this many windows before it stops offering more.
export const MAX_WINDOWS = 24;

const DAY_MS = 86_400_000;

function toDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The caller's local calendar date (the Athlete's "today"), as YYYY-MM-DD.
export function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function addDays(iso: string, days: number): string {
  return toISO(new Date(toDate(iso).getTime() + days * DAY_MS));
}

// Window 0 is the newest: [today-183, today]; window k ends the day before
// window k-1 starts. Each spans 184 days inclusive, the API's maximum.
export function windowBounds(today: string, index: number): { from: string; to: string } {
  const to = addDays(today, -index * WINDOW_DAYS);
  return { from: addDays(to, -(WINDOW_DAYS - 1)), to };
}

// How many windows a range needs up front. "All" starts with a year and then
// pages one window at a time ("Load earlier").
export function initialWindows(range: RangeKey): number {
  return range === "3m" ? 1 : 2;
}

export function rangeCutoff(range: RangeKey, today: string): string | null {
  if (range === "all") return null;
  const d = toDate(today);
  d.setUTCMonth(d.getUTCMonth() - (range === "3m" ? 3 : 12));
  return toISO(d);
}

// windows[0] is the newest. Sessions stay newest first; each unit's exposures
// become oldest first across windows.
export function mergeWindows(windows: TrainingLog[]): TrainingLog {
  const sessions = windows.flatMap((w) => w.sessions);
  const exposures: Record<string, Exposure[]> = {};
  for (const w of [...windows].reverse()) {
    for (const [unit, list] of Object.entries(w.exposures ?? {})) {
      exposures[unit] = [...(exposures[unit] ?? []), ...list];
    }
  }
  return { sessions, exposures };
}

export function filterSince<T extends { date: string }>(list: T[], cutoff: string | null): T[] {
  return cutoff === null ? list : list.filter((item) => item.date >= cutoff);
}

export function metricValue(e: Exposure, metric: Metric): number | null {
  switch (metric) {
    case "topSet": return e.topSet.load;
    case "estimated1rm": return e.estimated1rm ?? null;
    case "load": return e.maxLoad ?? null;
    case "reps": return e.totalReps;
    case "volume": return e.volumeLoad ?? null;
  }
}

export function formatNumber(value: number): string {
  return String(Number(value.toFixed(2)));
}

// "9@1" — the top set's reps and RIR; RIR is left out when it was not logged.
export function pointLabel(e: Exposure): string {
  return e.topSet.rir === undefined ? String(e.topSet.reps) : `${e.topSet.reps}@${formatNumber(e.topSet.rir)}`;
}

export function setSummary(t: Translate, set: { load?: number | null; unit?: Unit; reps: number; rir?: number }): string {
  const load = set.load === null || set.load === undefined ? t("athlete.set.bodyweight") : `${formatNumber(set.load)} ${set.unit ?? ""}`.trim();
  return [load, t("athlete.set.reps", { count: set.reps }), set.rir === undefined ? "" : `RIR ${formatNumber(set.rir)}`].filter(Boolean).join(" · ");
}

export function eventLabel(t: Translate, event: ProgressEvent): string {
  const unit = event.unit ?? "";
  switch (event.type) {
    case "LOAD_PR": return t("progress.event.loadPr");
    case "REP_PR": return event.load === undefined
      ? t("progress.event.repPrBodyweight", { reps: event.reps ?? 0 })
      : t("progress.event.repPr", { reps: event.reps ?? 0, load: formatNumber(event.load), unit });
    case "LOAD_CHANGE": {
      const delta = event.delta ?? 0;
      return `${delta > 0 ? "+" : "−"}${formatNumber(Math.abs(delta))} ${unit}`.trim();
    }
    case "MATCHED": return t("progress.event.matched");
    case "REPS_DOWN": return t("progress.event.repsDown", { from: event.previousReps ?? 0, to: event.reps ?? 0 });
  }
}

export type ChartPoint = { index: number; x: number; y: number; value: number; exposure: Exposure; label: string; hollow: boolean; loadChange: boolean };
export type Chart = { points: ChartPoint[]; yTicks: { y: number; label: string }[]; xTicks: { x: number; date: string }[]; width: number; height: number; plot: { left: number; right: number; top: number; bottom: number } };

export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toFixed(6)));
  return ticks;
}

// Time-proportional x axis; y axis padded 10%. Exposures without a value for
// the metric (no RIR for est. 1RM, bodyweight volume) are skipped. A dashed
// guide is flagged on points whose engine events include a load change.
export function layoutChart(exposures: Exposure[], metric: Metric, width = 320, height = 200): Chart {
  const plot = { left: 40, right: width - 14, top: 16, bottom: height - 26 };
  const usable = exposures.map((exposure, index) => ({ exposure, index, value: metricValue(exposure, metric) })).filter((p): p is { exposure: Exposure; index: number; value: number } => p.value !== null);
  if (usable.length === 0) return { points: [], yTicks: [], xTicks: [], width, height, plot };

  const values = usable.map((p) => p.value);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  const pad = hi === lo ? Math.max(Math.abs(hi) * 0.1, 1) : (hi - lo) * 0.1;
  lo -= pad;
  hi += pad;
  const times = usable.map((p) => toDate(p.exposure.date).getTime());
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (time: number) => (t1 === t0 ? (plot.left + plot.right) / 2 : plot.left + ((time - t0) / (t1 - t0)) * (plot.right - plot.left));
  const y = (value: number) => plot.bottom - ((value - lo) / (hi - lo)) * (plot.bottom - plot.top);

  const points: ChartPoint[] = usable.map((p, i) => ({
    index: p.index,
    x: x(times[i]),
    y: y(p.value),
    value: p.value,
    exposure: p.exposure,
    label: pointLabel(p.exposure),
    hollow: p.exposure.source === "OTHER_COACH",
    loadChange: p.exposure.events.some((e) => e.type === "LOAD_CHANGE"),
  }));
  const yTicks = niceTicks(lo, hi).map((v) => ({ y: y(v), label: formatNumber(v) }));
  const xTicks = t1 === t0 ? [{ x: x(t0), date: usable[0].exposure.date }] : [{ x: x(t0), date: usable[0].exposure.date }, { x: x(t1), date: usable[usable.length - 1].exposure.date }];
  return { points, yTicks, xTicks, width, height, plot };
}

export type TimelineEntry = { exposure: Exposure; sets: LogSet[]; sessionId: string | null; index: number };

// Pairs each exposure of one unit with the session sets behind it. Exposures
// are oldest first and sessions newest first, so they line up reversed; the
// date check keeps a pairing honest, and an unmatched exposure still shows
// its top set.
export function buildTimeline(unit: string, sessions: LogSession[], exposures: Exposure[], exerciseId: string): TimelineEntry[] {
  const candidates = sessions
    .filter((s) => s.status === "COMPLETED")
    .map((s) => ({ session: s, sets: (s.exercises.find((e) => e.exerciseId === exerciseId)?.setLogs ?? []).filter((set) => set.unit === unit) }))
    .filter((c) => c.sets.length > 0);
  const newestFirst = [...exposures].map((exposure, index) => ({ exposure, index })).reverse();
  return newestFirst.map(({ exposure, index }, i) => {
    const match = candidates[i];
    const ok = match !== undefined && match.session.date === exposure.date;
    return { exposure, index, sets: ok ? [...match.sets].sort((a, b) => a.setNumber - b.setNumber) : [], sessionId: ok ? match.session.sessionId : null };
  });
}

export function exerciseNameFrom(sessions: LogSession[], exerciseId: string): string | null {
  for (const s of sessions) {
    const found = s.exercises.find((e) => e.exerciseId === exerciseId);
    if (found) return found.name;
  }
  return null;
}

export type ExerciseSummary = { exerciseId: string; name: string; lastDate: string };

// Distinct exercises in a training log, most recently trained first. Used by
// client detail to link into Exercise Progress.
export function distinctExercises(sessions: LogSession[]): ExerciseSummary[] {
  const seen = new Map<string, ExerciseSummary>();
  for (const s of [...sessions].sort((a, b) => b.date.localeCompare(a.date))) {
    for (const e of s.exercises) if (!seen.has(e.exerciseId)) seen.set(e.exerciseId, { exerciseId: e.exerciseId, name: e.name, lastDate: s.date });
  }
  return [...seen.values()];
}
