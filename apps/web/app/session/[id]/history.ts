import type { Translate } from "@/lib/i18n";

// LAST / PR baseline from GET /sessions/{id} (`history` on each exercise,
// docs/go-backend-api-contract-v0.1.md §3.7). It carries no ids and is never
// converted between kg and lb.
export type HistorySet = { setNumber: number; load?: number; unit?: "kg" | "lb"; reps: number; rir?: number };
export type HistoryBest = { load: number | null; unit?: "kg" | "lb"; reps: number; date: string };
export type ExerciseHistory = {
  last: { date: string; setLogs: HistorySet[] } | null;
  maxLoad: HistoryBest | null;
  bestRepsByLoad: HistoryBest[];
};

type LoggedSet = { load?: number; unit?: "kg" | "lb"; reps: number };

// "2026-09-29" → "9/29". Plain month/day reads the same in en and zh-TW.
export function shortDate(isoDate: string): string {
  const [, month, day] = isoDate.split("-");
  if (month === undefined || day === undefined) return isoDate;
  return `${Number(month)}/${Number(day)}`;
}

// "32.5 kg × 9·9·8 @1": consecutive sets at one load are grouped; RIR is
// shown only when every set in the group has one (one value when equal).
export function lastSummary(last: NonNullable<ExerciseHistory["last"]>): string {
  const groups: HistorySet[][] = [];
  for (const set of [...last.setLogs].sort((a, b) => a.setNumber - b.setNumber)) {
    const group = groups[groups.length - 1];
    if (group !== undefined && group[0].load === set.load && group[0].unit === set.unit) group.push(set);
    else groups.push([set]);
  }
  return groups.map((group) => {
    const head = group[0].load === undefined ? "" : `${group[0].load} ${group[0].unit ?? ""}`.trim();
    const reps = group.map((set) => set.reps).join("·");
    const rirs = group.map((set) => set.rir);
    const allKnown = rirs.every((rir): rir is number => rir !== undefined);
    const effort = allKnown ? ` @${rirs.every((rir) => rir === rirs[0]) ? rirs[0] : rirs.join("·")}` : "";
    return `${head ? `${head} × ` : ""}${reps}${effort}`;
  }).join(" / ");
}

// The PR to show next to the current set: the best reps at the target load
// when that load has been done before, otherwise at the heaviest load done.
export function prFor(history: ExerciseHistory, load: number | undefined, unit: string | undefined): HistoryBest | null {
  if (load !== undefined) {
    const atLoad = history.bestRepsByLoad.find((best) => best.load === load && best.unit === unit);
    if (atLoad !== undefined) return atLoad;
  }
  if (history.maxLoad !== null) return history.maxLoad;
  return history.bestRepsByLoad.find((best) => best.load === null) ?? null;
}

export function prHeading(t: Translate, best: HistoryBest): string {
  return best.load === null ? t("athlete.history.prBodyweight") : t("athlete.history.prAt", { load: best.load, unit: best.unit ?? "" });
}

export function prLabel(t: Translate, best: HistoryBest): string {
  return `${prHeading(t, best)} — ${t("athlete.set.reps", { count: best.reps })}`;
}

export type SetBadge = "REP_PR" | "MATCHED";

// Provisional badge for the just-logged set, judged only against the earlier
// sessions in `history`. Rep PR needs an earlier record at that exact load
// (same rule as the server engine); Matched means the same load and reps as
// last time's top set. The persisted events always come from the server.
export function provisionalBadge(history: ExerciseHistory | undefined, set: LoggedSet): SetBadge | null {
  if (history === undefined) return null;
  const earlier = history.bestRepsByLoad.find((best) => best.load === (set.load ?? null) && (set.load === undefined || best.unit === set.unit));
  if (earlier !== undefined && set.reps > earlier.reps) return "REP_PR";
  const top = history.last === null ? null : topSet(history.last.setLogs);
  if (top !== null && top.load === set.load && (set.load === undefined || top.unit === set.unit) && top.reps === set.reps) return "MATCHED";
  return null;
}

// Heaviest set; ties go to the most reps, then the lowest set number.
function topSet(sets: HistorySet[]): HistorySet | null {
  let best: HistorySet | null = null;
  for (const set of sets) {
    if (best === null) { best = set; continue; }
    const [load, bestLoad] = [set.load ?? 0, best.load ?? 0];
    if (load > bestLoad || (load === bestLoad && (set.reps > best.reps || (set.reps === best.reps && set.setNumber < best.setNumber)))) best = set;
  }
  return best;
}
