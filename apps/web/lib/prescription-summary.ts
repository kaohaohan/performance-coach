type SummaryTranslate = (key: "athlete.plan.none" | "athlete.plan.mixedSets" | "athlete.set.reps", vars?: { count?: number }) => string;

export type PlannedSet = {
  scheduledWorkoutPlannedSetId: string;
  position: number;
  reps?: number;
  prescriptionNote?: string;
  load?: number;
  unit?: "kg" | "lb";
  rpe?: number;
};

export type Plan = { sets: PlannedSet[] };

export function orderedPlannedSets(plan: Plan): PlannedSet[] {
  return [...plan.sets].sort((left, right) => left.position - right.position);
}

export function samePrescription(left: PlannedSet, right: PlannedSet): boolean {
  return left.reps === right.reps
    && left.prescriptionNote === right.prescriptionNote
    && left.load === right.load
    && left.unit === right.unit
    && left.rpe === right.rpe;
}

export function targetSummary(t: SummaryTranslate, target: PlannedSet): string {
  const prescription = target.reps === undefined ? target.prescriptionNote ?? "" : t("athlete.set.reps", { count: target.reps });
  return [prescription, target.load === undefined ? "" : `${target.load} ${target.unit}`, target.rpe === undefined ? "" : `RPE ${target.rpe}`].filter(Boolean).join(" · ");
}

export function compactPrescription(t: SummaryTranslate, plan: Plan): string {
  const targets = orderedPlannedSets(plan);
  if (targets.length === 0) return t("athlete.plan.none");
  const first = targets[0];
  if (!targets.every((target) => samePrescription(first, target))) {
    return t("athlete.plan.mixedSets", { count: targets.length });
  }
  const head = first.reps === undefined
    ? [String(targets.length), first.prescriptionNote ?? ""].filter(Boolean).join(" × ")
    : `${targets.length} × ${first.reps}`;
  return [head, first.load === undefined ? "" : `${first.load} ${first.unit}`, first.rpe === undefined ? "" : `RPE ${first.rpe}`].filter(Boolean).join(" · ");
}
