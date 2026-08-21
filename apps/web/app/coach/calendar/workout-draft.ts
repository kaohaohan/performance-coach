// Browser-local persistence for the Coach Calendar "Build Workout" authoring
// flow (Problem A — Workout Builder Draft Persistence). MVP scope
// deliberately keeps this out of the database: no migration, no new table,
// no backend deployment. A Coach's in-progress authoring state lives only
// in this browser, scoped to that Coach's account, and survives navigation
// away from the Calendar page, a refresh, or closing the tab.
//
// What we persist is exactly the Build Workout authoring state needed to
// restore the builder exactly: workout name, ordered exercises (identity,
// scope, set count, prescription mode, defaults, sparse per-set overrides),
// the athletes selected to assign to, and the scheduled date — nothing
// server-unsafe. We never persist the Firebase ID token, credentials, or any
// server-generated id that isn't already a stable Exercise id the builder
// requires anyway (exercise.id is looked up/created independently of this
// draft, same as a normal Add Exercise).
//
// selectedAthleteIds is stored for shape completeness but is deliberately
// NOT replayed verbatim on restore (see the restore effect in page.tsx):
// blindly re-checking whoever was selected in a prior session could arm
// Build & Assign against athletes the Coach never chose in *this* session.
// The page instead re-derives a safe default (just the current calendar
// athlete) unless the draft is resuming an Edit Assigned Workout target,
// whose single athlete is fixed and inert (the picker is hidden and Save
// Changes never reads this field).
"use client";

export type ExerciseScope = "SYSTEM" | "PRIVATE";
export type Exercise = { id: string; name: string; scope: ExerciseScope };
export type PrescriptionMode = "REPS" | "TEXT";
export type PlannedUnit = "kg" | "lb";

export type DraftSetOverride = {
  position: number;
  prescriptionMode?: PrescriptionMode;
  reps?: string;
  prescriptionNote?: string;
  load?: string;
  rpe?: string;
};

export type DraftExercise = {
  exercise: Exercise;
  setCount: string;
  prescriptionMode: PrescriptionMode;
  defaultReps: string;
  defaultPrescriptionNote: string;
  defaultLoad: string;
  unit: PlannedUnit;
  defaultRpe: string;
  overrides: DraftSetOverride[];
  customizationOpen: boolean;
  editingPositions: number[];
};

// EditTarget marks a draft as editing one specific already-assigned
// ScheduledWorkout (Problem B) rather than authoring a new one. When
// present, the builder's submit action is "Save Changes" (PUT
// /scheduled-workouts/{id}) instead of "Build & Assign" (POST /workouts +
// POST /scheduled-workouts).
export type DraftEditTarget = {
  scheduledWorkoutId: string;
  athleteId: string;
  athleteName: string;
  workoutName: string;
};

export type WorkoutBuilderDraftContent = {
  name: string;
  exercises: DraftExercise[];
  selectedAthleteIds: string[];
  scheduledDate: string;
  editTarget: DraftEditTarget | null;
};

export type WorkoutBuilderDraft = WorkoutBuilderDraftContent & {
  version: 1;
  savedAt: string;
};

const DRAFT_VERSION = 1 as const;

function draftKey(coachId: string): string {
  return `performance-coach:workout-builder-draft:${coachId}`;
}

function isDraftShape(value: unknown): value is WorkoutBuilderDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Record<string, unknown>;
  return (
    draft.version === DRAFT_VERSION &&
    typeof draft.name === "string" &&
    Array.isArray(draft.exercises) &&
    Array.isArray(draft.selectedAthleteIds) &&
    typeof draft.scheduledDate === "string"
  );
}

// loadDraft reads and parses the Coach-scoped draft, if any. Returns null on
// a missing draft, a shape mismatch (e.g. an older/incompatible version), or
// any storage/parse error — draft restoration is a UX nicety, never a hard
// requirement, so callers should treat null as "start fresh."
export function loadDraft(coachId: string): WorkoutBuilderDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(coachId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraftShape(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// saveDraft immediately serializes and persists content, stamping the
// current time. Callers debounce their own autosave calls; this function
// itself never debounces so it also serves the explicit "Save Draft"
// action, which must write synchronously.
export function saveDraft(coachId: string, content: WorkoutBuilderDraftContent): void {
  if (typeof window === "undefined") return;
  const draft: WorkoutBuilderDraft = { ...content, version: DRAFT_VERSION, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(draftKey(coachId), JSON.stringify(draft));
  } catch {
    // localStorage can throw (quota exceeded, private browsing, disabled
    // storage). Draft persistence degrades to in-memory-only in that case;
    // it must never break the builder itself.
  }
}

export function clearDraft(coachId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(draftKey(coachId));
  } catch {
    // ignore — see saveDraft.
  }
}

// isDraftContentEmpty reports whether there is nothing worth restoring or
// saving: no name, no exercises, and no athletes selected. Used both to skip
// autosaving an untouched builder and to skip "restore" on an empty stored
// draft.
export function isDraftContentEmpty(content: Pick<WorkoutBuilderDraftContent, "name" | "exercises" | "selectedAthleteIds">): boolean {
  return content.name.trim() === "" && content.exercises.length === 0 && content.selectedAthleteIds.length === 0;
}
