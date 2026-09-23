import { applyProgressionPrefill } from "../../../lib/load-increment.ts";
import { weekDays } from "./calendar-date.ts";
import { savedWorkoutToDraft, type DraftExercise } from "./workout-draft.ts";
import type { ScheduledWorkoutSummary, Workout } from "./types.ts";

export const REPEAT_WEEK_OFFSET_DAYS = 7;

function toISODate(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return toISODate(new Date(year, month - 1, day + amount));
}

export function repeatWeekBounds(weekAnchor: string): { start: string; end: string; days: string[] } {
  const days = weekDays(weekAnchor);
  return { start: days[0], end: days[6], days };
}

export function collectWeekAssignments(
  assignments: readonly ScheduledWorkoutSummary[],
  athleteId: string,
  days: readonly string[],
): ScheduledWorkoutSummary[] {
  const daySet = new Set(days);
  return assignments
    .filter((assignment) => assignment.athlete.id === athleteId && daySet.has(assignment.scheduledDate))
    .sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.workout.name.localeCompare(right.workout.name));
}

export type RepeatWeekPreviewExercise = {
  name: string;
  sourceSets: number;
  suggestedSets: number;
  suggestedLoad: string | null;
};

export type RepeatWeekPreviewItem = {
  sourceAssignmentId: string;
  sourceDate: string;
  targetDate: string;
  workoutId: string;
  workoutName: string;
  exercises: RepeatWeekPreviewExercise[];
  hasConflict: boolean;
};

function formatSuggestedLoad(exercise: DraftExercise): string | null {
  if (exercise.defaultLoad.trim() === "") return null;
  return `${exercise.defaultLoad} ${exercise.unit}`;
}

export function buildRepeatWeekPreview(
  sourceAssignments: readonly ScheduledWorkoutSummary[],
  workoutsById: ReadonlyMap<string, Workout>,
  targetAssignmentsByDate: ReadonlyMap<string, readonly ScheduledWorkoutSummary[]>,
  lastCompleted: Record<string, number | null>,
): RepeatWeekPreviewItem[] {
  return sourceAssignments.flatMap((assignment) => {
    const workout = workoutsById.get(assignment.workout.id);
    if (workout === undefined) return [];
    const draft = workoutToRepeatDraft(workout, lastCompleted);
    const targetDate = addDays(assignment.scheduledDate, REPEAT_WEEK_OFFSET_DAYS);
    const targetDayAssignments = targetAssignmentsByDate.get(targetDate) ?? [];
    return [{
      sourceAssignmentId: assignment.id,
      sourceDate: assignment.scheduledDate,
      targetDate,
      workoutId: workout.id,
      workoutName: workout.name,
      exercises: draft.exercises.map((exercise, index) => {
        const source = workout.exercises[index];
        const sourceSets = source?.plan.setCount ?? Number(exercise.setCount);
        return {
          name: exercise.exercise.name,
          sourceSets,
          suggestedSets: Number(exercise.setCount),
          suggestedLoad: formatSuggestedLoad(exercise),
        };
      }),
      hasConflict: targetDayAssignments.length > 0,
    }];
  });
}

export function workoutToRepeatDraft(
  workout: Workout,
  lastCompleted: Record<string, number | null>,
): { name: string; exercises: DraftExercise[] } {
  const copied = savedWorkoutToDraft(workout);
  return {
    name: workout.name,
    exercises: applyProgressionPrefill(copied.exercises, lastCompleted),
  };
}

export type RepeatWeekApplyRecord = {
  sourceDate: string;
  targetDate: string;
  workoutName: string;
  workoutId: string;
  scheduled: boolean;
};

export type RepeatWeekApplyFailure = {
  sourceDate: string;
  targetDate: string;
  workoutName: string;
  workoutId: string | null;
  phase: "create" | "schedule";
  error: string;
};

export type RepeatWeekApplyCallbacks = {
  createWorkout: (body: { name: string; exercises: ReturnType<typeof buildRepeatCreateExercises> }) => Promise<{ id: string }>;
  scheduleWorkout: (body: { workoutId: string; athleteIds: readonly string[]; scheduledDate: string }) => Promise<void>;
};

export function buildRepeatCreateExercises(exercises: DraftExercise[]) {
  return exercises.map((item) => ({
    name: item.exercise.name,
    loadIncrement: item.loadIncrement,
    setIncrement: item.setIncrement,
    ...(item.coachCue.trim() === "" ? {} : { coachCue: item.coachCue.trim() }),
    plan: {
      setCount: Number(item.setCount),
      defaults: {
        ...(item.prescriptionMode === "REPS" ? { reps: Number(item.defaultReps) } : { prescriptionNote: item.defaultPrescriptionNote.trim() }),
        ...(item.defaultLoad.trim() === "" ? {} : { load: Number(item.defaultLoad) }),
        ...(item.defaultLoad.trim() === "" && !item.overrides.some((override) => override.load !== undefined) ? {} : { unit: item.unit }),
        ...(item.defaultRpe.trim() === "" ? {} : { rpe: Number(item.defaultRpe) }),
      },
      overrides: item.overrides.map((override) => ({
        position: override.position,
        ...(override.reps === undefined ? {} : { reps: Number(override.reps) }),
        ...(override.prescriptionNote === undefined ? {} : { prescriptionNote: override.prescriptionNote.trim() }),
        ...(override.load === undefined ? {} : { load: Number(override.load) }),
        ...(override.rpe === undefined ? {} : { rpe: Number(override.rpe) }),
      })),
    },
  }));
}

export async function applyRepeatWeekBatch(
  items: readonly RepeatWeekPreviewItem[],
  workoutsById: ReadonlyMap<string, Workout>,
  athleteId: string,
  lastCompleted: Record<string, number | null>,
  callbacks: RepeatWeekApplyCallbacks,
  startIndex = 0,
): Promise<
  | { status: "complete"; completed: RepeatWeekApplyRecord[] }
  | { status: "failed"; completed: RepeatWeekApplyRecord[]; failure: RepeatWeekApplyFailure; remainingCount: number }
> {
  const completed: RepeatWeekApplyRecord[] = [];

  for (let index = startIndex; index < items.length; index += 1) {
    const item = items[index];
    const workout = workoutsById.get(item.workoutId);
    if (workout === undefined) {
      return {
        status: "failed",
        completed,
        failure: {
          sourceDate: item.sourceDate,
          targetDate: item.targetDate,
          workoutName: item.workoutName,
          workoutId: null,
          phase: "create",
          error: "Workout template not found",
        },
        remainingCount: items.length - index,
      };
    }

    const draft = workoutToRepeatDraft(workout, lastCompleted);
    let workoutId: string;
    try {
      const created = await callbacks.createWorkout({
        name: draft.name,
        exercises: buildRepeatCreateExercises(draft.exercises),
      });
      workoutId = created.id;
    } catch (error) {
      return {
        status: "failed",
        completed,
        failure: {
          sourceDate: item.sourceDate,
          targetDate: item.targetDate,
          workoutName: item.workoutName,
          workoutId: null,
          phase: "create",
          error: error instanceof Error ? error.message : String(error),
        },
        remainingCount: items.length - index,
      };
    }

    try {
      await callbacks.scheduleWorkout({
        workoutId,
        athleteIds: [athleteId],
        scheduledDate: item.targetDate,
      });
    } catch (error) {
      completed.push({
        sourceDate: item.sourceDate,
        targetDate: item.targetDate,
        workoutName: item.workoutName,
        workoutId,
        scheduled: false,
      });
      return {
        status: "failed",
        completed,
        failure: {
          sourceDate: item.sourceDate,
          targetDate: item.targetDate,
          workoutName: item.workoutName,
          workoutId,
          phase: "schedule",
          error: error instanceof Error ? error.message : String(error),
        },
        remainingCount: items.length - index - 1,
      };
    }

    completed.push({
      sourceDate: item.sourceDate,
      targetDate: item.targetDate,
      workoutName: item.workoutName,
      workoutId,
      scheduled: true,
    });
  }

  return { status: "complete", completed };
}

export async function retryRepeatWeekSchedule(
  failure: RepeatWeekApplyFailure,
  athleteId: string,
  callbacks: Pick<RepeatWeekApplyCallbacks, "scheduleWorkout">,
): Promise<void> {
  if (failure.workoutId === null || failure.phase !== "schedule") {
    throw new Error("Nothing to retry");
  }
  await callbacks.scheduleWorkout({
    workoutId: failure.workoutId,
    athleteIds: [athleteId],
    scheduledDate: failure.targetDate,
  });
}
