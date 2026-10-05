import type { PlannedUnit } from "../app/coach/calendar/workout-draft.ts";

export const KG_LOAD_INCREMENTS = [0, 2.5, 5, 10] as const;
export const LB_LOAD_INCREMENTS = [0, 5, 10] as const;

export function defaultLoadIncrement(unit: PlannedUnit): number {
  return unit === "lb" ? 5 : 2.5;
}

export function allowedLoadIncrements(unit: PlannedUnit): readonly number[] {
  return unit === "lb" ? LB_LOAD_INCREMENTS : KG_LOAD_INCREMENTS;
}

export function normalizeLoadIncrement(unit: PlannedUnit, value: number): number {
  const allowed = allowedLoadIncrements(unit);
  return allowed.includes(value) ? value : defaultLoadIncrement(unit);
}

export function suggestBumpedLoad(base: number | null | undefined, increment: number): number | null {
  if (base === null || base === undefined || Number.isNaN(base)) return null;
  if (increment === 0) return base;
  return base + increment;
}

export function suggestBumpedSetCount(sourceSets: number, setIncrement: number): number {
  if (!Number.isInteger(sourceSets) || sourceSets < 1 || setIncrement === 0) return sourceSets;
  return sourceSets + setIncrement;
}

export function suggestBumpedReps(sourceReps: number, repsIncrement: number): number {
  if (!Number.isInteger(sourceReps) || sourceReps < 1 || repsIncrement === 0) return sourceReps;
  return sourceReps + repsIncrement;
}

export type DraftExerciseProgressionPrefill = {
  exercise: { id: string };
  defaultLoad: string;
  unit: PlannedUnit;
  loadIncrement: number;
  setCount: string;
  setIncrement: number;
  repsIncrement: number;
  prescriptionMode: "REPS" | "TEXT";
  defaultReps: string;
  overrides: Array<{ position: number; load?: string; reps?: string }>;
};

export function applyLoadIncrementPrefill<T extends DraftExerciseProgressionPrefill>(
  exercises: T[],
  lastCompleted: Record<string, number | null>,
): T[] {
  return exercises.map((item) => {
    if (item.loadIncrement === 0) return item;
    const history = lastCompleted[item.exercise.id] ?? null;
    const templateLoad = item.defaultLoad.trim() === "" ? null : Number(item.defaultLoad);
    const defaultBase = history ?? templateLoad;
    const bumpedDefault = suggestBumpedLoad(defaultBase, item.loadIncrement);
    const overrides = item.overrides.map((override) => {
      if (override.load === undefined) return override;
      const overrideTemplate = override.load.trim() === "" ? null : Number(override.load);
      const overrideBase = history ?? overrideTemplate;
      const bumped = suggestBumpedLoad(overrideBase, item.loadIncrement);
      return bumped === null ? override : { ...override, load: String(bumped) };
    });
    return {
      ...item,
      defaultLoad: bumpedDefault === null ? item.defaultLoad : String(bumpedDefault),
      overrides,
    };
  });
}

export function applyRepsIncrementPrefill<T extends Pick<DraftExerciseProgressionPrefill, "repsIncrement" | "prescriptionMode" | "defaultReps" | "overrides">>(
  exercises: T[],
): T[] {
  return exercises.map((item) => {
    if (item.repsIncrement < 1 || item.prescriptionMode !== "REPS") return item;
    const defaultReps = Number(item.defaultReps);
    const bumpedDefault = Number.isInteger(defaultReps) && defaultReps >= 1
      ? String(suggestBumpedReps(defaultReps, item.repsIncrement))
      : item.defaultReps;
    const overrides = item.overrides.map((override) => {
      if (override.reps === undefined) return override;
      const reps = Number(override.reps);
      if (!Number.isInteger(reps) || reps < 1) return override;
      return { ...override, reps: String(suggestBumpedReps(reps, item.repsIncrement)) };
    });
    return { ...item, defaultReps: bumpedDefault, overrides };
  });
}

export function applySetIncrementPrefill<T extends Pick<DraftExerciseProgressionPrefill, "setCount" | "setIncrement">>(
  exercises: T[],
): T[] {
  return exercises.map((item) => {
    if (item.setIncrement === 0) return item;
    const count = Number(item.setCount);
    if (!Number.isInteger(count) || count < 1) return item;
    return { ...item, setCount: String(suggestBumpedSetCount(count, item.setIncrement)) };
  });
}

export function applyProgressionPrefill<T extends DraftExerciseProgressionPrefill>(
  exercises: T[],
  lastCompleted: Record<string, number | null>,
): T[] {
  return applySetIncrementPrefill(applyRepsIncrementPrefill(applyLoadIncrementPrefill(exercises, lastCompleted)));
}

export function buildLastCompletedLoadsQuery(exercises: Pick<DraftExerciseProgressionPrefill, "exercise" | "unit">[]): { exerciseIds: string; units: string } | null {
  if (exercises.length === 0) return null;
  const exerciseIds = exercises.map((item) => item.exercise.id).join(",");
  const units = exercises.map((item) => item.unit).join(",");
  return { exerciseIds, units };
}
