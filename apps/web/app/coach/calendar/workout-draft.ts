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
// extraAthleteIds are athletes the Coach deliberately added beyond the
// source. On restore they are replayed only when still connected, deduped,
// and never including the source. A disconnected source drops the whole
// draft rather than silently rebinding it to whoever the Calendar loaded.
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
  // The athlete whose calendar this draft was started from.
  sourceAthleteId: string;
  // Resume: extras beyond the locked source, never including sourceAthleteId.
  // New: the exact Assign-to checkbox set (may omit the calendar athlete).
  extraAthleteIds: string[];
  // Omitted on drafts saved before sessionKind existed; those restore as resume.
  sessionKind: BuilderSessionKind;
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((item) => typeof item === "string") ? value : null;
}

// assignmentTargets is the single source of truth for who a Build & Assign
// will schedule for: the source athlete first, then any deliberately added
// extras. Because the source is a parameter rather than an entry in a
// mutable list, it cannot be dropped by a state transition that forgot to
// re-seed it.
export function assignmentTargets(sourceAthleteId: string, extraAthleteIds: readonly string[]): string[] {
  const targets = sourceAthleteId === "" ? [] : [sourceAthleteId];
  for (const id of extraAthleteIds) {
    if (id !== "" && id !== sourceAthleteId && !targets.includes(id)) targets.push(id);
  }
  return targets;
}

// toggleExtraAthlete flips one athlete's membership in the extras list. The
// source athlete is not a member of that list and cannot be toggled: it is
// the calendar the builder was opened from, and the picker renders its
// checkbox checked and disabled to say so.
export function toggleExtraAthlete(sourceAthleteId: string, extraAthleteIds: readonly string[], athleteId: string): string[] {
  if (athleteId === sourceAthleteId) return [...extraAthleteIds];
  return extraAthleteIds.includes(athleteId)
    ? extraAthleteIds.filter((id) => id !== athleteId)
    : [...extraAthleteIds, athleteId];
}

export type BuilderSessionKind = "new" | "resume";

export function parseSessionKind(value: unknown): BuilderSessionKind {
  return value === "new" ? "new" : "resume";
}

// + Add Workout is always New. A stored draft — even one for the same
// athlete and date — must never be continued by that button. Continue is a
// separate explicit action.
export type NewWorkoutClickKind = "start-new" | "confirm-replace";

export function resolveNewWorkoutClick(hasStoredDraft: boolean): NewWorkoutClickKind {
  return hasStoredDraft ? "confirm-replace" : "start-new";
}

export function continueDraftActionLabel(athleteName: string | undefined | null): string {
  const name = athleteName?.trim();
  return name ? `Continue ${name}` : "Continue draft";
}

export function startNewWorkoutActionLabel(athleteName: string | undefined | null): string {
  const name = athleteName?.trim();
  return name ? `Start new for ${name}` : "Start new";
}

// True when the stored draft's athlete and date match the viewed Calendar.
// Used only to describe context, never to silently continue from + Add Workout.
export function draftMatchesCalendar(
  sourceAthleteId: string,
  scheduledDate: string,
  calendarAthleteId: string,
  browsingDate: string,
): boolean {
  return sourceAthleteId !== "" && sourceAthleteId === calendarAthleteId && scheduledDate !== "" && scheduledDate === browsingDate;
}

// New Workout: Assign to is a freely mutable set. Calendar athlete is the
// default entry, not a lock. Continue Draft still uses toggleExtraAthlete.
export function toggleSelectedAthlete(selectedAthleteIds: readonly string[], athleteId: string): string[] {
  if (athleteId === "") return [...selectedAthleteIds];
  return selectedAthleteIds.includes(athleteId)
    ? selectedAthleteIds.filter((id) => id !== athleteId)
    : [...selectedAthleteIds, athleteId];
}

export function assignmentIdsForSession(
  kind: BuilderSessionKind,
  sourceAthleteId: string,
  selectedOrExtras: readonly string[],
): string[] {
  if (kind === "resume") return assignmentTargets(sourceAthleteId, selectedOrExtras);
  const ids: string[] = [];
  for (const id of selectedOrExtras) {
    if (id !== "" && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

// Persist Assign-to exactly as shown. Resume stores extras only (source is
// implied and locked). New stores the checkbox set, including when the
// calendar athlete is unchecked — Continue must not silently re-add them.
export function extrasForPersistence(
  kind: BuilderSessionKind,
  sourceAthleteId: string,
  selectedOrExtras: readonly string[],
): string[] {
  if (kind === "new") return assignmentIdsForSession("new", sourceAthleteId, selectedOrExtras);
  return selectedOrExtras.filter((id) => id !== "" && id !== sourceAthleteId);
}

export function sanitizeSelectedAthleteIds(
  selectedAthleteIds: readonly string[],
  connectedAthleteIds: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const id of selectedAthleteIds) {
    if (id === "" || !connectedAthleteIds.has(id) || ids.includes(id)) continue;
    ids.push(id);
  }
  return ids;
}

export function sanitizeExtraAthleteIds(
  sourceAthleteId: string,
  extraAthleteIds: readonly string[],
  connectedAthleteIds: ReadonlySet<string>,
): string[] {
  const extras: string[] = [];
  for (const id of extraAthleteIds) {
    if (id === "" || id === sourceAthleteId || !connectedAthleteIds.has(id) || extras.includes(id)) continue;
    extras.push(id);
  }
  return extras;
}

function draftContentFromUnknown(draft: Record<string, unknown>): Omit<WorkoutBuilderDraftContent, "sourceAthleteId" | "extraAthleteIds" | "sessionKind"> | null {
  if (typeof draft.name !== "string" || !Array.isArray(draft.exercises) || typeof draft.scheduledDate !== "string") {
    return null;
  }
  return {
    name: draft.name,
    exercises: draft.exercises as DraftExercise[],
    scheduledDate: draft.scheduledDate,
    editTarget: (draft.editTarget ?? null) as DraftEditTarget | null,
  };
}

// resolveStoredDraft parses a localStorage value into a v2 draft using the
// current connected-athlete set. Returns null (drop the draft) when the
// shape is wrong, the source cannot be identified, or the source is no
// longer connected. Never rebinds a sourceless draft to some other athlete.
export function resolveStoredDraft(value: unknown, connectedAthleteIds: readonly string[]): WorkoutBuilderDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Record<string, unknown>;
  const content = draftContentFromUnknown(draft);
  if (!content) return null;

  const connected = new Set(connectedAthleteIds);
  let sourceAthleteId = "";
  let extraAthleteIds: string[] = [];

  if (draft.version === DRAFT_VERSION) {
    if (typeof draft.sourceAthleteId !== "string") return null;
    const extras = asStringArray(draft.extraAthleteIds);
    if (extras === null) return null;
    sourceAthleteId = draft.sourceAthleteId;
    extraAthleteIds = extras;
  } else if (draft.version === 1) {
    // Conservative v1: selectedAthleteIds[0] is the only historical source
    // candidate. Later entries may have been extras and must not be promoted;
    // they are ignored even if the rest of the array is malformed.
    if (!Array.isArray(draft.selectedAthleteIds)) return null;
    const candidate = draft.selectedAthleteIds[0];
    if (!isNonEmptyString(candidate)) return null;
    sourceAthleteId = candidate;
    extraAthleteIds = [];
  } else {
    return null;
  }

  if (!connected.has(sourceAthleteId)) return null;

  const sessionKind = parseSessionKind(draft.sessionKind);
  const extras = sessionKind === "new"
    ? sanitizeSelectedAthleteIds(extraAthleteIds, connected)
    : sanitizeExtraAthleteIds(sourceAthleteId, extraAthleteIds, connected);

  return {
    version: DRAFT_VERSION,
    savedAt: typeof draft.savedAt === "string" ? draft.savedAt : new Date().toISOString(),
    ...content,
    sourceAthleteId,
    extraAthleteIds: extras,
    sessionKind,
  };
}

// loadDraft reads and parses the Coach-scoped draft, if any. Returns null on
// a missing draft, a shape mismatch, a disconnected source, or any
// storage/parse error — draft restoration is a UX nicety, never a hard
// requirement, so callers should treat null as "start fresh."
export function loadDraft(coachId: string, connectedAthleteIds: readonly string[]): WorkoutBuilderDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(draftKey(coachId));
    if (!raw) return null;
    return resolveStoredDraft(JSON.parse(raw), connectedAthleteIds);
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
// "Continue draft", and every "is there a live draft?" guard downstream
// started protecting an empty builder — including the one that stops a new
// athlete's calendar from re-targeting the assignment.
export function isDraftContentEmpty(content: Pick<WorkoutBuilderDraftContent, "name" | "exercises">): boolean {
  return content.name.trim() === "" && content.exercises.length === 0;
}
