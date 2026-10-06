import type { Translate } from "@/lib/i18n";
import { formatNumber, type EventType, type Unit } from "@/lib/exercise-progress";

// Coach Progress Overview view model: GET /athletes/{athleteId}/progress-overview
// (docs/go-backend-api-contract-v0.1.md §3.11). Pure so it can be unit-tested.
// Objective data only: nothing here grades, scores, labels or recommends.
export type OverviewEvent = { date: string; type: EventType; load?: number; unit?: Unit; reps?: number; previousReps?: number; delta?: number };
export type OverviewExercise = {
  exerciseId: string;
  name: string;
  unit: Unit;
  latest: { date: string; topSet: { load: number | null; reps: number; rir?: number } };
  trend: { weekStart: string; estimated1rm: number | null }[];
  recentEvents: OverviewEvent[];
  exposures: number;
};
export type ProgressOverview = {
  athlete: { id: string; name: string };
  window: { from: string; to: string; weeks: number };
  assignments: {
    scope: "OWN";
    scheduled: number;
    completed: number;
    completionRate: number | null;
    plannedSets: number;
    completedPlannedSets: number;
    extraSets: number;
  };
  // LOAD_PR / REP_PR over the last 28 days across all exercises and units;
  // computed by the API without the per-exercise recentEvents cap.
  recentEventTotals: { windowDays: number; loadPr: number; repPr: number; total: number };
  exercises: OverviewExercise[];
};

// "32.5 kg × 11 @1": the latest top set. RIR is left out when not logged.
export function topSetText(topSet: OverviewExercise["latest"]["topSet"], unit: Unit): string {
  const load = topSet.load === null ? "" : `${formatNumber(topSet.load)} ${unit} × `;
  const rir = topSet.rir === undefined ? "" : ` @${formatNumber(topSet.rir)}`;
  return `${load}${topSet.reps}${rir}`;
}

// null = no assignments of the caller's in the window: show a dash, not 0%.
export function completionText(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

export type Chip = { key: "loadPr" | "repPr" | "loadUp"; label: string };

// Distinct chips for one row, newest-first order of first appearance:
// Load PR, Rep PR, and the load-increase delta ("+20 lb", newest positive
// LOAD_CHANGE wins since events are newest-first). Other engine events
// (matched, reps down, load down) are not chips.
export function eventChips(t: Translate, events: OverviewEvent[]): Chip[] {
  const chips: Chip[] = [];
  const add = (key: Chip["key"], label: string) => {
    if (!chips.some((c) => c.key === key)) chips.push({ key, label });
  };
  for (const e of events) {
    if (e.type === "LOAD_PR") add("loadPr", t("progress.event.loadPr"));
    else if (e.type === "REP_PR") add("repPr", t("progress.overview.chip.repPr"));
    else if (e.type === "LOAD_CHANGE" && (e.delta ?? 0) > 0) add("loadUp", `+${formatNumber(e.delta ?? 0)}${e.unit ? ` ${e.unit}` : ""}`);
  }
  return chips;
}

export type Sparkline = {
  width: number;
  height: number;
  // Consecutive weeks with data; a week without data breaks the line (no
  // interpolation). A one-week run is drawn as a dot only.
  runs: { x: number; y: number }[][];
  last: { x: number; y: number } | null;
};

// Time-proportional by week index; y is scaled to the row's own min/max
// (padded) so the line shows direction, not magnitude.
export function layoutSparkline(trend: OverviewExercise["trend"], width = 96, height = 28): Sparkline {
  const pad = 3;
  const values = trend.map((p) => p.estimated1rm).filter((v): v is number => v !== null);
  const runs: Sparkline["runs"] = [];
  let last: Sparkline["last"] = null;
  if (values.length === 0) return { width, height, runs, last };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const x = (i: number) => (trend.length === 1 ? width / 2 : pad + (i / (trend.length - 1)) * (width - 2 * pad));
  const y = (v: number) => (hi === lo ? height / 2 : height - pad - ((v - lo) / (hi - lo)) * (height - 2 * pad));
  let run: { x: number; y: number }[] = [];
  trend.forEach((point, i) => {
    if (point.estimated1rm === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    const p = { x: x(i), y: y(point.estimated1rm) };
    run.push(p);
    last = p;
  });
  if (run.length > 0) runs.push(run);
  return { width, height, runs, last };
}
