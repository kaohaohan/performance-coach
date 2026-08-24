"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import SignOutButton from "@/components/sign-out-button";

type Role = "COACH" | "ATHLETE";
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

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

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

function planLabel(plan: Plan): string {
  const defaults = plan.defaults;
  const prescription = defaults.reps === undefined ? `${plan.setCount} set${plan.setCount === 1 ? "" : "s"} · ${defaults.prescriptionNote ?? ""}` : `${plan.setCount} × ${defaults.reps}`;
  const details = [prescription];
  if (defaults.load !== undefined) details.push(`${defaults.load}${defaults.unit ? ` ${defaults.unit}` : ""}`);
  if (defaults.rpe !== undefined) details.push(`RPE ${defaults.rpe}`);
  if (plan.overrides.length > 0) details.push(`${plan.overrides.length} custom set${plan.overrides.length === 1 ? "" : "s"}`);
  return details.filter(Boolean).join(" · ");
}

export default function CoachWorkoutsPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
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
  const workoutRequestId = useRef(0);
  const pickerRequestId = useRef(0);
  const saveInFlight = useRef(false);

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
        if (!cancelled && requestId === roleRequestId.current) setRoleError(errorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, router]);

  useEffect(() => {
    if (!idToken || role !== "COACH") return;
    const requestId = ++workoutRequestId.current;
    let cancelled = false;
    (async () => {
      try {
        const result = await apiFetch<Workout[]>(idToken, "/api/v1/workouts");
        if (!cancelled && requestId === workoutRequestId.current) {
          setWorkouts(result);
          setLoadError(null);
        }
      } catch (error) {
        if (!cancelled && requestId === workoutRequestId.current) setLoadError(errorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, reloadKey, role]);

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
          if (!cancelled && requestId === pickerRequestId.current) setPickerError(errorMessage(error));
        } finally {
          if (!cancelled && requestId === pickerRequestId.current) setPickerLoading(false);
        }
      })();
    }, 275);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [idToken, pickerOpen, pickerQuery, role]);

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
          [index]: { ...previous.items[index], sets: "Remove overrides above the new set count before reducing sets." },
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
    if (draftName.trim() === "") errors.name = "Workout name is required.";
    if (draftExercises.length === 0) errors.exercises = "Add at least one exercise.";
    draftExercises.forEach((item, index) => {
      const itemErrors: FieldErrors["items"][number] = {};
      if (!/^\d+$/.test(item.setCount) || Number(item.setCount) < 1) itemErrors.sets = "Enter a whole number of at least 1.";
      if (item.prescriptionMode === "REPS" && (!/^\d+$/.test(item.defaultReps) || Number(item.defaultReps) < 1)) itemErrors.reps = "Enter a whole number of at least 1.";
      if (item.prescriptionMode === "TEXT" && item.defaultPrescriptionNote.trim() === "") itemErrors.note = "Instruction is required.";
      if (item.defaultLoad.trim() !== "" && (!Number.isFinite(Number(item.defaultLoad)) || Number(item.defaultLoad) < 0)) itemErrors.load = "Load must be 0 or greater.";
      if (item.defaultRpe.trim() !== "" && (!Number.isFinite(Number(item.defaultRpe)) || Number(item.defaultRpe) < 1 || Number(item.defaultRpe) > 10)) itemErrors.rpe = "RPE must be between 1 and 10.";
      item.overrides.forEach((override) => {
        if (override.position < 1 || override.position > Number(item.setCount)) itemErrors.overrides = "Each individual override must be within the set count.";
        if ((override.reps === undefined && override.prescriptionNote === undefined && override.prescriptionMode !== undefined) || (override.reps !== undefined && override.prescriptionNote !== undefined)) itemErrors.overrides = "Each individual set needs either reps or text, not both.";
        if (override.reps !== undefined && (!/^\d+$/.test(override.reps) || Number(override.reps) < 1)) itemErrors.overrides = "Individual reps must be a whole number of at least 1.";
        if (override.prescriptionNote !== undefined && override.prescriptionNote.trim() === "") itemErrors.overrides = "Individual text instruction is required.";
        if (override.load !== undefined && (!Number.isFinite(Number(override.load)) || Number(override.load) < 0)) itemErrors.overrides = "Individual load must be 0 or greater.";
        if (override.rpe !== undefined && (!Number.isFinite(Number(override.rpe)) || Number(override.rpe) < 1 || Number(override.rpe) > 10)) itemErrors.overrides = "Individual RPE must be between 1 and 10.";
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
      setWorkouts(null);
      setReloadKey((value) => value + 1);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  if (authLoading || (user && !idToken) || (user && !role && !roleError)) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  }
  if (!user) return null;

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-3xl">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Performance Coach</p>
            <SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">{creating ? "Create Workout" : "Workout Library"}</h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-300">{creating ? "Build a reusable training template." : "Build reusable training templates."}</p>
          <button type="button" onClick={() => router.push("/coach/calendar")} disabled={saving} className="mt-4 min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50">← Coach Calendar</button>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-3xl flex-col gap-6 px-4">
        {roleError && <Notice>{roleError}</Notice>}
        {role === "COACH" && (creating ? (
          <form onSubmit={handleSave} className="grid gap-5">
            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
              <label className="block">
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">Workout Name</span>
                <input value={draftName} onChange={(event) => { setDraftName(event.target.value); setFieldErrors((previous) => ({ ...previous, name: undefined })); }} disabled={saving} autoFocus className="min-h-14 w-full rounded-2xl border border-slate-200 bg-stone-50 px-4 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100" />
              </label>
              {fieldErrors.name && <FieldError>{fieldErrors.name}</FieldError>}
            </section>

            <section>
              <div className="mb-3 flex items-end justify-between gap-4 px-1">
                <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Exercises</p><h2 className="mt-1 text-xl font-semibold tracking-tight">Training prescription</h2></div>
                {draftExercises.length > 0 && <span className="shrink-0 text-sm font-medium text-slate-500">{draftExercises.length} added</span>}
              </div>
              {fieldErrors.exercises && <div className="mb-3"><Notice>{fieldErrors.exercises}</Notice></div>}
              <div className="grid gap-4">
                {draftExercises.map((item, index) => <DraftExerciseCard key={item.exercise.id} item={item} index={index} total={draftExercises.length} errors={fieldErrors.items[index]} saving={saving} onChange={(update) => updateExercise(index, update)} onSetCountChange={(value) => updateSetCount(index, value)} onMove={moveExercise} onRemove={removeExercise} />)}
              </div>
            </section>

            <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
              {!pickerOpen ? <button type="button" onClick={() => { setPickerOpen(true); setPickerError(null); }} disabled={saving} className="min-h-14 w-full rounded-2xl border border-dashed border-teal-600 bg-teal-50 px-5 text-base font-bold text-teal-800 transition hover:bg-teal-100 disabled:cursor-not-allowed disabled:opacity-50">+ Add Exercise</button> : <ExercisePicker query={pickerQuery} exercises={pickerExercises} loading={pickerLoading} error={pickerError} selectedIds={new Set(draftExercises.map((item) => item.exercise.id))} onQueryChange={setPickerQuery} onAdd={addExercise} onClose={() => setPickerOpen(false)} onOpenLibrary={() => router.push("/coach/exercises")} />}
            </section>

            {saveError && <Notice>{saveError}</Notice>}
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="submit" disabled={saving} className="min-h-14 rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">{saving ? "Saving workout…" : "Save Workout"}</button>
              <button type="button" onClick={cancelCreate} disabled={saving} className="min-h-14 rounded-2xl border border-slate-300 bg-white px-5 text-base font-bold text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">Cancel</button>
            </div>
          </form>
        ) : <WorkoutLibrary workouts={workouts} loadError={loadError} onCreate={startCreate} />)}
      </div>
    </main>
  );
}

function WorkoutLibrary({ workouts, loadError, onCreate }: { workouts: Workout[] | null; loadError: string | null; onCreate: () => void }) {
  return <>
    <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><button type="button" onClick={onCreate} className="min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700">+ Create Workout</button></section>
    {loadError && <Notice>{loadError}</Notice>}
    {workouts === null ? <LoadingCard label="Loading workouts…" /> : workouts.length === 0 ? <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><h2 className="text-xl font-semibold tracking-tight">No workouts yet.</h2><p className="mt-2 text-sm leading-6 text-slate-500">Create your first reusable training template.</p><button type="button" onClick={onCreate} className="mt-4 min-h-11 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white transition hover:bg-teal-700">Create Workout</button></section> : <section><div className="mb-3 px-1"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workouts</p></div><ul className="grid gap-3">{workouts.map((workout) => <li key={workout.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><h2 className="text-xl font-semibold tracking-tight">{workout.name}</h2><p className="mt-1 text-sm font-medium text-slate-500">{workout.exercises.length} exercise{workout.exercises.length === 1 ? "" : "s"}</p><ul className="mt-4 grid gap-2 border-t border-slate-100 pt-4">{workout.exercises.map((exercise) => <li key={exercise.workoutExerciseId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm"><span className="font-semibold text-slate-800">{exercise.name}</span><span className="text-slate-500">{planLabel(exercise.plan)}</span></li>)}</ul></li>)}</ul></section>}
  </>;
}

function DraftExerciseCard({ item, index, total, errors, saving, onChange, onSetCountChange, onMove, onRemove }: { item: DraftExercise; index: number; total: number; errors?: FieldErrors["items"][number]; saving: boolean; onChange: (update: Partial<DraftExercise>) => void; onSetCountChange: (value: string) => void; onMove: (index: number, direction: -1 | 1) => void; onRemove: (index: number) => void }) {
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
    <div className="flex items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Exercise {index + 1}</p><h3 className="mt-1 text-xl font-semibold tracking-tight">{item.exercise.name}</h3></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${item.exercise.scope === "SYSTEM" ? "bg-slate-100 text-slate-600" : "bg-teal-50 text-teal-700"}`}>{item.exercise.scope}</span></div>
    <div className="mt-5 grid gap-4 sm:grid-cols-2">
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Sets</span><input type="number" inputMode="numeric" min="1" step="1" value={item.setCount} onChange={(event) => onSetCountChange(event.target.value)} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.sets && <FieldError>{errors.sets}</FieldError>}</label>
      <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Target RPE <span className="font-normal text-slate-500">optional</span></span><input type="number" inputMode="decimal" min="1" max="10" step="0.5" value={item.defaultRpe} onChange={(event) => onChange({ defaultRpe: event.target.value })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.rpe && <FieldError>{errors.rpe}</FieldError>}</label>
    </div>
    <fieldset className="mt-5"><legend className="text-sm font-semibold text-slate-700">Prescription</legend><div className="mt-2 flex flex-wrap gap-2"><ModeButton active={!textMode} onClick={() => onChange({ prescriptionMode: "REPS" })} disabled={saving}>Reps</ModeButton><ModeButton active={textMode} onClick={() => onChange({ prescriptionMode: "TEXT" })} disabled={saving}>Text</ModeButton></div></fieldset>
    {textMode ? <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Instruction</span><input value={item.defaultPrescriptionNote} onChange={(event) => onChange({ defaultPrescriptionNote: event.target.value })} disabled={saving} placeholder="AMAP, 30 sec, 10–12" className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.note && <FieldError>{errors.note}</FieldError>}</label> : <label className="mt-4 block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Reps</span><input type="number" inputMode="numeric" min="1" step="1" value={item.defaultReps} onChange={(event) => onChange({ defaultReps: event.target.value })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.reps && <FieldError>{errors.reps}</FieldError>}</label>}
    <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_8rem]"><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Planned Load <span className="font-normal text-slate-500">optional</span></span><input type="number" inputMode="decimal" min="0" step="0.5" value={item.defaultLoad} onChange={(event) => onChange({ defaultLoad: event.target.value })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{errors?.load && <FieldError>{errors.load}</FieldError>}</label><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Unit</span><select value={item.unit} onChange={(event) => onChange({ unit: event.target.value as PlannedUnit })} disabled={saving} className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100"><option value="kg">kg</option><option value="lb">lb</option></select></label></div>
    <div className="mt-5 border-t border-slate-100 pt-4"><button type="button" onClick={() => onChange({ customizationOpen: !item.customizationOpen })} disabled={saving || setCount < 1} className="min-h-11 rounded-xl border border-teal-600 px-3 text-sm font-bold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50">{item.customizationOpen ? "Hide individual sets" : "Customize individual sets"}</button>
      {item.customizationOpen && <div className="mt-3 grid gap-2">{Array.from({ length: setCount }, (_, offset) => offset + 1).map((position) => {
        const prescription = effectivePrescription(position);
        const load = effectiveValue(position, "load");
        const rpe = effectiveValue(position, "rpe");
        const override = item.overrides.find((candidate) => candidate.position === position);
        const editing = item.editingPositions.includes(position);
        return <div key={position} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><div className="min-w-0"><p className="font-semibold text-slate-800">Set {position}</p><p className="mt-0.5 text-sm text-slate-600">{prescription.mode === "REPS" ? `${prescription.value} reps` : prescription.value}{load !== "" && ` · ${load} ${item.unit}`}{rpe !== "" && ` · RPE ${rpe}`}</p></div><button type="button" onClick={() => toggleSetEditor(position)} disabled={saving} className="min-h-10 rounded-lg px-3 text-sm font-bold text-teal-700 hover:bg-teal-50 disabled:opacity-50">{editing ? "Done" : "Edit"}</button></div>
          {editing && <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3"><fieldset><legend className="text-sm font-semibold text-slate-700">Prescription</legend><div className="mt-2 flex gap-2"><ModeButton active={prescription.mode === "REPS"} onClick={() => updateOverride(position, { prescriptionMode: "REPS", reps: prescription.mode === "REPS" ? prescription.value : "", prescriptionNote: undefined })} disabled={saving}>Reps</ModeButton><ModeButton active={prescription.mode === "TEXT"} onClick={() => updateOverride(position, { prescriptionMode: "TEXT", reps: undefined, prescriptionNote: prescription.mode === "TEXT" ? prescription.value : "" })} disabled={saving}>Text</ModeButton>{(override?.reps !== undefined || override?.prescriptionNote !== undefined || override?.prescriptionMode !== undefined) && <button type="button" onClick={() => clearOverride(position, "prescription")} disabled={saving} className="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Use default</button>}</div></fieldset>
            {prescription.mode === "REPS" ? <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Reps</span><input type="number" inputMode="numeric" min="1" step="1" value={prescription.value} onChange={(event) => updateOverride(position, { prescriptionMode: "REPS", reps: event.target.value, prescriptionNote: undefined })} disabled={saving} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label> : <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Instruction</span><input value={prescription.value} onChange={(event) => updateOverride(position, { prescriptionMode: "TEXT", reps: undefined, prescriptionNote: event.target.value })} disabled={saving} placeholder="AMAP, 30 sec, 10–12" className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label>}
            <div className="grid gap-3 sm:grid-cols-2"><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Load</span><input type="number" inputMode="decimal" min="0" step="0.5" value={load} onChange={(event) => updateOverride(position, { load: event.target.value })} disabled={saving} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{override?.load !== undefined && <button type="button" onClick={() => clearOverride(position, "load")} disabled={saving} className="mt-1 text-sm font-bold text-slate-600 hover:text-teal-700 disabled:opacity-50">Use default load</button>}</label><label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">RPE</span><input type="number" inputMode="decimal" min="1" max="10" step="0.5" value={rpe} onChange={(event) => updateOverride(position, { rpe: event.target.value })} disabled={saving} className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" />{override?.rpe !== undefined && <button type="button" onClick={() => clearOverride(position, "rpe")} disabled={saving} className="mt-1 text-sm font-bold text-slate-600 hover:text-teal-700 disabled:opacity-50">Use default RPE</button>}</label></div></div>}</div>;
      })}</div>}
      {errors?.overrides && <FieldError>{errors.overrides}</FieldError>}</div>
    <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-100 pt-4"><button type="button" onClick={() => onMove(index, -1)} disabled={saving || index === 0} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Move Up</button><button type="button" onClick={() => onMove(index, 1)} disabled={saving || index === total - 1} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-800 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Move Down</button><button type="button" onClick={() => onRemove(index)} disabled={saving} className="min-h-11 rounded-xl border border-red-200 px-3 text-sm font-bold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40">Remove</button></div>
  </article>;
}

function ExercisePicker({ query, exercises, loading, error, selectedIds, onQueryChange, onAdd, onClose, onOpenLibrary }: { query: string; exercises: Exercise[] | null; loading: boolean; error: string | null; selectedIds: Set<string>; onQueryChange: (value: string) => void; onAdd: (exercise: Exercise) => void; onClose: () => void; onOpenLibrary: () => void }) {
  const availableExercises = exercises?.filter((exercise) => !selectedIds.has(exercise.id)) ?? [];
  const visibleExercises = availableExercises.slice(0, 8);
  const system = visibleExercises.filter((exercise) => exercise.scope === "SYSTEM");
  const privateExercises = visibleExercises.filter((exercise) => exercise.scope === "PRIVATE");
  const hiddenCount = availableExercises.length - visibleExercises.length;
  const trimmedQuery = query.trim();
  return <div><div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-800">Add Exercise</p><button type="button" onClick={onClose} className="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600 hover:bg-slate-100">Close</button></div><label className="mt-3 block"><span className="sr-only">Search exercises</span><input type="search" value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Search exercises…" autoFocus className="min-h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:bg-white focus:ring-2 focus:ring-teal-600/15" /></label>{error && trimmedQuery !== "" && <FieldError>{error}</FieldError>}{trimmedQuery === "" ? <p className="mt-4 text-sm font-medium text-slate-500">Start typing to find an exercise.</p> : loading && exercises === null ? <p className="mt-4 text-sm font-medium text-slate-500">Loading exercises…</p> : exercises !== null && exercises.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-stone-50 p-4"><p className="font-semibold">No exercises found.</p><p className="mt-1 text-sm text-slate-500">Can&apos;t find the movement you need?</p><button type="button" onClick={onOpenLibrary} className="mt-3 min-h-11 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white hover:bg-teal-700">Open Exercise Library</button></div> : exercises !== null && availableExercises.length === 0 ? <p className="mt-4 text-sm font-medium text-slate-500">All matching exercises are already added.</p> : <div className="mt-4 grid gap-4">{system.length > 0 && <PickerGroup title="System exercises" exercises={system} selectedIds={selectedIds} onAdd={onAdd} />}{privateExercises.length > 0 && <PickerGroup title="My exercises" exercises={privateExercises} selectedIds={selectedIds} onAdd={onAdd} />}{hiddenCount > 0 && <p className="text-sm font-medium text-slate-500">{hiddenCount} more result{hiddenCount === 1 ? "" : "s"}. Keep typing to narrow the list.</p>}{loading && <p className="text-sm font-medium text-slate-500">Updating exercises…</p>}</div>}</div>;
}

function PickerGroup({ title, exercises, selectedIds, onAdd }: { title: string; exercises: Exercise[]; selectedIds: Set<string>; onAdd: (exercise: Exercise) => void }) {
  return <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p><ul className="overflow-hidden rounded-2xl border border-slate-100">{exercises.map((exercise, index) => { const added = selectedIds.has(exercise.id); return <li key={exercise.id} className={`flex items-center justify-between gap-3 px-3 py-3 ${index > 0 ? "border-t border-slate-100" : ""}`}><span className="min-w-0 break-words font-semibold text-slate-800">{exercise.name}</span><button type="button" disabled={added} onClick={() => onAdd(exercise)} className="min-h-10 shrink-0 rounded-xl border border-teal-600 px-3 text-sm font-bold text-teal-700 transition hover:bg-teal-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-500">{added ? "Added" : "Add"}</button></li>; })}</ul></div>;
}

function ModeButton({ active, children, ...props }: { active: boolean; children: string; onClick: () => void; disabled: boolean }) {
  return <button type="button" {...props} className={`min-h-11 rounded-xl border px-4 text-sm font-bold transition ${active ? "border-teal-600 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"} disabled:cursor-not-allowed disabled:opacity-50`}>{active ? "● " : "○ "}{children}</button>;
}

function Notice({ children }: { children: string }) { return <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{children}</p>; }
function FieldError({ children }: { children: string }) { return <p role="alert" className="mt-2 text-sm font-medium text-red-700">{children}</p>; }
function LoadingCard({ label }: { label: string }) { return <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5"><p className="text-sm font-medium text-slate-500">{label}</p></section>; }
