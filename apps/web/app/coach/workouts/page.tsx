"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useT, type MessageKey } from "@/lib/i18n";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";
import SignOutButton from "@/components/sign-out-button";
import { AppHeader } from "@/components/app-header";
import {
  groupHistory,
  historyEndpoint,
  historyStatusLabel,
  prepareHistory,
  type HistoryEntry,
  type HistoryRange,
  type HistorySession,
} from "./history";

type Role = "COACH" | "ATHLETE";
type Athlete = { id: string; name: string; role: "ATHLETE" };
type Exercise = { id: string; name: string; scope: "SYSTEM" | "PRIVATE" };
type PrescriptionMode = "REPS" | "TEXT";
type PlannedUnit = "kg" | "lb";
type PlanDefaults = { reps?: number; prescriptionNote?: string; load?: number; unit?: PlannedUnit; rpe?: number };
type PlanOverride = { position: number; reps?: number; prescriptionNote?: string; load?: number; rpe?: number };
type Plan = { setCount: number; defaults: PlanDefaults; overrides: PlanOverride[] };
type WorkoutExercise = { workoutExerciseId: string; exerciseId: string; name: string; plan: Plan; position: number };
type Workout = { id: string; name: string; exercises: WorkoutExercise[] };
type DraftSetOverride = {
  position: number;
  prescriptionMode?: PrescriptionMode;
  reps?: string;
  prescriptionNote?: string;
  load?: string;
  rpe?: string;
};
type DraftExercise = {
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
type FieldErrors = { name?: string; exercises?: string; items: Record<number, Partial<Record<"sets" | "reps" | "note" | "load" | "rpe" | "overrides", string>>> };

const initialErrors = (): FieldErrors => ({ items: {} });

// The Go API is the authority on why it rejected a call (a workout that
// fails server-side validation comes back with its own explanation), so
// serverMessage passes that copy through; anything else falls back to
// errors.unexpected — what the per-page helper this replaces did.
const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

// history.ts stays the single place that decides which of the three states a
// scheduled workout is in — including the deliberate agreement with the
// Calendar's wording that history.test.ts asserts. This map only carries
// that decision into the message catalog.
const HISTORY_STATUS_KEYS: Record<ReturnType<typeof historyStatusLabel>, MessageKey> = {
  "Not started": "coach.historyStatus.notStarted",
  "In progress": "coach.historyStatus.inProgress",
  "Done": "coach.historyStatus.done",
};

function compactOverride(override: DraftSetOverride): DraftSetOverride | null {
  const next: DraftSetOverride = { position: override.position };
  if (override.prescriptionMode !== undefined) next.prescriptionMode = override.prescriptionMode;
  if (override.reps !== undefined && override.reps !== "") next.reps = override.reps;
  if (override.prescriptionNote !== undefined && override.prescriptionNote.trim() !== "") next.prescriptionNote = override.prescriptionNote;
  if (override.load !== undefined && override.load !== "") next.load = override.load;
  if (override.rpe !== undefined && override.rpe !== "") next.rpe = override.rpe;
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

export default function CoachWorkoutsPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const t = useT();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [athleteError, setAthleteError] = useState<string | null>(null);
  const [selectedAthleteId, setSelectedAthleteId] = useState("");
  const [historyRange, setHistoryRange] = useState<HistoryRange>("30");
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftExercises, setDraftExercises] = useState<DraftExercise[]>([]);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(initialErrors);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerExercises, setPickerExercises] = useState<Exercise[] | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const roleRequestId = useRef(0);
  const athleteRequestId = useRef(0);
  const historyRequestId = useRef(0);
  const pickerRequestId = useRef(0);
  const saveInFlight = useRef(false);
  const startingRef = useRef<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    const requestId = ++roleRequestId.current;
    let cancelled = false;
    (async () => {
      setRoleError(null);
      try {
        const me = await apiFetch<{ role: Role }>(idToken, "/api/v1/me");
        if (cancelled || requestId !== roleRequestId.current) return;
        if (me.role === "ATHLETE") {
          router.replace("/today");
          return;
        }
        setRole(me.role);
      } catch (error) {
        if (!cancelled && requestId === roleRequestId.current) setRoleError(errorMessage(t, error, API_ERROR_POLICY));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, router, t]);

  useEffect(() => {
    if (!idToken || role !== "COACH") return;
    const requestId = ++athleteRequestId.current;
    let cancelled = false;
    (async () => {
      setAthleteError(null);
      try {
        const result = await apiFetch<Athlete[]>(idToken, "/api/v1/athletes");
        if (!cancelled && requestId === athleteRequestId.current) {
          setAthletes(result);
          setAthleteError(null);
        }
      } catch (error) {
        if (!cancelled && requestId === athleteRequestId.current) setAthleteError(errorMessage(t, error, API_ERROR_POLICY));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, role, t]);

  useEffect(() => {
    if (!idToken || role !== "COACH") return;
    const requestId = ++historyRequestId.current;
    const requestToday = new Date();
    const endpoint = historyEndpoint(historyRange, requestToday, selectedAthleteId);
    let cancelled = false;
    (async () => {
      setHistory(null);
      setHistoryError(null);
      try {
        const result = await apiFetch<HistoryEntry[]>(idToken, endpoint);
        if (!cancelled && requestId === historyRequestId.current) {
          setHistory(prepareHistory(result, requestToday));
          setHistoryError(null);
        }
      } catch (error) {
        if (!cancelled && requestId === historyRequestId.current) setHistoryError(errorMessage(t, error, API_ERROR_POLICY));
      }
    })();
    return () => { cancelled = true; };
  }, [historyRange, idToken, role, selectedAthleteId, t]);

  useEffect(() => {
    if (!idToken || role !== "COACH" || !pickerOpen) return;
    const requestId = ++pickerRequestId.current;
    const trimmedQuery = pickerQuery.trim();
    if (trimmedQuery === "") return;
    const endpoint = `/api/v1/exercises?q=${encodeURIComponent(trimmedQuery)}`;
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
        } catch (error) {
          if (!cancelled && requestId === pickerRequestId.current) setPickerError(errorMessage(t, error, API_ERROR_POLICY));
        } finally {
          if (!cancelled && requestId === pickerRequestId.current) setPickerLoading(false);
        }
      })();
    }, 275);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [idToken, pickerOpen, pickerQuery, role, t]);

  function resetDraft() {
    setDraftName("");
    setDraftExercises([]);
    setFieldErrors(initialErrors());
    setSaveError(null);
    setPickerOpen(false);
    setPickerQuery("");
    setPickerExercises(null);
    setPickerError(null);
  }

  function startCreate() {
    resetDraft();
    setCreating(true);
  }

  function cancelCreate() {
    if (saving) return;
    resetDraft();
    setCreating(false);
  }

  function addExercise(exercise: Exercise) {
    if (draftExercises.some((item) => item.exercise.id === exercise.id)) return;
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
    setFieldErrors((previous) => ({ ...previous, exercises: undefined }));
    setPickerOpen(false);
    setPickerQuery("");
    setPickerExercises(null);
  }

  function updateExercise(index: number, update: Partial<DraftExercise>) {
    setDraftExercises((previous) => previous.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
    setFieldErrors((previous) => ({ ...previous, items: { ...previous.items, [index]: {} } }));
  }

  function updateSetCount(index: number, value: string) {
    const nextCount = Number(value);
    const item = draftExercises[index];
    if (Number.isInteger(nextCount) && nextCount > 0 && item.overrides.some((override) => override.position > nextCount)) {
      setFieldErrors((previous) => ({
        ...previous,
        items: {
          ...previous.items,
          [index]: { ...previous.items[index], sets: t("coach.workouts.error.setCountOverrides") },
        },
      }));
      return;
    }
    updateExercise(index, { setCount: value, editingPositions: item.editingPositions.filter((position) => position <= nextCount) });
  }

  function removeExercise(index: number) {
    setDraftExercises((previous) => previous.filter((_, itemIndex) => itemIndex !== index));
    setFieldErrors(initialErrors());
  }

  function moveExercise(index: number, direction: -1 | 1) {
    setDraftExercises((previous) => {
      const destination = index + direction;
      if (destination < 0 || destination >= previous.length) return previous;
      const next = [...previous];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function validateDraft(): FieldErrors {
    const errors = initialErrors();
    if (draftName.trim() === "") errors.name = t("coach.workouts.error.nameRequired");
    if (draftExercises.length === 0) errors.exercises = t("coach.workouts.error.exercisesRequired");
    draftExercises.forEach((item, index) => {
      const itemErrors: FieldErrors["items"][number] = {};
      if (!/^\d+$/.test(item.setCount) || Number(item.setCount) < 1) itemErrors.sets = t("coach.workouts.error.wholeNumber");
      if (item.prescriptionMode === "REPS" && (!/^\d+$/.test(item.defaultReps) || Number(item.defaultReps) < 1)) itemErrors.reps = t("coach.workouts.error.wholeNumber");
      if (item.prescriptionMode === "TEXT" && item.defaultPrescriptionNote.trim() === "") itemErrors.note = t("coach.workouts.error.noteRequired");
      if (item.defaultLoad.trim() !== "" && (!Number.isFinite(Number(item.defaultLoad)) || Number(item.defaultLoad) < 0)) itemErrors.load = t("coach.workouts.error.load");
      if (item.defaultRpe.trim() !== "" && (!Number.isFinite(Number(item.defaultRpe)) || Number(item.defaultRpe) < 1 || Number(item.defaultRpe) > 10)) itemErrors.rpe = t("coach.workouts.error.rpe");
      item.overrides.forEach((override) => {
        if (override.position < 1 || override.position > Number(item.setCount)) itemErrors.overrides = t("coach.workouts.error.overridePosition");
        if ((override.reps === undefined && override.prescriptionNote === undefined && override.prescriptionMode !== undefined) || (override.reps !== undefined && override.prescriptionNote !== undefined)) itemErrors.overrides = t("coach.workouts.error.overrideMode");
        if (override.reps !== undefined && (!/^\d+$/.test(override.reps) || Number(override.reps) < 1)) itemErrors.overrides = t("coach.workouts.error.overrideReps");
        if (override.prescriptionNote !== undefined && override.prescriptionNote.trim() === "") itemErrors.overrides = t("coach.workouts.error.overrideNote");
        if (override.load !== undefined && (!Number.isFinite(Number(override.load)) || Number(override.load) < 0)) itemErrors.overrides = t("coach.workouts.error.overrideLoad");
        if (override.rpe !== undefined && (!Number.isFinite(Number(override.rpe)) || Number(override.rpe) < 1 || Number(override.rpe) > 10)) itemErrors.overrides = t("coach.workouts.error.overrideRpe");
      });
      if (Object.keys(itemErrors).length > 0) errors.items[index] = itemErrors;
    });
    return errors;
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!idToken || saving || saveInFlight.current) return;
    const errors = validateDraft();
    setFieldErrors(errors);
    setSaveError(null);
    if (errors.name || errors.exercises || Object.keys(errors.items).length > 0) return;

    saveInFlight.current = true;
    setSaving(true);
    try {
      await apiFetch<Workout>(idToken, "/api/v1/workouts", {
        method: "POST",
        body: {
          name: draftName.trim(),
          exercises: draftExercises.map((item) => ({
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
          })),
        },
      });
      resetDraft();
      setCreating(false);
    } catch (error) {
      setSaveError(errorMessage(t, error, API_ERROR_POLICY));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  async function handleHistoryAction(entry: HistoryEntry) {
    if (entry.session !== null) {
      router.push(`/session/${entry.session.id}`);
      return;
    }
    if (!idToken || startingRef.current !== null) return;
    startingRef.current = entry.id;
    setStartingId(entry.id);
    setHistoryError(null);
    try {
      const session = await apiFetch<HistorySession>(idToken, `/api/v1/scheduled-workouts/${entry.id}/session`, { method: "POST" });
      router.push(`/session/${session.id}`);
    } catch (error) {
      setHistoryError(errorMessage(t, error, API_ERROR_POLICY));
      startingRef.current = null;
      setStartingId(null);
    }
  }

  if (authLoading || (user && !idToken) || (user && !role && !roleError)) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("common.loading")}</main>;
  }
  if (!user) return null;

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <AppHeader
        maxWidth="max-w-3xl"
        actions={<SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />}
      >
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">{creating ? t("coach.workouts.createTitle") : t("coach.workouts.historyTitle")}</h1>
        <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">{creating ? t("coach.workouts.createSubtitle") : t("coach.workouts.historySubtitle")}</p>
        <button type="button" onClick={() => router.push("/coach/calendar")} disabled={saving} className="mt-4 min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50">{t("coach.nav.calendar")}</button>
      </AppHeader>

      <div className="mx-auto -mt-3 flex max-w-3xl flex-col gap-6 px-4">
        {roleError && <Notice>{roleError}</Notice>}
        {role === "COACH" && (creating ? (
          <form onSubmit={handleSave} className="grid gap-5">
            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.nameLabel")}</span>
                <input value={draftName} onChange={(event) => { setDraftName(event.target.value); setFieldErrors((previous) => ({ ...previous, name: undefined })); }} disabled={saving} autoFocus className="min-h-14 w-full rounded-2xl border border-slate-200 bg-stone-50 px-4 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100" />
              </label>
              {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
            </section>

            <section>
              <div className="mb-3 flex items-end justify-between gap-4 px-1">
                <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("coach.workouts.exercisesEyebrow")}</p><h2 className="mt-1 text-xl font-semibold tracking-tight">{t("coach.workouts.prescriptionHeading")}</h2></div>
                {draftExercises.length > 0 && <span className="shrink-0 text-sm font-medium text-slate-500">{t("coach.workouts.addedCount", { count: draftExercises.length })}</span>}
              </div>
              {fieldErrors.exercises && <div className="mb-3"><Notice>{fieldErrors.exercises}</Notice></div>}
              <div className="grid gap-4">
                {draftExercises.map((item, index) => <DraftExerciseCard key={item.exercise.id} item={item} index={index} total={draftExercises.length} errors={fieldErrors.items[index]} saving={saving} onChange={(update) => updateExercise(index, update)} onSetCountChange={(value) => updateSetCount(index, value)} onMove={moveExercise} onRemove={removeExercise} />)}
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
              {!pickerOpen ? <button type="button" onClick={() => { setPickerOpen(true); setPickerError(null); }} disabled={saving} className="min-h-14 w-full rounded-2xl border border-dashed border-teal-600 bg-teal-50 px-5 text-base font-bold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50">{t("coach.workouts.addExercise")}</button> : <ExercisePicker query={pickerQuery} exercises={pickerExercises} loading={pickerLoading} error={pickerError} selectedIds={new Set(draftExercises.map((item) => item.exercise.id))} onQueryChange={setPickerQuery} onAdd={addExercise} onClose={() => setPickerOpen(false)} onOpenLibrary={() => router.push("/coach/exercises")} />}
            </section>

            {saveError && <Notice>{saveError}</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="submit" disabled={saving} className="min-h-14 rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{saving ? t("coach.workouts.saving") : t("coach.workouts.save")}</button>
              <button type="button" onClick={cancelCreate} disabled={saving} className="min-h-14 rounded-2xl border border-slate-300 bg-white px-5 text-base font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">{t("common.cancel")}</button>
            </div>
          </form>
        ) : <WorkoutHistory
          athletes={athletes}
          athleteError={athleteError}
          selectedAthleteId={selectedAthleteId}
          historyRange={historyRange}
          history={history}
          historyError={historyError}
          startingId={startingId}
          onAthleteChange={setSelectedAthleteId}
          onRangeChange={setHistoryRange}
          onHistoryAction={handleHistoryAction}
          onCreate={startCreate}
        />)}
      </div>
    </main>
  );
}

function WorkoutHistory({
  athletes,
  athleteError,
  selectedAthleteId,
  historyRange,
  history,
  historyError,
  startingId,
  onAthleteChange,
  onRangeChange,
  onHistoryAction,
  onCreate,
}: {
  athletes: Athlete[] | null;
  athleteError: string | null;
  selectedAthleteId: string;
  historyRange: HistoryRange;
  history: HistoryEntry[] | null;
  historyError: string | null;
  startingId: string | null;
  onAthleteChange: (athleteId: string) => void;
  onRangeChange: (range: HistoryRange) => void;
  onHistoryAction: (entry: HistoryEntry) => void;
  onCreate: () => void;
}) {
  const t = useT();
  const groups = history === null ? [] : groupHistory(history);
  return <>
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
      <button type="button" onClick={onCreate} className="min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">{t("coach.workouts.createCta")}</button>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="min-w-0">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t("coach.workouts.athleteFilter")}</span>
          <select value={selectedAthleteId} onChange={(event) => onAthleteChange(event.target.value)} disabled={athletes === null} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:opacity-60">
            <option value="">{t("coach.workouts.allAthletes")}</option>
            {athletes?.map((athlete) => <option key={athlete.id} value={athlete.id}>{athlete.name}</option>)}
          </select>
        </label>
        <label className="min-w-0">
          <span className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{t("coach.workouts.dateRange")}</span>
          <select value={historyRange} onChange={(event) => onRangeChange(event.target.value as HistoryRange)} className="min-h-12 w-full min-w-0 rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15">
            <option value="7">{t("coach.workouts.range7")}</option>
            <option value="30">{t("coach.workouts.range30")}</option>
            <option value="90">{t("coach.workouts.range90")}</option>
            <option value="all">{t("coach.workouts.rangeAll")}</option>
          </select>
        </label>
      </div>
    </section>

    {athleteError && <Notice>{athleteError}</Notice>}
    {historyError && <Notice>{historyError}</Notice>}
    {history === null ? <LoadingCard label={t("coach.workouts.loadingHistory")} /> : groups.length === 0 ? (
      <section className="rounded-3xl border border-dashed border-slate-200 bg-stone-50 px-5 py-5"><p className="font-semibold">{selectedAthleteId === "" ? t("coach.workouts.emptyHistory") : t("coach.workouts.emptyForAthlete")}</p></section>
    ) : (
      <div className="grid gap-6">
        {groups.map((group) => <HistoryDateGroup key={group.date} date={group.date} entries={group.entries} startingId={startingId} onAction={onHistoryAction} />)}
      </div>
    )}
  </>;
}

function displayHistoryDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(`${date}T00:00:00`)).toUpperCase();
}

function historyStatusClass(session: HistorySession | null): string {
  if (session?.status === "COMPLETED") return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (session?.status === "ACTIVE") return "bg-teal-50 text-teal-700 ring-teal-600/20";
  return "bg-slate-100 text-slate-600 ring-slate-500/10";
}

function HistoryDateGroup({ date, entries, startingId, onAction }: { date: string; entries: HistoryEntry[]; startingId: string | null; onAction: (entry: HistoryEntry) => void }) {
  const t = useT();
  return <section aria-labelledby={`history-${date}`}>
    <h2 id={`history-${date}`} className="mb-3 px-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{displayHistoryDate(date)}</h2>
    <ul className="grid gap-3">
      {entries.map((entry) => {
        const actionLabel = entry.session === null ? t("coach.session.start") : entry.session.status === "ACTIVE" ? t("coach.session.resume") : t("coach.session.review");
        const starting = startingId === entry.id;
        return <li key={entry.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="break-words text-sm font-semibold text-slate-500">{entry.athlete.name}</p>
              <h3 className="mt-1 break-words text-xl font-semibold tracking-tight">{entry.workout.name}</h3>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${historyStatusClass(entry.session)}`}>{t(HISTORY_STATUS_KEYS[historyStatusLabel(entry.session)])}</span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <time dateTime={entry.scheduledDate} className="text-sm font-medium text-slate-500">{displayHistoryDate(entry.scheduledDate)}</time>
            <button type="button" onClick={() => onAction(entry)} disabled={startingId !== null} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50">{starting ? t("coach.session.starting") : actionLabel}</button>
          </div>
        </li>;
      })}
    </ul>
  </section>;
}

function DraftExerciseCard({ item, index, total, errors, saving, onChange, onSetCountChange, onMove, onRemove }: { item: DraftExercise; index: number; total: number; errors?: FieldErrors["items"][number]; saving: boolean; onChange: (update: Partial<DraftExercise>) => void; onSetCountChange: (value: string) => void; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void }) {
  const t = useT();
  const textMode = item.prescriptionMode === "TEXT";
  const setCount = /^\d+$/.test(item.setCount) ? Number(item.setCount) : 0;
  const effectivePrescription = (position: number) => {
    const override = item.overrides.find((candidate) => candidate.position === position);
    const mode = override?.prescriptionMode ?? (override?.reps !== undefined ? "REPS" : override?.prescriptionNote !== undefined ? "TEXT" : textMode ? "TEXT" : "REPS");
    return mode === "REPS" ? { mode, value: override?.reps ?? (textMode ? "" : item.defaultReps) } : { mode, value: override?.prescriptionNote ?? (textMode ? item.defaultPrescriptionNote : "") };
  };
  const effectiveValue = (position: number, property: "load" | "rpe") => item.overrides.find((candidate) => candidate.position === position)?.[property] ?? (property === "load" ? item.defaultLoad : item.defaultRpe);
  const updateOverride = (position: number, update: Partial<DraftSetOverride>) => onChange({ overrides: updateDraftOverride(item.overrides, position, update) });
  const clearOverride = (position: number, property: "prescription" | "load" | "rpe") => onChange({ overrides: clearDraftOverrideProperty(item.overrides, position, property) });
  const toggleSetEditor = (position: number) => onChange({ editingPositions: item.editingPositions.includes(position) ? item.editingPositions.filter((candidate) => candidate !== position) : [...item.editingPositions, position] });

  return <article className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("coach.workouts.exerciseIndex", { number: index + 1 })}</p><h3 className="mt-1 text-xl font-semibold tracking-tight">{item.exercise.name}</h3></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${item.exercise.scope === "SYSTEM" ? "bg-slate-100 text-slate-600" : "bg-teal-50 text-teal-700"}`}>{t(item.exercise.scope === "SYSTEM" ? "coach.scope.system" : "coach.scope.private")}</span></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.sets")}</span><input type="number" inputMode="numeric" min="1" step="1" value={item.setCount} onChange={(event) => onSetCountChange(event.target.value)} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.sets && <FieldError>{errors.sets}</FieldError>}</label>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.targetRpe")} <span className="font-normal text-slate-500">{t("coach.optional")}</span></span><input type="number" inputMode="decimal" min="1" max="10" step="0.5" value={item.defaultRpe} onChange={(event) => onChange({ defaultRpe: event.target.value })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.rpe && <FieldError>{errors.rpe}</FieldError>}</label>
    </div>
    <fieldset className="mt-5"><legend className="text-sm font-semibold text-slate-700">{t("coach.workouts.prescription")}</legend><div className="mt-2 flex flex-wrap gap-2"><ModeButton active={!textMode} onClick={() => onChange({ prescriptionMode: "REPS" })} disabled={saving}>{t("coach.workouts.modeReps")}</ModeButton><ModeButton active={textMode} onClick={() => onChange({ prescriptionMode: "TEXT" })} disabled={saving}>{t("coach.workouts.modeText")}</ModeButton></div></fieldset>
    {textMode ? <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.instruction")}</span><input value={item.defaultPrescriptionNote} onChange={(event) => onChange({ defaultPrescriptionNote: event.target.value })} disabled={saving} placeholder={t("coach.workouts.instructionPlaceholder")} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.note && <FieldError>{errors.note}</FieldError>}</label> : <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.reps")}</span><input type="number" inputMode="numeric" min="1" step="1" value={item.defaultReps} onChange={(event) => onChange({ defaultReps: event.target.value })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.reps && <FieldError>{errors.reps}</FieldError>}</label>}
    <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem]"><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.plannedLoad")} <span className="font-normal text-slate-500">{t("coach.optional")}</span></span><input type="number" inputMode="decimal" min="0" step="0.5" value={item.defaultLoad} onChange={(event) => onChange({ defaultLoad: event.target.value })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.load && <FieldError>{errors.load}</FieldError>}</label><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.unit")}</span><select value={item.unit} onChange={(event) => onChange({ unit: event.target.value as PlannedUnit })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100"><option value="kg">kg</option><option value="lb">lb</option></select></label></div>
    <div className="mt-5 border-t border-slate-100 pt-4"><button type="button" onClick={() => onChange({ customizationOpen: !item.customizationOpen })} disabled={saving || setCount < 1} className="min-h-11 rounded-xl border border-teal-600 px-3 text-sm font-bold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50">{item.customizationOpen ? t("coach.workouts.hideSets") : t("coach.workouts.customizeSets")}</button>
      {item.customizationOpen && <div className="mt-3 grid gap-2">{Array.from({ length: setCount }, (_, offset) => offset + 1).map((position) => {
        const prescription = effectivePrescription(position);
        const load = effectiveValue(position, "load");
        const rpe = effectiveValue(position, "rpe");
        const override = item.overrides.find((candidate) => candidate.position === position);
        const editing = item.editingPositions.includes(position);
        return <div key={position} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-800">{t("coach.workouts.setNumber", { number: position })}</p><p className="mt-0.5 text-sm text-slate-600">{prescription.mode === "REPS" ? t("coach.workouts.repsValue", { value: prescription.value }) : prescription.value}{load !== "" && ` · ${load} ${item.unit}`}{rpe !== "" && ` · RPE ${rpe}`}</p></div><button type="button" onClick={() => toggleSetEditor(position)} disabled={saving} className="min-h-10 rounded-lg px-3 text-sm font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50">{editing ? t("common.done") : t("common.edit")}</button></div>
          {editing && <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3"><fieldset><legend className="text-sm font-semibold text-slate-700">{t("coach.workouts.prescription")}</legend><div className="mt-2 flex gap-2"><ModeButton active={prescription.mode === "REPS"} onClick={() => updateOverride(position, { prescriptionMode: "REPS", reps: prescription.mode === "REPS" ? prescription.value : "", prescriptionNote: undefined })} disabled={saving}>{t("coach.workouts.modeReps")}</ModeButton><ModeButton active={prescription.mode === "TEXT"} onClick={() => updateOverride(position, { prescriptionMode: "TEXT", reps: undefined, prescriptionNote: prescription.mode === "TEXT" ? prescription.value : "" })} disabled={saving}>{t("coach.workouts.modeText")}</ModeButton>{(override?.reps !== undefined || override?.prescriptionNote !== undefined || override?.prescriptionMode !== undefined) && <button type="button" onClick={() => clearOverride(position, "prescription")} disabled={saving} className="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">{t("coach.workouts.useDefault")}</button>}</div></fieldset>
            {prescription.mode === "REPS" ? <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.reps")}</span><input type="number" inputMode="numeric" min="1" step="1" value={prescription.value} onChange={(event) => updateOverride(position, { prescriptionMode: "REPS", reps: event.target.value, prescriptionNote: undefined })} disabled={saving} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label> : <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.instruction")}</span><input value={prescription.value} onChange={(event) => updateOverride(position, { prescriptionMode: "TEXT", reps: undefined, prescriptionNote: event.target.value })} disabled={saving} placeholder={t("coach.workouts.instructionPlaceholder")} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{t("coach.workouts.load")}</span><input type="number" inputMode="decimal" min="0" step="0.5" value={load} onChange={(event) => updateOverride(position, { load: event.target.value })} disabled={saving} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{override?.load !== undefined && <button type="button" onClick={() => clearOverride(position, "load")} disabled={saving} className="mt-1 text-sm font-bold text-slate-600 hover:text-teal-700 disabled:opacity-50">{t("coach.workouts.useDefaultLoad")}</button>}</label><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">RPE</span><input type="number" inputMode="decimal" min="1" max="10" step="0.5" value={rpe} onChange={(event) => updateOverride(position, { rpe: event.target.value })} disabled={saving} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{override?.rpe !== undefined && <button type="button" onClick={() => clearOverride(position, "rpe")} disabled={saving} className="mt-1 text-sm font-bold text-slate-600 hover:text-teal-700 disabled:opacity-50">{t("coach.workouts.useDefaultRpe")}</button>}</label></div></div>}</div>;
      })}</div>}
      {errors?.overrides && <FieldError>{errors.overrides}</FieldError>}</div>
    <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => onMove(index, -1)} disabled={saving || index === 0} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{t("coach.workouts.moveUp")}</button><button type="button" onClick={() => onMove(index, 1)} disabled={saving || index === total - 1} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">{t("coach.workouts.moveDown")}</button><button type="button" onClick={() => onRemove(index)} disabled={saving} className="min-h-11 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">{t("common.remove")}</button></div>
  </article>;
}

function ExercisePicker({ query, exercises, loading, error, selectedIds, onQueryChange, onAdd, onClose, onOpenLibrary }: { query: string; exercises: Exercise[] | null; loading: boolean; error: string | null; selectedIds: Set<string>; onQueryChange: (value: string) => void; onAdd: (exercise: Exercise) => void; onClose: () => void; onOpenLibrary: () => void }) {
  const t = useT();
  const availableExercises = exercises?.filter((exercise) => !selectedIds.has(exercise.id)) ?? [];
  const visibleExercises = availableExercises.slice(0, 8);
  const system = visibleExercises.filter((exercise) => exercise.scope === "SYSTEM");
  const privateExercises = visibleExercises.filter((exercise) => exercise.scope === "PRIVATE");
  const hiddenCount = availableExercises.length - visibleExercises.length;
  const trimmedQuery = query.trim();
  return <div><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-800">{t("coach.picker.title")}</p><button type="button" onClick={onClose} className="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100">{t("common.close")}</button></div><label className="mt-3 block"><span className="sr-only">{t("coach.exercises.searchLabel")}</span><input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t("coach.exercises.searchPlaceholder")} autoFocus className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>{error && trimmedQuery !== "" && <FieldError>{error}</FieldError>}{trimmedQuery === "" ? <p className="mt-4 text-sm font-medium text-slate-500">{t("coach.picker.startTyping")}</p> : loading && exercises === null ? <p className="mt-4 text-sm font-medium text-slate-500">{t("coach.exercises.loading")}</p> : exercises !== null && exercises.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-stone-50 p-4"><p className="font-semibold">{t("coach.exercises.noneFound")}</p><p className="mt-1 text-sm text-slate-500">{t("coach.picker.cantFind")}</p><button type="button" onClick={onOpenLibrary} className="mt-3 min-h-11 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700">{t("coach.picker.openLibrary")}</button></div> : exercises !== null && availableExercises.length === 0 ? <p className="mt-4 text-sm font-medium text-slate-500">{t("coach.picker.allAdded")}</p> : <div className="mt-4 grid gap-4">{system.length > 0 && <PickerGroup title={t("coach.exercises.systemTitle")} exercises={system} selectedIds={selectedIds} onAdd={onAdd} />}{privateExercises.length > 0 && <PickerGroup title={t("coach.exercises.privateTitle")} exercises={privateExercises} selectedIds={selectedIds} onAdd={onAdd} />}{hiddenCount > 0 && <p className="text-sm font-medium text-slate-500">{t(hiddenCount === 1 ? "coach.picker.moreResultsOne" : "coach.picker.moreResultsOther", { count: hiddenCount })}</p>}{loading && <p className="text-sm font-medium text-slate-500">{t("coach.picker.updating")}</p>}</div>}</div>;
}

function PickerGroup({ title, exercises, selectedIds, onAdd }: { title: string; exercises: Exercise[]; selectedIds: Set<string>; onAdd: (exercise: Exercise) => void }) {
  const t = useT();
  return <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p><ul className="overflow-hidden rounded-2xl border border-slate-100">{exercises.map((exercise, index) => { const added = selectedIds.has(exercise.id); return <li key={exercise.id} className={`flex items-center justify-between gap-3 px-3 py-3 ${index > 0 ? "border-t border-slate-100" : ""}`}><span className="min-w-0 break-words font-semibold text-slate-800">{exercise.name}</span><button type="button" disabled={added} onClick={() => onAdd(exercise)} className="min-h-10 shrink-0 rounded-xl border border-teal-600 px-3 text-sm font-bold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500">{added ? t("coach.picker.added") : t("common.add")}</button></li>; })}</ul></div>;
}

function ModeButton({ active, children, ...props }: { active: boolean; children: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" {...props} className={`min-h-11 rounded-xl border px-4 text-sm font-bold transition ${active ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-50`}>{active ? "● " : "○ "}{children}</button>;
}

function Notice({ children }: { children: string }) { return <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{children}</p>; }
function FieldError({ children }: { children: string }) { return <p role="alert" className="mt-2 text-sm font-medium text-red-700">{children}</p>; }
function LoadingCard({ label }: { label: string }) { return <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><p className="text-sm font-medium text-slate-500">{label}</p></section>; }
