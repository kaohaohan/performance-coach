"use client";

import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import {
  clearDraft,
  isDraftContentEmpty,
  loadDraft,
  saveDraft,
  type DraftEditTarget,
  type DraftExercise,
  type DraftSetOverride,
  type Exercise,
  type PlannedUnit,
  type PrescriptionMode,
} from "./workout-draft";

type Athlete = { id: string; name: string };
type Workout = { id: string; name: string };
type ProgrammingMode = "EXISTING" | "BUILD";
type BuildStatus = "idle" | "creating" | "assigning" | "assignmentFailed" | "savingWorkout" | "savingChanges";
// ScheduledWorkoutDetail is the wire shape of GET/PUT /api/v1/scheduled-workouts/{id}
// (docs/go-backend-api-contract-v0.1.md §3.5) — used only to prefill and save
// the Coach Calendar's Edit Assigned Workout flow (Problem B).
type ScheduledWorkoutPlannedSetDTO = {
  scheduledWorkoutPlannedSetId: string;
  position: number;
  reps?: number;
  prescriptionNote?: string;
  load?: number;
  unit?: PlannedUnit;
  rpe?: number;
};
type ScheduledWorkoutExerciseDTO = {
  scheduledWorkoutExerciseId: string;
  exerciseId: string;
  name: string;
  plan: { sets: ScheduledWorkoutPlannedSetDTO[] };
  position: number;
};
type ScheduledWorkoutDetail = {
  id: string;
  scheduledDate: string;
  athlete: Athlete;
  workout: Workout;
  session: Session | null;
  exercises: ScheduledWorkoutExerciseDTO[];
};
type BuildFieldErrors = {
  date?: string;
  athletes?: string;
  exercises?: string;
  items: Record<number, Partial<Record<"sets" | "reps" | "note" | "load" | "rpe" | "overrides", string>>>;
};
type PendingAssignment = Readonly<{
  workoutId: string;
  athleteIds: readonly string[];
  scheduledDate: string;
}>;
type Session = { id: string; status: "ACTIVE" | "COMPLETED" };
type ScheduledWorkoutSummary = {
  id: string;
  scheduledDate: string;
  athlete: Athlete;
  workout: Workout;
  session: Session | null;
};

const initialBuildErrors = (): BuildFieldErrors => ({ items: {} });

function compactOverride(override: DraftSetOverride): DraftSetOverride | null {
  const next: DraftSetOverride = { position: override.position };
  if (override.prescriptionMode !== undefined) next.prescriptionMode = override.prescriptionMode;
  if (override.reps !== undefined && override.reps !== "") next.reps = override.reps;
  if (override.prescriptionNote !== undefined && override.prescriptionNote.trim() !== "") next.prescriptionNote = override.prescriptionNote;
  if (override.load !== undefined && override.load.trim() !== "") next.load = override.load;
  if (override.rpe !== undefined && override.rpe.trim() !== "") next.rpe = override.rpe;
  return Object.keys(next).length === 1 ? null : next;
}

function updateDraftOverride(overrides: DraftSetOverride[], position: number, update: Partial<DraftSetOverride>): DraftSetOverride[] {
  const existing = overrides.find((override) => override.position === position) ?? { position };
  const next = compactOverride({ ...existing, ...update, position });
  return next === null
    ? overrides.filter((override) => override.position !== position)
    : [...overrides.filter((override) => override.position !== position), next].sort((left, right) => left.position - right.position);
}

function clearDraftOverrideProperty(overrides: DraftSetOverride[], position: number, property: "prescription" | "load" | "rpe"): DraftSetOverride[] {
  if (property === "prescription") return updateDraftOverride(overrides, position, { prescriptionMode: undefined, reps: undefined, prescriptionNote: undefined });
  return updateDraftOverride(overrides, position, { [property]: undefined });
}

function resolveEffectivePrescription(item: DraftExercise, position: number): { reps?: string; prescriptionNote?: string } {
  const override = item.overrides.find((candidate) => candidate.position === position);
  const defaultReps = item.prescriptionMode === "REPS" ? item.defaultReps : undefined;
  const defaultPrescriptionNote = item.prescriptionMode === "TEXT" ? item.defaultPrescriptionNote : undefined;

  if (override?.prescriptionMode === "REPS") return { reps: override.reps ?? "" };
  if (override?.prescriptionMode === "TEXT") return { prescriptionNote: override.prescriptionNote ?? "" };

  return {
    reps: override?.reps ?? defaultReps,
    prescriptionNote: override?.prescriptionNote ?? defaultPrescriptionNote,
  };
}

function fallbackWorkoutName(date: string): string {
  return `${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00`))} Workout`;
}

// buildExercisesPayload maps builder authoring state to the wire shape both
// POST /workouts, PUT /scheduled-workouts/{id}, and (via POST /workouts)
// Build & Assign accept — the same defaults+overrides shape prescription.Resolve
// validates server-side. Pure/module-level: shared by Save Draft's siblings
// (Save Workout, Build & Assign, Save Changes) rather than duplicated per handler.
function buildExercisesPayload(items: DraftExercise[]) {
  return items.map((item) => ({
    name: item.exercise.name,
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

// snapshotExerciseToDraft reconstructs a builder-editable DraftExercise from
// a frozen, fully-resolved ScheduledWorkout snapshot exercise — the reverse
// of buildExercisesPayload's resolve-on-submit direction. The frozen
// snapshot has no defaults/overrides split (only per-position resolved
// values), so this treats position 1 as the default and any later position
// that differs as a sparse override, same shape the builder already edits.
// A plan originally authored with an override on position 1 itself won't
// round-trip byte-for-byte, but the resolved values it prefills are always
// exactly what is currently scheduled.
function snapshotExerciseToDraft(ex: ScheduledWorkoutExerciseDTO): DraftExercise {
  const sets = [...ex.plan.sets].sort((left, right) => left.position - right.position);
  const base = sets[0];
  const baseMode: PrescriptionMode = base?.reps !== undefined ? "REPS" : "TEXT";

  const overrides: DraftSetOverride[] = [];
  for (const set of sets.slice(1)) {
    const setMode: PrescriptionMode = set.reps !== undefined ? "REPS" : "TEXT";
    const prescriptionDiffers = setMode !== baseMode || (setMode === "REPS" ? set.reps !== base?.reps : set.prescriptionNote !== base?.prescriptionNote);
    const loadDiffers = (set.load ?? null) !== (base?.load ?? null);
    const rpeDiffers = (set.rpe ?? null) !== (base?.rpe ?? null);
    if (!prescriptionDiffers && !loadDiffers && !rpeDiffers) continue;

    const override: DraftSetOverride = { position: set.position };
    if (prescriptionDiffers) {
      override.prescriptionMode = setMode;
      if (setMode === "REPS") override.reps = set.reps !== undefined ? String(set.reps) : "";
      else override.prescriptionNote = set.prescriptionNote ?? "";
    }
    if (loadDiffers) override.load = set.load !== undefined && set.load !== null ? String(set.load) : "";
    if (rpeDiffers) override.rpe = set.rpe !== undefined && set.rpe !== null ? String(set.rpe) : "";
    overrides.push(override);
  }

  return {
    // Scope is cosmetic only (badge color) and not carried by the snapshot;
    // submission identifies the exercise by name, the same as a fresh Add
    // Exercise. Defaulting to SYSTEM keeps the badge neutral.
    exercise: { id: ex.exerciseId, name: ex.name, scope: "SYSTEM" },
    setCount: String(sets.length),
    prescriptionMode: baseMode,
    defaultReps: baseMode === "REPS" && base?.reps !== undefined ? String(base.reps) : "",
    defaultPrescriptionNote: baseMode === "TEXT" ? (base?.prescriptionNote ?? "") : "",
    defaultLoad: base?.load !== undefined && base?.load !== null ? String(base.load) : "",
    unit: base?.unit ?? "kg",
    defaultRpe: base?.rpe !== undefined && base?.rpe !== null ? String(base.rpe) : "",
    overrides,
    customizationOpen: false,
    editingPositions: [],
  };
}

function todayLocalISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(date: string): string {
  if (!isValidISODate(date)) return "Choose a date";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
}

function monthBounds(date: string): { start: string; end: string } {
  const [year, month] = date.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return {
    start: `${year}-${String(month).padStart(2, "0")}-01`,
    end: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}

function shiftMonth(date: string, amount: -1 | 1): string {
  const [year, month, day] = date.split("-").map(Number);
  const nextMonth = new Date(year, month - 1 + amount, 1);
  const nextDay = Math.min(day, new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate());
  return `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`;
}

function monthLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(`${date.slice(0, 7)}-01T00:00:00`));
}

function monthDays(date: string): Array<string | null> {
  const [year, month] = date.split("-").map(Number);
  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const dayCount = new Date(year, month, 0).getDate();
  return [
    ...Array.from<null>({ length: firstWeekday }).fill(null),
    ...Array.from({ length: dayCount }, (_, index) => `${year}-${String(month).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`),
  ];
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function statusLabel(session: Session | null): string {
  return session?.status ?? "NOT STARTED";
}

function statusClass(session: Session | null): string {
  if (session?.status === "ACTIVE") return "bg-teal-50 text-teal-700 ring-teal-600/20";
  if (session?.status === "COMPLETED") return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  return "bg-slate-100 text-slate-600 ring-slate-500/10";
}

function isValidISODate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

export default function CoachCalendarPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const [date, setDate] = useState(todayLocalISODate);
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [assignments, setAssignments] = useState<ScheduledWorkoutSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const athleteLoadId = useRef(0);
  const assignmentLoadId = useRef(0);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const assignmentInFlight = useRef(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState(false);
  const [programmingMode, setProgrammingMode] = useState<ProgrammingMode>("EXISTING");
  const [draftName, setDraftName] = useState("");
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  const [buildFieldErrors, setBuildFieldErrors] = useState<BuildFieldErrors>(initialBuildErrors);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<BuildStatus>("idle");
  const [pendingAssignment, setPendingAssignment] = useState<PendingAssignment | null>(null);
  const buildInFlight = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerExercises, setPickerExercises] = useState<Exercise[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerRequestId = useRef(0);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [calendarAthleteId, setCalendarAthleteId] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  // Problem A — browser-local Build Workout draft persistence. coachId
  // scopes the localStorage key so multiple Coach accounts in the same
  // browser never share a draft; the Firebase UID is already available from
  // useAuth() without an extra /api/v1/me round trip.
  const coachId = user?.uid ?? null;
  const draftLoadedRef = useRef(false);
  const draftSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [draftRestoredNotice, setDraftRestoredNotice] = useState(false);
  const [workoutSavedNotice, setWorkoutSavedNotice] = useState(false);

  // Problem B — editing one NOT_STARTED ScheduledWorkout in place. Non-null
  // while the builder below is prefilled from (and will PUT back to) one
  // specific assignment, instead of authoring/assigning a new one.
  const [editTarget, setEditTarget] = useState<DraftEditTarget | null>(null);
  const [editLoadingId, setEditLoadingId] = useState<string | null>(null);
  const [editLoadError, setEditLoadError] = useState<string | null>(null);
  const [saveChangesSuccess, setSaveChangesSuccess] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    const requestId = ++athleteLoadId.current;
    let cancelled = false;
    (async () => {
      setLoadError(null);
      try {
        const [athletesRes, workoutsRes] = await Promise.all([
          apiFetch<Athlete[]>(idToken, "/api/v1/athletes"),
          apiFetch<Workout[]>(idToken, "/api/v1/workouts"),
        ]);
        if (!cancelled && requestId === athleteLoadId.current) {
          setAthletes(athletesRes);
          setWorkouts(workoutsRes);
          setCalendarAthleteId((current) => current || athletesRes[0]?.id || "");
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled && requestId === athleteLoadId.current) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  useEffect(() => {
    if (!idToken) return;
    const requestId = ++assignmentLoadId.current;
    let cancelled = false;
    const bounds = monthBounds(date);
    (async () => {
      setLoadError(null);
      try {
        const res = await apiFetch<ScheduledWorkoutSummary[]>(
          idToken,
          `/api/v1/scheduled-workouts?from=${bounds.start}&to=${bounds.end}`,
        );
        if (!cancelled && requestId === assignmentLoadId.current) {
          setAssignments(res);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled && requestId === assignmentLoadId.current) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, date]);

  useEffect(() => {
    if (!idToken || programmingMode !== "BUILD" || !pickerOpen) return;
    const requestId = ++pickerRequestId.current;
    const trimmedQuery = pickerQuery.trim();
    const endpoint = trimmedQuery === "" ? "/api/v1/exercises" : `/api/v1/exercises?q=${encodeURIComponent(pickerQuery)}`;
    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      (async () => {
        if (!cancelled && requestId === pickerRequestId.current) {
          setPickerLoading(true);
          setPickerError(null);
        }
        try {
          const result = await apiFetch<Exercise[]>(idToken, endpoint);
          if (!cancelled && requestId === pickerRequestId.current) {
            setPickerExercises(result);
            setPickerError(null);
          }
        } catch (err) {
          if (!cancelled && requestId === pickerRequestId.current) setPickerError(errorMessage(err));
        } finally {
          if (!cancelled && requestId === pickerRequestId.current) setPickerLoading(false);
        }
      })();
    }, trimmedQuery === "" ? 0 : 275);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [idToken, pickerOpen, pickerQuery, programmingMode]);

  // Restore a saved draft exactly once per Coach session, the first time a
  // coachId is available. Reopens the builder in Build mode (including a
  // resumed Edit Assigned Workout target, if the draft has one) so the
  // Coach sees restored state immediately rather than a blank calendar.
  //
  // Waits for the athlete list (and its default calendarAthleteId, set by
  // the fetch effect above) to resolve first: the athlete *selection* below
  // is always derived fresh from the current calendarAthleteId, never
  // replayed verbatim from storage, so a real current value must be ready
  // to derive it from.
  useEffect(() => {
    if (!coachId || draftLoadedRef.current || athletes === null) return;
    draftLoadedRef.current = true;
    const draft = loadDraft(coachId);
    if (!draft || isDraftContentEmpty(draft)) return;

    // Deferred (not called synchronously in the effect body) per
    // react-hooks/set-state-in-effect.
    Promise.resolve().then(() => {
      setDraftName(draft.name);
      setDraftExercises(draft.exercises);
      if (isValidISODate(draft.scheduledDate)) setDate(draft.scheduledDate);
      if (draft.editTarget) {
        // Resuming an Edit Assigned Workout target: the athlete picker is
        // hidden and Save Changes never reads selectedAthleteIds — the
        // athlete is fixed by the scheduled workout being edited, so
        // restoring it here is inert, not a new assignment decision.
        setSelectedAthleteIds([draft.editTarget.athleteId]);
        setCalendarAthleteId(draft.editTarget.athleteId);
      } else {
        // A fresh new-workout draft's athlete selection is NEVER replayed
        // verbatim: silently re-checking whoever was selected in a prior,
        // unrelated session would re-arm Build & Assign against them
        // without the Coach choosing that just now. Default to only the
        // current calendar athlete instead — identical to a brand-new
        // "+ Add Workout" click — so assigning to anyone else requires a
        // deliberate re-selection.
        setSelectedAthleteIds(calendarAthleteId ? [calendarAthleteId] : []);
      }
      setEditTarget(draft.editTarget);
      setProgrammingMode("BUILD");
      setEditorOpen(true);
      setDraftRestoredNotice(true);
    });
  }, [coachId, athletes, calendarAthleteId]);

  // Autosave: debounce briefly, then serialize the current builder state to
  // localStorage. Only while actively authoring/editing in Build mode —
  // Existing Workout mode has no builder state worth persisting. Skipped
  // until the restore effect above has run once, so restoring a draft can
  // never race writing it right back out with a stale empty value.
  useEffect(() => {
    if (!coachId || !draftLoadedRef.current || programmingMode !== "BUILD") return;
    if (isDraftContentEmpty({ name: draftName, exercises: draftExercises, selectedAthleteIds })) return;

    // Deferred (not called synchronously in the effect body) per
    // react-hooks/set-state-in-effect.
    Promise.resolve().then(() => setDraftStatus("saving"));
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = setTimeout(() => {
      saveDraft(coachId, { name: draftName, exercises: draftExercises, selectedAthleteIds, scheduledDate: date, editTarget });
      setDraftStatus("saved");
    }, 600);
    return () => {
      if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    };
  }, [coachId, programmingMode, draftName, draftExercises, selectedAthleteIds, date, editTarget]);

  // Auto-dismiss the restored/saved notices after a few seconds — they
  // confirm an action just happened, not an ongoing state, so they
  // shouldn't linger indefinitely.
  useEffect(() => {
    if (!draftRestoredNotice) return;
    const timeoutId = window.setTimeout(() => setDraftRestoredNotice(false), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [draftRestoredNotice]);

  useEffect(() => {
    if (!workoutSavedNotice) return;
    const timeoutId = window.setTimeout(() => setWorkoutSavedNotice(false), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [workoutSavedNotice]);

  useEffect(() => {
    if (!saveChangesSuccess) return;
    const timeoutId = window.setTimeout(() => setSaveChangesSuccess(false), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [saveChangesSuccess]);

  function handleSaveDraft() {
    if (!coachId) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    saveDraft(coachId, { name: draftName, exercises: draftExercises, selectedAthleteIds, scheduledDate: date, editTarget });
    setDraftStatus("saved");
    setDraftRestoredNotice(false);
  }

  function handleDiscardDraft() {
    if (!coachId) return;
    if (!window.confirm("Discard this draft? Everything unsaved in the builder will be permanently deleted.")) return;
    if (draftSaveTimer.current) clearTimeout(draftSaveTimer.current);
    clearDraft(coachId);
    resetBuilderDraft();
    setSelectedAthleteIds(calendarAthleteId ? [calendarAthleteId] : []);
    setDraftStatus("idle");
    setDraftRestoredNotice(false);
  }

  async function refetchAssignments() {
    if (!idToken) return;
    const requestId = ++assignmentLoadId.current;
    setLoadError(null);
    try {
      const bounds = monthBounds(date);
      const res = await apiFetch<ScheduledWorkoutSummary[]>(
        idToken,
        `/api/v1/scheduled-workouts?from=${bounds.start}&to=${bounds.end}`,
      );
      if (requestId === assignmentLoadId.current) {
        setAssignments(res);
        setLoadError(null);
      }
    } catch (err) {
      if (requestId === assignmentLoadId.current) setLoadError(errorMessage(err));
    }
  }

  async function refetchWorkouts() {
    if (!idToken) return;
    setLoadError(null);
    try {
      const res = await apiFetch<Workout[]>(idToken, "/api/v1/workouts");
      setWorkouts(res);
      setLoadError(null);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }

  function resetBuilderDraft() {
    setDraftName("");
    setDraftExercises([]);
    setBuildFieldErrors(initialBuildErrors());
    setBuildError(null);
    setPickerOpen(false);
    setPickerQuery("");
    setPickerExercises(null);
    setPickerError(null);
    setEditTarget(null);
    setEditLoadError(null);
    setDraftStatus("idle");
    setDraftRestoredNotice(false);
    setWorkoutSavedNotice(false);
  }

  function changeProgrammingMode(mode: ProgrammingMode) {
    if (assignmentInFlight.current || buildStatus !== "idle") return;
    setProgrammingMode(mode);
    setAssignError(null);
    setAssignSuccess(false);
    setBuildError(null);
    if (mode === "BUILD") setBuildFieldErrors(initialBuildErrors());
    setPickerOpen(false);
  }

  function addExercise(exercise: Exercise) {
    if (buildStatus !== "idle" || draftExercises.some((item) => item.exercise.id === exercise.id)) return;
    setDraftExercises((previous) => [...previous, {
      exercise,
      setCount: "",
      prescriptionMode: "REPS",
      defaultReps: "",
      defaultPrescriptionNote: "",
      defaultLoad: "",
      unit: "kg",
      defaultRpe: "",
      overrides: [],
      customizationOpen: false,
      editingPositions: [],
    }]);
    setBuildFieldErrors((previous) => ({ ...previous, exercises: undefined }));
    setPickerOpen(false);
    setPickerQuery("");
    setPickerExercises(null);
  }

  function updateExercise(index: number, update: Partial<DraftExercise>) {
    if (buildStatus !== "idle") return;
    setDraftExercises((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
    setBuildFieldErrors((previous) => ({ ...previous, items: { ...previous.items, [index]: {} } }));
  }

  function updateSetCount(index: number, value: string) {
    if (buildStatus !== "idle") return;
    const nextCount = Number(value);
    const item = draftExercises[index];
    if (Number.isInteger(nextCount) && nextCount > 0 && item.overrides.some((override) => override.position > nextCount)) {
      setBuildFieldErrors((previous) => ({
        ...previous,
        items: {
          ...previous.items,
          [index]: { ...previous.items[index], sets: "Remove overrides above the new set count before reducing sets." },
        },
      }));
      return;
    }
    updateExercise(index, { setCount: value, editingPositions: item.editingPositions.filter((position) => position <= nextCount) });
  }

  function removeExercise(index: number) {
    if (buildStatus !== "idle") return;
    setDraftExercises((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
    setBuildFieldErrors(initialBuildErrors());
  }

  function moveExercise(index: number, direction: -1 | 1) {
    if (buildStatus !== "idle") return;
    setDraftExercises((previous) => {
      const destination = index + direction;
      if (destination < 0 || destination >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  // validateExercisesDraft checks only the exercise/prescription authoring
  // state — no date, no athletes. Save Workout and Save Changes both submit
  // a prescription with no notion of a scheduled date or assignee, so they
  // validate against this directly; Build & Assign additionally requires a
  // date and at least one athlete (see validateBuildDraft below).
  function validateExercisesDraft(): BuildFieldErrors {
    const errors = initialBuildErrors();
    if (draftExercises.length === 0) errors.exercises = "Add at least one exercise.";
    draftExercises.forEach((item, index) => {
      const itemErrors: BuildFieldErrors["items"][number] = {};
      if (!/^\d+$/.test(item.setCount) || Number(item.setCount) < 1) itemErrors.sets = "Enter a whole number of at least 1.";
      if (item.prescriptionMode === "REPS" && (!/^\d+$/.test(item.defaultReps) || Number(item.defaultReps) < 1)) itemErrors.reps = "Enter a whole number of at least 1.";
      if (item.prescriptionMode === "TEXT" && item.defaultPrescriptionNote.trim() === "") itemErrors.note = "Instruction is required.";
      if (item.defaultLoad.trim() !== "" && (!Number.isFinite(Number(item.defaultLoad)) || Number(item.defaultLoad) < 0)) itemErrors.load = "Load must be 0 or greater.";
      if (item.defaultRpe.trim() !== "" && (!Number.isFinite(Number(item.defaultRpe)) || Number(item.defaultRpe) < 1 || Number(item.defaultRpe) > 10)) itemErrors.rpe = "RPE must be between 1 and 10.";
      item.overrides.forEach((override) => {
        if (override.position < 1 || override.position > Number(item.setCount)) itemErrors.overrides = "Each individual override must be within the set count.";
        if (override.load !== undefined && (!Number.isFinite(Number(override.load)) || Number(override.load) < 0)) itemErrors.overrides = "Individual load must be 0 or greater.";
        if (override.rpe !== undefined && (!Number.isFinite(Number(override.rpe)) || Number(override.rpe) < 1 || Number(override.rpe) > 10)) itemErrors.overrides = "Individual RPE must be between 1 and 10.";
      });
      const setCount = /^\d+$/.test(item.setCount) ? Number(item.setCount) : 0;
      for (let position = 1; position <= setCount; position += 1) {
        const effective = resolveEffectivePrescription(item, position);
        const hasReps = effective.reps !== undefined && effective.reps.trim() !== "";
        const hasText = effective.prescriptionNote !== undefined && effective.prescriptionNote.trim() !== "";
        if (hasReps && hasText) {
          itemErrors.overrides = "Each individual set needs either reps or text, not both.";
        } else if (!hasReps && !hasText) {
          itemErrors.overrides = "Each individual set needs either reps or text.";
        } else if (hasReps && (!/^\d+$/.test(effective.reps!) || Number(effective.reps) < 1)) {
          itemErrors.overrides = "Individual reps must be a whole number of at least 1.";
        } else if (hasText && effective.prescriptionNote!.trim() === "") {
          itemErrors.overrides = "Individual text instruction is required.";
        }
      }
      if (Object.keys(itemErrors).length > 0) errors.items[index] = itemErrors;
    });
    return errors;
  }

  function validateBuildDraft(): BuildFieldErrors {
    const errors = validateExercisesDraft();
    if (!isValidISODate(date)) errors.date = "Choose a valid date.";
    if (selectedAthleteIds.length === 0) errors.athletes = "Select at least one athlete.";
    return errors;
  }

  async function schedulePendingBuild(payload: PendingAssignment) {
    if (!idToken) return;
    await apiFetch(idToken, "/api/v1/scheduled-workouts", {
      method: "POST",
      body: {
        workoutId: payload.workoutId,
        athleteIds: payload.athleteIds,
        scheduledDate: payload.scheduledDate,
      },
    });
  }

  async function completeBuildAssignment() {
    setPendingAssignment(null);
    if (coachId) clearDraft(coachId);
    resetBuilderDraft();
    setSelectedAthleteIds(calendarAthleteId ? [calendarAthleteId] : []);
    setProgrammingMode("EXISTING");
    setEditorOpen(false);
    setAssignSuccess(true);
    await Promise.all([refetchAssignments(), refetchWorkouts()]);
    setBuildStatus("idle");
  }

  async function handleBuildAndAssign(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!idToken || assignmentInFlight.current || buildInFlight.current || buildStatus !== "idle" || pendingAssignment) return;

    const errors = validateBuildDraft();
    setBuildFieldErrors(errors);
    setBuildError(null);
    setAssignError(null);
    setAssignSuccess(false);
    if (errors.date || errors.athletes || errors.exercises || Object.keys(errors.items).length > 0) return;

    buildInFlight.current = true;
    setBuildStatus("creating");
    try {
      let createdWorkout: Workout;
      try {
        createdWorkout = await apiFetch<Workout>(idToken, "/api/v1/workouts", {
          method: "POST",
          body: {
            name: draftName.trim() || fallbackWorkoutName(date),
            exercises: buildExercisesPayload(draftExercises),
          },
        });
      } catch (err) {
        setBuildError(errorMessage(err));
        setBuildStatus("idle");
        return;
      }

      const payload: PendingAssignment = Object.freeze({
        workoutId: createdWorkout.id,
        athleteIds: Object.freeze([...selectedAthleteIds]),
        scheduledDate: date,
      });
      setPendingAssignment(payload);
      setBuildStatus("assigning");

      try {
        await schedulePendingBuild(payload);
      } catch (err) {
        setBuildError(errorMessage(err));
        setBuildStatus("assignmentFailed");
        return;
      }

      await completeBuildAssignment();
    } finally {
      buildInFlight.current = false;
    }
  }

  async function handleRetryAssignment() {
    if (!pendingAssignment || !idToken || buildInFlight.current || buildStatus !== "assignmentFailed") return;
    buildInFlight.current = true;
    setBuildStatus("assigning");
    setBuildError(null);
    try {
      await schedulePendingBuild(pendingAssignment);
      await completeBuildAssignment();
    } catch (err) {
      setBuildError(errorMessage(err));
      setBuildStatus("assignmentFailed");
    } finally {
      buildInFlight.current = false;
    }
  }

  function toggleAthlete(id: string) {
    if (assignmentInFlight.current || buildStatus !== "idle") return;
    setSelectedAthleteIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
    setBuildFieldErrors((previous) => ({ ...previous, athletes: undefined }));
  }

  async function handleAssign() {
    if (assignmentInFlight.current || buildInFlight.current || buildStatus !== "idle" || pendingAssignment || !idToken || !selectedWorkoutId || selectedAthleteIds.length === 0) return;
    assignmentInFlight.current = true;
    setAssigning(true);
    setAssignError(null);
    setAssignSuccess(false);
    try {
      await apiFetch(idToken, "/api/v1/scheduled-workouts", {
        method: "POST",
        body: { workoutId: selectedWorkoutId, athleteIds: selectedAthleteIds, scheduledDate: date },
      });
      setSelectedAthleteIds(calendarAthleteId ? [calendarAthleteId] : []);
      setAssignSuccess(true);
      setEditorOpen(false);
      await refetchAssignments();
    } catch (err) {
      setAssignError(errorMessage(err));
    } finally {
      assignmentInFlight.current = false;
      setAssigning(false);
    }
  }

  async function handleStart(scheduledWorkoutId: string) {
    if (!idToken || startingId) return;
    setStartingId(scheduledWorkoutId);
    setStartError(null);
    try {
      const session = await apiFetch<{ id: string; status: string }>(
        idToken,
        `/api/v1/scheduled-workouts/${scheduledWorkoutId}/session`,
        { method: "POST" },
      );
      router.push(`/session/${session.id}`);
    } catch (err) {
      setStartError(errorMessage(err));
      setStartingId(null);
    }
  }

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  if (!user) return null;

  const selectedCount = selectedAthleteIds.length;
  const programmingControlsDisabled = assigning || buildStatus !== "idle";
  const calendarAthlete = athletes?.find((athlete) => athlete.id === calendarAthleteId) ?? null;
  const athleteAssignments = assignments?.filter((assignment) => assignment.athlete.id === calendarAthleteId) ?? null;
  const dayAssignments = athleteAssignments?.filter((assignment) => assignment.scheduledDate === date) ?? null;
  const scheduledDates = new Set(athleteAssignments?.map((assignment) => assignment.scheduledDate) ?? []);
  const days = monthDays(date);

  function selectCalendarAthlete(athleteId: string) {
    if (programmingControlsDisabled) return;
    setCalendarAthleteId(athleteId);
    setSelectedAthleteIds([athleteId]);
    setEditorOpen(false);
    setAssignError(null);
    setAssignSuccess(false);
    setBuildFieldErrors(initialBuildErrors());
  }

  function selectCalendarDate(nextDate: string) {
    if (programmingControlsDisabled) return;
    setDate(nextDate);
    setEditorOpen(false);
    setAssignError(null);
    setAssignSuccess(false);
    setBuildFieldErrors((previous) => ({ ...previous, date: undefined }));
  }

  function openWorkoutEditor() {
    if (!calendarAthleteId || programmingControlsDisabled) return;
    // "+ Add Workout" always starts a new assignment, never resumes a
    // stale Edit Assigned Workout target left over from a previous session.
    setEditTarget(null);
    setEditLoadError(null);
    setSelectedAthleteIds((previous) => previous.includes(calendarAthleteId) ? previous : [calendarAthleteId, ...previous]);
    setProgrammingMode("EXISTING");
    setEditorOpen(true);
    setAssignError(null);
    setAssignSuccess(false);
    setBuildFieldErrors(initialBuildErrors());
  }

  // openEditWorkout fetches the frozen snapshot for one NOT_STARTED
  // ScheduledWorkout and prefills the builder from it (§B4). If it became
  // ACTIVE/COMPLETED between the card rendering and this click, the fetch
  // still succeeds (GET has no editability gate) but returns a non-null
  // session — surfaced the same way a 409 from Save Changes would be,
  // without ever opening the builder over stale data.
  async function openEditWorkout(assignment: ScheduledWorkoutSummary) {
    if (!idToken || programmingControlsDisabled || editLoadingId) return;
    setEditLoadError(null);
    setEditLoadingId(assignment.id);
    try {
      const detail = await apiFetch<ScheduledWorkoutDetail>(idToken, `/api/v1/scheduled-workouts/${assignment.id}`);
      if (detail.session !== null) {
        setEditLoadError("This workout has already been started and can no longer be edited.");
        await refetchAssignments();
        return;
      }

      setDraftName("");
      setDraftExercises(detail.exercises.map(snapshotExerciseToDraft));
      setSelectedAthleteIds([detail.athlete.id]);
      setCalendarAthleteId(detail.athlete.id);
      setDate(detail.scheduledDate);
      setEditTarget({
        scheduledWorkoutId: detail.id,
        athleteId: detail.athlete.id,
        athleteName: detail.athlete.name,
        workoutName: detail.workout.name,
      });
      setProgrammingMode("BUILD");
      setEditorOpen(true);
      setBuildFieldErrors(initialBuildErrors());
      setBuildError(null);
      setAssignError(null);
      setAssignSuccess(false);
    } catch (err) {
      setEditLoadError(errorMessage(err));
    } finally {
      setEditLoadingId(null);
    }
  }

  async function handleSaveWorkout() {
    if (!idToken || buildInFlight.current || buildStatus !== "idle") return;
    const errors = validateExercisesDraft();
    setBuildFieldErrors(errors);
    setBuildError(null);
    if (errors.exercises || Object.keys(errors.items).length > 0) return;

    buildInFlight.current = true;
    setBuildStatus("savingWorkout");
    try {
      await apiFetch<Workout>(idToken, "/api/v1/workouts", {
        method: "POST",
        body: { name: draftName.trim() || fallbackWorkoutName(date), exercises: buildExercisesPayload(draftExercises) },
      });
      if (coachId) clearDraft(coachId);
      resetBuilderDraft();
      setProgrammingMode("EXISTING");
      setEditorOpen(false);
      setWorkoutSavedNotice(true);
      await refetchWorkouts();
    } catch (err) {
      setBuildError(errorMessage(err));
    } finally {
      buildInFlight.current = false;
      setBuildStatus("idle");
    }
  }

  async function handleSaveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!idToken || !editTarget || buildInFlight.current || buildStatus !== "idle") return;

    const errors = validateExercisesDraft();
    setBuildFieldErrors(errors);
    setBuildError(null);
    if (errors.exercises || Object.keys(errors.items).length > 0) return;

    buildInFlight.current = true;
    setBuildStatus("savingChanges");
    try {
      await apiFetch(idToken, `/api/v1/scheduled-workouts/${editTarget.scheduledWorkoutId}`, {
        method: "PUT",
        body: { exercises: buildExercisesPayload(draftExercises) },
      });
      if (coachId) clearDraft(coachId);
      resetBuilderDraft();
      setEditorOpen(false);
      setProgrammingMode("EXISTING");
      setSaveChangesSuccess(true);
      await refetchAssignments();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setBuildError("This workout has already been started and can no longer be edited.");
        await refetchAssignments();
      } else {
        setBuildError(errorMessage(err));
      }
    } finally {
      buildInFlight.current = false;
      setBuildStatus("idle");
    }
  }

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="border-b border-slate-800 bg-slate-950 px-4 py-3 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-teal-300">Performance Coach</p>
            <h1 className="truncate text-xl font-semibold tracking-tight">Athlete Calendar</h1>
          </div>
          <nav className="flex shrink-0 gap-1 text-xs font-semibold text-slate-300" aria-label="Coach tools">
            <button type="button" onClick={() => router.push("/coach/workouts")} disabled={programmingControlsDisabled} className="rounded-lg px-2 py-2 hover:bg-slate-800 disabled:opacity-50">Workouts</button>
            <button type="button" onClick={() => router.push("/coach/exercises")} disabled={programmingControlsDisabled} className="rounded-lg px-2 py-2 hover:bg-slate-800 disabled:opacity-50">Exercises</button>
            <button type="button" onClick={() => router.push("/coach/clients")} disabled={programmingControlsDisabled} className="rounded-lg px-2 py-2 hover:bg-slate-800 disabled:opacity-50">Clients</button>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-3 py-4 sm:px-5 lg:py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-950/5">
          {athletes === null ? <span className="text-sm font-semibold text-slate-500">Loading athletes…</span> : athletes.length === 0 ? <span className="text-sm font-semibold text-slate-500">No connected athletes</span> : (
            <label className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-teal-600 text-xs font-bold text-white">{calendarAthlete ? initials(calendarAthlete.name) : "—"}</span>
              <span className="sr-only">Athlete calendar</span>
              <select value={calendarAthleteId} onChange={(event) => selectCalendarAthlete(event.target.value)} disabled={programmingControlsDisabled} className="min-h-11 max-w-[13rem] rounded-xl border border-slate-200 bg-white px-3 text-base font-bold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:opacity-50">
                {athletes.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
              </select>
            </label>
          )}
          <button type="button" onClick={() => selectCalendarDate(todayLocalISODate())} disabled={programmingControlsDisabled} className="min-h-10 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Today</button>
        </div>

        {loadError && <div className="mb-4"><Notice tone="error">{loadError}</Notice></div>}

        <div className="grid overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <aside className="border-b border-slate-200 p-4 sm:p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-center justify-between gap-3">
              <button type="button" aria-label="Previous month" onClick={() => selectCalendarDate(shiftMonth(date, -1))} disabled={programmingControlsDisabled} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-xl font-bold hover:bg-slate-50 disabled:opacity-50">‹</button>
              <h2 className="text-center text-lg font-bold tracking-tight">{monthLabel(date)}</h2>
              <button type="button" aria-label="Next month" onClick={() => selectCalendarDate(shiftMonth(date, 1))} disabled={programmingControlsDisabled} className="grid h-11 w-11 place-items-center rounded-xl border border-slate-200 text-xl font-bold hover:bg-slate-50 disabled:opacity-50">›</button>
            </div>
            <div className="mt-4 grid grid-cols-7 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400" aria-hidden="true">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((weekday) => <span key={weekday}>{weekday.slice(0, 1)}</span>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-y-1" role="grid" aria-label={monthLabel(date)}>
              {days.map((day, index) => day === null ? <span key={`blank-${index}`} className="aspect-square" /> : (() => {
                const selected = day === date;
                const today = day === todayLocalISODate();
                const scheduled = scheduledDates.has(day);
                return <button key={day} type="button" role="gridcell" aria-selected={selected} aria-label={`${displayDate(day)}${scheduled ? ", scheduled training" : ""}`} onClick={() => selectCalendarDate(day)} disabled={programmingControlsDisabled} className={`relative mx-auto grid aspect-square w-full max-w-12 place-items-center rounded-xl text-sm font-semibold transition disabled:opacity-50 ${selected ? "bg-teal-600 text-white shadow-sm" : today ? "bg-teal-50 text-teal-800 ring-1 ring-inset ring-teal-300" : "text-slate-700 hover:bg-slate-100"}`}>
                  {Number(day.slice(-2))}
                  {scheduled && <span aria-hidden="true" className={`absolute bottom-1 h-1.5 w-1.5 rounded-full ${selected ? "bg-white" : "bg-teal-600"}`} />}
                </button>;
              })())}
            </div>
          </aside>

          <section className="min-w-0 p-4 sm:p-6 lg:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">{displayDate(date)}</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-tight">{calendarAthlete?.name ?? "Athlete calendar"}</h2>
                <p className="mt-1 text-sm text-slate-500">{dayAssignments?.length ?? 0} workout{dayAssignments?.length === 1 ? "" : "s"} scheduled</p>
              </div>
              {!editorOpen && <button type="button" onClick={openWorkoutEditor} disabled={!calendarAthleteId || programmingControlsDisabled} className="min-h-12 rounded-xl bg-teal-600 px-5 text-sm font-bold text-white shadow-sm hover:bg-teal-700 disabled:bg-slate-200 disabled:text-slate-500">+ Add Workout</button>}
            </div>

            {startError && <div className="mt-4"><Notice tone="error">{startError}</Notice></div>}
            {editLoadError && <div className="mt-4"><Notice tone="error">{editLoadError}</Notice></div>}
            {workoutSavedNotice && <div className="mt-4"><Notice tone="success">Workout saved to your library. It was not scheduled to any athlete.</Notice></div>}
            {saveChangesSuccess && <div className="mt-4"><Notice tone="success">Changes saved. The athlete will see the updated prescription immediately.</Notice></div>}
            <div className="mt-5">
              {assignments === null ? <LoadingCard label="Loading scheduled training…" /> : dayAssignments?.length === 0 ? <EmptyCard title="No workouts scheduled" body="Add a workout to this athlete’s selected day." /> : (
                <ul className="grid gap-3">
                  {dayAssignments?.map((assignment) => (
                    <li key={assignment.id} className="rounded-2xl border border-slate-200 bg-stone-50 p-4">
                      <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-500">{assignment.athlete.name}</p><p className="mt-1 text-lg font-bold">{assignment.workout.name}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${statusClass(assignment.session)}`}>{statusLabel(assignment.session)}</span></div>
                      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-200 pt-3">
                        {assignment.session === null && <button type="button" onClick={() => openEditWorkout(assignment)} disabled={programmingControlsDisabled || editLoadingId === assignment.id} className="min-h-10 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-100 disabled:opacity-50">{editLoadingId === assignment.id ? "Opening…" : "Edit"}</button>}
                        {assignment.session === null ? <button type="button" onClick={() => handleStart(assignment.id)} disabled={startingId === assignment.id} className="min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50">{startingId === assignment.id ? "Starting…" : "Start Session"}</button> : <button type="button" onClick={() => router.push(`/session/${assignment.session!.id}`)} className="min-h-10 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white">{assignment.session.status === "ACTIVE" ? "Resume" : "Review"}</button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {editorOpen && <div className="mt-6 rounded-2xl border border-slate-200 p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">{editTarget ? "Edit Workout" : "Add Workout"}</p><p className="mt-1 text-sm font-semibold text-slate-700">{editTarget ? `${editTarget.athleteName} · ${editTarget.workoutName}` : `${calendarAthlete?.name} · ${displayDate(date)}`}</p></div><button type="button" onClick={() => setEditorOpen(false)} disabled={programmingControlsDisabled} className="min-h-10 rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Close</button></div>

              {!editTarget && <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <ProgrammingModeButton active={programmingMode === "EXISTING"} onClick={() => changeProgrammingMode("EXISTING")} disabled={programmingControlsDisabled}>Existing Workout</ProgrammingModeButton>
                <ProgrammingModeButton active={programmingMode === "BUILD"} onClick={() => changeProgrammingMode("BUILD")} disabled={programmingControlsDisabled}>Build New Workout</ProgrammingModeButton>
              </div>}

              {editTarget ? <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-medium text-amber-900 ring-1 ring-amber-600/15">Editing <span className="font-bold">{editTarget.athleteName}</span>&apos;s assigned workout. This replaces only this one assignment — the reusable Workout template and any other athlete&apos;s copy of it are unaffected.</p> : <fieldset className="mt-4 rounded-xl bg-stone-50 p-3">
                <legend className="px-1 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">Assign to</legend>
                <div className="mt-1 flex flex-wrap gap-2">{athletes?.map((athlete) => { const selected = selectedAthleteIds.includes(athlete.id); return <label key={athlete.id} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-sm font-semibold ${selected ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600"}`}><input type="checkbox" checked={selected} onChange={() => toggleAthlete(athlete.id)} disabled={programmingControlsDisabled || athlete.id === calendarAthleteId} className="accent-teal-600" />{athlete.name}</label>; })}</div>
                {buildFieldErrors.athletes && <FieldError>{buildFieldErrors.athletes}</FieldError>}
              </fieldset>}

              <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workout</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
            </div>

            {programmingMode === "EXISTING" ? <div className="mt-4">
              {workouts === null ? <LoadingCard label="Loading workouts…" /> : workouts.length === 0 ? <EmptyCard title="No saved workouts yet" body="Choose Add Workout above to create and assign one here." /> : (
                <label className="block">
                  <span className="sr-only">Workout</span>
                  <select value={selectedWorkoutId} onChange={(event) => setSelectedWorkoutId(event.target.value)} disabled={programmingControlsDisabled} className="min-h-14 w-full rounded-2xl border border-slate-200 bg-stone-50 px-4 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100">
                    <option value="">Choose a workout…</option>
                    {workouts.map((workout) => <option key={workout.id} value={workout.id}>{workout.name}</option>)}
                  </select>
                </label>
              )}
              {assignError && <div className="mt-3"><Notice tone="error">{assignError}</Notice></div>}
              {assignSuccess && <div className="mt-3"><Notice tone="success">Workout assigned. Your coaching board is updated below.</Notice></div>}
              <button type="button" onClick={handleAssign} disabled={assigning || !selectedWorkoutId || selectedCount === 0} className="mt-4 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                {assigning ? "Assigning workout…" : `Assign to ${selectedCount || ""} athlete${selectedCount === 1 ? "" : "s"}`}
              </button>
            </div> : (
              <form onSubmit={editTarget ? handleSaveChanges : handleBuildAndAssign} className="mt-4 grid gap-4">
                {draftRestoredNotice && <Notice tone="success">{editTarget ? "Draft restored from your last session." : "Draft restored from your last session. Please re-check who this should be assigned to."}</Notice>}

                {!editTarget && <label className="block">
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Add Workout Name <span className="font-normal text-slate-500">optional</span></span>
                  <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Add Workout Name" disabled={programmingControlsDisabled} className="min-h-14 w-full rounded-2xl border border-slate-200 bg-stone-50 px-4 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100" />
                </label>}

                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-700">Training prescription</p>
                    {draftExercises.length > 0 && <span className="text-sm font-medium text-slate-500">{draftExercises.length} added</span>}
                  </div>
                  {buildFieldErrors.exercises && <FieldError>{buildFieldErrors.exercises}</FieldError>}
                  <div className="mt-3 grid gap-4">
                    {draftExercises.map((item, index) => <DraftExerciseCard key={item.exercise.id} item={item} index={index} total={draftExercises.length} errors={buildFieldErrors.items[index]} disabled={programmingControlsDisabled} onChange={(update) => updateExercise(index, update)} onSetCountChange={(value) => updateSetCount(index, value)} onMove={moveExercise} onRemove={removeExercise} />)}
                  </div>
                </div>

                <div>
                  {!pickerOpen ? <button type="button" onClick={() => { setPickerOpen(true); setPickerError(null); }} disabled={programmingControlsDisabled} className="min-h-14 w-full rounded-2xl border border-dashed border-teal-600 bg-teal-50 px-5 text-base font-bold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50">+ Add Exercise</button> : <ExercisePicker query={pickerQuery} exercises={pickerExercises} loading={pickerLoading} error={pickerError} selectedIds={new Set(draftExercises.map((item) => item.exercise.id))} disabled={programmingControlsDisabled} onQueryChange={setPickerQuery} onAdd={addExercise} onClose={() => setPickerOpen(false)} onOpenLibrary={() => router.push("/coach/exercises")} />}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-500" aria-live="polite">
                    {draftStatus === "saving" ? "Saving…" : draftStatus === "saved" ? "Draft saved" : " "}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleSaveDraft} disabled={programmingControlsDisabled} className="min-h-10 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Save Draft</button>
                    <button type="button" onClick={handleDiscardDraft} disabled={programmingControlsDisabled} className="min-h-10 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">Discard Draft</button>
                  </div>
                </div>

                {buildStatus === "assignmentFailed" && pendingAssignment ? <div className="grid gap-3">
                  <Notice tone="error"><span className="font-bold">Workout was created, but it was not assigned.</span>{buildError ? ` ${buildError}` : ""}</Notice>
                  <button type="button" onClick={handleRetryAssignment} className="min-h-14 w-full rounded-2xl bg-amber-500 px-5 text-base font-bold text-slate-950 shadow-sm transition hover:bg-amber-400">Retry Assignment</button>
                </div> : buildError ? <Notice tone="error">{buildError}</Notice> : null}

                {!editTarget && <button type="button" onClick={handleSaveWorkout} disabled={programmingControlsDisabled} className="min-h-14 w-full rounded-2xl border-2 border-teal-600 bg-white px-5 text-base font-bold text-teal-700 shadow-sm transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:border-slate-200 disabled:text-slate-400">
                  {buildStatus === "savingWorkout" ? "Saving workout…" : "Save Workout"}
                </button>}

                <button type="submit" disabled={programmingControlsDisabled} className="min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                  {editTarget
                    ? (buildStatus === "savingChanges" ? "Saving changes…" : "Save Changes")
                    : (buildStatus === "creating" ? "Creating workout…" : buildStatus === "assigning" ? "Assigning workout…" : "Build & Assign")}
                </button>
              </form>
            )}
              </div>
            </div>}
          </section>
        </div>
      </div>
    </main>
  );
}

function ProgrammingModeButton({ active, children, ...props }: { active: boolean; children: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" {...props} className={`min-h-12 rounded-xl border px-4 text-sm font-bold transition ${active ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-50`}>{active ? "● " : "○ "}{children}</button>;
}

function DraftExerciseCard({ item, index, total, errors, disabled, onChange, onSetCountChange, onMove, onRemove }: { item: DraftExercise; index: number; total: number; errors?: BuildFieldErrors["items"][number]; disabled: boolean; onChange: (update: Partial<DraftExercise>) => void; onSetCountChange: (value: string) => void; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void }) {
  const textMode = item.prescriptionMode === "TEXT";
  const setCount = /^\d+$/.test(item.setCount) ? Number(item.setCount) : 0;
  const effectivePrescription = (position: number) => {
    const effective = resolveEffectivePrescription(item, position);
    return effective.reps !== undefined
      ? { mode: "REPS" as const, value: effective.reps }
      : { mode: "TEXT" as const, value: effective.prescriptionNote ?? "" };
  };
  const effectiveValue = (position: number, property: "load" | "rpe") => item.overrides.find((candidate) => candidate.position === position)?.[property] ?? (property === "load" ? item.defaultLoad : item.defaultRpe);
  const updateOverride = (position: number, update: Partial<DraftSetOverride>) => onChange({ overrides: updateDraftOverride(item.overrides, position, update) });
  const clearOverride = (position: number, property: "prescription" | "load" | "rpe") => onChange({ overrides: clearDraftOverrideProperty(item.overrides, position, property) });
  const toggleSetEditor = (position: number) => onChange({ editingPositions: item.editingPositions.includes(position) ? [] : [position] });

  return <article className="rounded-2xl border border-slate-200 bg-white p-4">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Exercise {index + 1}</p><h3 className="mt-1 text-lg font-semibold tracking-tight">{item.exercise.name}</h3></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${item.exercise.scope === "SYSTEM" ? "bg-slate-100 text-slate-600" : "bg-teal-50 text-teal-700"}`}>{item.exercise.scope}</span></div>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Sets</span><input type="number" inputMode="numeric" min="1" step="1" value={item.setCount} onChange={(event) => onSetCountChange(event.target.value)} disabled={disabled} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.sets && <FieldError>{errors.sets}</FieldError>}</label>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Target RPE <span className="font-normal text-slate-500">optional</span></span><input type="number" inputMode="decimal" min="1" max="10" step="0.5" value={item.defaultRpe} onChange={(event) => onChange({ defaultRpe: event.target.value })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.rpe && <FieldError>{errors.rpe}</FieldError>}</label>
    </div>
    <fieldset className="mt-4"><legend className="text-sm font-semibold text-slate-700">Prescription</legend><div className="mt-2 flex flex-wrap gap-2"><PrescriptionModeButton active={!textMode} onClick={() => onChange({ prescriptionMode: "REPS" })} disabled={disabled}>Reps</PrescriptionModeButton><PrescriptionModeButton active={textMode} onClick={() => onChange({ prescriptionMode: "TEXT" })} disabled={disabled}>Text</PrescriptionModeButton></div></fieldset>
    {textMode ? <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Instruction</span><input value={item.defaultPrescriptionNote} onChange={(event) => onChange({ defaultPrescriptionNote: event.target.value })} disabled={disabled} placeholder="AMAP, 30 sec, 10–12" className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.note && <FieldError>{errors.note}</FieldError>}</label> : <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Reps</span><input type="number" inputMode="numeric" min="1" step="1" value={item.defaultReps} onChange={(event) => onChange({ defaultReps: event.target.value })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.reps && <FieldError>{errors.reps}</FieldError>}</label>}
    <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem]"><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Planned Load <span className="font-normal text-slate-500">optional</span></span><input type="number" inputMode="decimal" min="0" step="0.5" value={item.defaultLoad} onChange={(event) => onChange({ defaultLoad: event.target.value })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.load && <FieldError>{errors.load}</FieldError>}</label><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Unit</span><select value={item.unit} onChange={(event) => onChange({ unit: event.target.value as PlannedUnit })} disabled={disabled} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100"><option value="kg">kg</option><option value="lb">lb</option></select></label></div>
    <div className="mt-5 border-t border-slate-100 pt-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Planned sets</p>
      {setCount > 0 && <div className="mt-3 grid gap-2">{Array.from({ length: setCount }, (_, offset) => offset + 1).map((position) => {
        const prescription = effectivePrescription(position);
        const load = effectiveValue(position, "load");
        const rpe = effectiveValue(position, "rpe");
        const override = item.overrides.find((candidate) => candidate.position === position);
        const editing = item.editingPositions.includes(position);
        return <div key={position} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-800">Set {position}</p><p className="mt-0.5 text-sm text-slate-600">{prescription.mode === "REPS" ? `${prescription.value} reps` : prescription.value}{load !== "" && ` · ${load} ${item.unit}`}{rpe !== "" && ` · RPE ${rpe}`}</p></div><button type="button" onClick={() => toggleSetEditor(position)} disabled={disabled} className="min-h-10 rounded-lg px-3 text-sm font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50">{editing ? "Done" : "Edit"}</button></div>
          {editing && <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3"><fieldset><legend className="text-sm font-semibold text-slate-700">Prescription</legend><div className="mt-2 flex gap-2"><PrescriptionModeButton active={prescription.mode === "REPS"} onClick={() => updateOverride(position, { prescriptionMode: "REPS", reps: prescription.mode === "REPS" ? prescription.value : "", prescriptionNote: undefined })} disabled={disabled}>Reps</PrescriptionModeButton><PrescriptionModeButton active={prescription.mode === "TEXT"} onClick={() => updateOverride(position, { prescriptionMode: "TEXT", reps: undefined, prescriptionNote: prescription.mode === "TEXT" ? prescription.value : "" })} disabled={disabled}>Text</PrescriptionModeButton>{(override?.reps !== undefined || override?.prescriptionNote !== undefined || override?.prescriptionMode !== undefined) && <button type="button" onClick={() => clearOverride(position, "prescription")} disabled={disabled} className="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Use default</button>}</div></fieldset>
            {prescription.mode === "REPS" ? <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Reps</span><input type="number" inputMode="numeric" min="1" step="1" value={prescription.value} onChange={(event) => updateOverride(position, { prescriptionMode: "REPS", reps: event.target.value, prescriptionNote: undefined })} disabled={disabled} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label> : <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Instruction</span><input value={prescription.value} onChange={(event) => updateOverride(position, { prescriptionMode: "TEXT", reps: undefined, prescriptionNote: event.target.value })} disabled={disabled} placeholder="AMAP, 30 sec, 10–12" className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Load</span><input type="number" inputMode="decimal" min="0" step="0.5" value={load} onChange={(event) => updateOverride(position, { load: event.target.value })} disabled={disabled} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{override?.load !== undefined && <button type="button" onClick={() => clearOverride(position, "load")} disabled={disabled} className="mt-1 text-sm font-bold text-slate-600 hover:text-teal-700 disabled:opacity-50">Use default load</button>}</label><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">RPE</span><input type="number" inputMode="decimal" min="1" max="10" step="0.5" value={rpe} onChange={(event) => updateOverride(position, { rpe: event.target.value })} disabled={disabled} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{override?.rpe !== undefined && <button type="button" onClick={() => clearOverride(position, "rpe")} disabled={disabled} className="mt-1 text-sm font-bold text-slate-600 hover:text-teal-700 disabled:opacity-50">Use default RPE</button>}</label></div></div>}</div>;
      })}</div>}
      {errors?.overrides && <FieldError>{errors.overrides}</FieldError>}</div>
    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => onMove(index, -1)} disabled={disabled || index === 0} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Move Up</button><button type="button" onClick={() => onMove(index, 1)} disabled={disabled || index === total - 1} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Move Down</button><button type="button" onClick={() => onRemove(index)} disabled={disabled} className="min-h-11 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">Remove</button></div>
  </article>;
}

function PrescriptionModeButton({ active, children, ...props }: { active: boolean; children: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" {...props} className={`min-h-11 rounded-xl border px-4 text-sm font-bold transition ${active ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-50`}>{active ? "● " : "○ "}{children}</button>;
}

function ExercisePicker({ query, exercises, loading, error, selectedIds, disabled, onQueryChange, onAdd, onClose, onOpenLibrary }: { query: string; exercises: Exercise[] | null; loading: boolean; error: string | null; selectedIds: Set<string>; disabled: boolean; onQueryChange: (value: string) => void; onAdd: (exercise: Exercise) => void; onClose: () => void; onOpenLibrary: () => void }) {
  const system = exercises?.filter((exercise) => exercise.scope === "SYSTEM") ?? [];
  const privateExercises = exercises?.filter((exercise) => exercise.scope === "PRIVATE") ?? [];
  return <div className="rounded-2xl border border-slate-200 p-4"><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-800">Add Exercise</p><button type="button" onClick={onClose} disabled={disabled} className="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Close</button></div><label className="mt-3 block"><span className="sr-only">Search exercises</span><input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} disabled={disabled} placeholder="Search exercises…" autoFocus className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label>{error && <FieldError>{error}</FieldError>}{loading && exercises === null ? <p className="mt-4 text-sm font-medium text-slate-500">Loading exercises…</p> : exercises !== null && exercises.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-stone-50 p-4"><p className="font-semibold">No exercises found.</p><p className="mt-1 text-sm text-slate-500">Can&apos;t find the movement you need?</p><button type="button" onClick={onOpenLibrary} disabled={disabled} className="mt-3 min-h-11 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700 disabled:opacity-50">Open Exercise Library</button></div> : <div className="mt-4 grid gap-4">{system.length > 0 && <PickerGroup title="System exercises" exercises={system} selectedIds={selectedIds} disabled={disabled} onAdd={onAdd} />}{privateExercises.length > 0 && <PickerGroup title="My exercises" exercises={privateExercises} selectedIds={selectedIds} disabled={disabled} onAdd={onAdd} />}{loading && <p className="text-sm font-medium text-slate-500">Updating exercises…</p>}</div>}</div>;
}

function PickerGroup({ title, exercises, selectedIds, disabled, onAdd }: { title: string; exercises: Exercise[]; selectedIds: Set<string>; disabled: boolean; onAdd: (exercise: Exercise) => void }) {
  return <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p><ul className="overflow-hidden rounded-2xl border border-slate-100">{exercises.map((exercise, index) => { const added = selectedIds.has(exercise.id); return <li key={exercise.id} className={`flex items-center justify-between gap-3 px-3 py-3 ${index > 0 ? "border-t border-slate-100" : ""}`}><span className="min-w-0 break-words font-semibold text-slate-800">{exercise.name}</span><button type="button" disabled={disabled || added} onClick={() => onAdd(exercise)} className="min-h-10 shrink-0 rounded-xl border border-teal-600 px-3 text-sm font-bold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500">{added ? "Added" : "Add"}</button></li>; })}</ul></div>;
}

function Notice({ children, tone }: { children: ReactNode; tone: "error" | "success" }) {
  return <p role={tone === "error" ? "alert" : undefined} className={`rounded-2xl px-4 py-3 text-sm font-medium ${tone === "error" ? "bg-red-50 text-red-700 ring-1 ring-red-600/10" : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/10"}`}>{children}</p>;
}

function LoadingCard({ label }: { label: string }) {
  return <div className="rounded-2xl bg-stone-50 px-4 py-5 text-sm font-medium text-slate-500">{label}</div>;
}

function EmptyCard({ title, body }: { title: string; body: string }) {
  return <div className="rounded-2xl border border-dashed border-slate-200 bg-stone-50 px-4 py-5"><p className="font-semibold">{title}</p><p className="mt-1 text-sm leading-6 text-slate-500">{body}</p></div>;
}

function FieldError({ children }: { children: string }) {
  return <p role="alert" className="mt-2 text-sm font-medium text-red-700">{children}</p>;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}
