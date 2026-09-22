import type { Translate } from "@/lib/i18n";
import { orderedPlannedSets, targetSummary, type Plan, type PlannedSet } from "@/lib/prescription-summary";

export type { Plan, PlannedSet };

export type SetLog = {
  id: string;
  kind: "PLANNED" | "EXTRA";
  scheduledWorkoutPlannedSetId?: string;
  plannedPosition?: number;
  setNumber: number;
  load?: number;
  unit?: "kg" | "lb";
  reps: number;
  rpe?: number;
  loggedByUserId: string;
};

export type SessionExercise = {
  scheduledWorkoutExerciseId: string;
  exerciseId: string;
  name: string;
  plan: Plan;
  coachCue?: string;
  youtubeUrl?: string;
  setLogs: SetLog[];
  origin: "ASSIGNED" | "COACH_ADDED" | "ATHLETE_ADDED";
  addedByUserId?: string;
  removedAt?: string;
  removedByUserId?: string;
  replacesScheduledWorkoutExerciseId?: string;
};

export type ExerciseOption = { id: string; name: string; scope: "SYSTEM" | "PRIVATE" };
export type Me = { id: string; role: "COACH" | "ATHLETE" };
export type SessionDetail = { id: string; status: "ACTIVE" | "COMPLETED"; athlete: { id: string; name: string }; exercises: SessionExercise[] };
export type SetLogFormState = { load: string; unit: "kg" | "lb"; reps: string; rpe: string; submitting: boolean; error: string | null };
export type SetLogKind = "PLANNED" | "EXTRA";
export type EditFormState = SetLogFormState;

export function emptyForm(): SetLogFormState {
  return { load: "", unit: "kg", reps: "", rpe: "", submitting: false, error: null };
}

export function formForPlannedSet(target: PlannedSet): SetLogFormState {
  return { load: target.load === undefined ? "" : String(target.load), unit: target.unit ?? "kg", reps: target.reps === undefined ? "" : String(target.reps), rpe: "", submitting: false, error: null };
}

export function orderedTargets(exercise: SessionExercise): PlannedSet[] {
  return orderedPlannedSets(exercise.plan);
}

export function actualForTarget(exercise: SessionExercise, target: PlannedSet): SetLog | undefined {
  return exercise.setLogs.find((log) => log.kind === "PLANNED" && log.scheduledWorkoutPlannedSetId === target.scheduledWorkoutPlannedSetId);
}

export function firstIncompleteTarget(exercise: SessionExercise): PlannedSet | undefined {
  const completedPlannedSetIds = new Set(
    exercise.setLogs
      .filter((log) => log.kind === "PLANNED" && log.scheduledWorkoutPlannedSetId !== undefined)
      .map((log) => log.scheduledWorkoutPlannedSetId),
  );
  return orderedTargets(exercise).find((target) => !completedPlannedSetIds.has(target.scheduledWorkoutPlannedSetId));
}

export function actualSummary(t: Translate, log: SetLog): string {
  return [log.load === undefined ? t("athlete.set.bodyweight") : `${log.load} ${log.unit}`, t("athlete.set.reps", { count: log.reps }), log.rpe === undefined ? "" : `RPE ${log.rpe}`].filter(Boolean).join(" · ");
}

export function plannedFormKey(target: PlannedSet): string {
  return `planned:${target.scheduledWorkoutPlannedSetId}`;
}

export function extraFormKey(exercise: SessionExercise): string {
  return `extra:${exercise.scheduledWorkoutExerciseId}`;
}

export function editKey(log: SetLog): string {
  return `edit:${log.id}`;
}

export { targetSummary };
