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
// the assignment context (which athlete's calendar the draft was started
// from, plus any additional athletes the Coach explicitly added), and the
// scheduled date — nothing server-unsafe. We never persist the Firebase ID
// token, credentials, or any server-generated id that isn't already a stable
// Exercise id the builder requires anyway (exercise.id is looked up/created
// independently of this draft, same as a normal Add Exercise).
//
// ASSIGNMENT CONTEXT — the draft is identified by (sourceAthleteId,
// scheduledDate): the athlete calendar and day the builder was opened from.
// Both are restored, because a builder that reopens on a different athlete
// than it was authored for is the same class of drift as one that reopens on
// a different date. sourceAthleteId is therefore an assignment target by
// construction, not a checkbox that can be lost — see assignmentTargets.
//
// extraAthleteIds (athletes the Coach deliberately added beyond the source)
// is stored for shape completeness but is deliberately NOT replayed on
// restore (see the restore effect in page.tsx): re-checking whoever was
// added in a prior session could arm Build & Assign against athletes the
// Coach never chose in *this* session. The source athlete carries no such
// risk — it is the calendar the Coach is looking at, shown in the builder
// header, and restoring it is what makes the draft resume where it was made.
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
  // The athlete whose calendar this draft was started from. "" only when the
  // Coach had no connected athletes, or when migrating a v1 draft that
  // predates this field.
  sourceAthleteId: string;
  // Additional athletes the Coach explicitly checked, never including
  // sourceAthleteId.
  extraAthleteIds: string[];
  scheduledDate: string;
  editTarget: DraftEditTarget | null;
};

export type WorkoutBuilderDraft = WorkoutBuilderDraftContent & {
  version: 2;
  savedAt: string;
};

const DRAFT_VERSION = 2 as const;

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
    typeof draft.sourceAthleteId === "string" &&
    Array.isArray(draft.extraAthleteIds) &&
    typeof draft.scheduledDate === "string"
  );
}

// A v1 draft carried one flat `selectedAthleteIds` list with no notion of
// which athlete's calendar the draft came from. Dropping such drafts would
// throw away a Coach's unsaved prescription, so they are migrated instead:
// the exercises/name/date are kept verbatim, and the assignment context
// resets to "unknown source, no extras" — page.tsx then derives the source
// from the calendar the draft reopens on, exactly as a v1 restore did.
function migrateV1(value: unknown): WorkoutBuilderDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  if (
    draft.version !== 1 ||
    typeof draft.name !== "string" ||
    !Array.isArray(draft.exercises) ||
    typeof draft.scheduledDate !== "string"
  ) {
    return null;
  }
  return {
    version: DRAFT_VERSION,
    savedAt: typeof draft.savedAt === "string" ? draft.savedAt : new Date().toISOString(),
    name: draft.name,
    exercises: draft.exercises as DraftExercise[],
    sourceAthleteId: "",
    extraAthleteIds: [],
    scheduledDate: draft.scheduledDate,
    editTarget: (draft.editTarget ?? null) as DraftEditTarget | null,
  };
}

// assignmentTargets is the single source of truth for who a Build & Assign
// will schedule for: the source athlete first, then any deliberately added
// extras. Because the source is a parameter rather than an entry in a
// mutable list, it cannot be dropped by a state transition that forgot to
// re-seed it — which is exactly how a builder opened from an athlete's own
// calendar used to end up with nothing selected, or with a stale athlete
// left over from the previous one.
export function assignmentTargets(sourceAthleteId: string, extraAthleteIds: readonly string[]): string[] {
  const targets = sourceAthleteId === "" ? [] : [sourceAthleteId];
  for (const id of extraAthleteIds) {
    if (id !== "" && id !== sourceAthleteId && !targets.includes(id)) targets.push(id);
  }
  return targets;
}

// toggleExtraAthlete flips one athlete's membership in the *extras* list. The
// source athlete is not a member of that list and cannot be toggled: it is
// the calendar the builder was opened from, and the picker renders its
// checkbox checked and disabled to say so.
export function toggleExtraAthlete(sourceAthleteId: string, extraAthleteIds: readonly string[], athleteId: string): string[] {
  if (athleteId === sourceAthleteId) return [...extraAthleteIds];
  return extraAthleteIds.includes(athleteId)
    ? extraAthleteIds.filter((id) => id !== athleteId)
    : [...extraAthleteIds, athleteId];
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
    return isDraftShape(parsed) ? parsed : migrateV1(parsed);
  } catch {
    return null;
  }
}

// saveDraft immediately serializes and persists content, stamping the
// current time. Callers debounce their own autosave calls; this function
// itself never debounces so it also serves the explicit "Save Draft"
// action, which must write synchronously.
//
// Returns the ISO timestamp it stamped, or null if the write did not happen.
// Callers use the timestamp to show when the draft was last saved, and the
// null to tell the Coach their browser is refusing to store it — which was
// previously silent, leaving a Coach who believed their work was safe.
export function saveDraft(coachId: string, content: WorkoutBuilderDraftContent): string | null {
  if (typeof window === "undefined") return null;
  const savedAt = new Date().toISOString();
  const draft: WorkoutBuilderDraft = { ...content, version: DRAFT_VERSION, savedAt };
  try {
    window.localStorage.setItem(draftKey(coachId), JSON.stringify(draft));
    return savedAt;
  } catch {
    // localStorage can throw (quota exceeded, private browsing, disabled
    // storage). Draft persistence degrades to in-memory-only in that case;
    // it must never break the builder itself.
    return null;
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
// saving: no name and no exercises. Used both to skip autosaving an
// untouched builder and to skip "restore" on an empty stored draft.
//
// Athlete selection is deliberately NOT part of this test. Opening the
// builder always establishes a source athlete (the calendar it was opened
// from), so counting that as content made a builder that had only been
// opened look like a draft in progress: the button relabelled itself
// "Resume draft", and every "is there a live draft?" guard downstream
// started protecting an empty builder — including the one that stops a new
// athlete's calendar from re-targeting the assignment.
export function isDraftContentEmpty(content: Pick<WorkoutBuilderDraftContent, "name" | "exercises">): boolean {
  return content.name.trim() === "" && content.exercises.length === 0;
}
