"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

type PlannedSet = { scheduledWorkoutPlannedSetId: string; position: number; reps?: number; prescriptionNote?: string; load?: number; unit?: "kg" | "lb"; rpe?: number };
type Plan = { sets: PlannedSet[] };
type SetLog = { id: string; kind: "PLANNED" | "EXTRA"; scheduledWorkoutPlannedSetId?: string; plannedPosition?: number; setNumber: number; load?: number; unit?: "kg" | "lb"; reps: number; rpe?: number; loggedByUserId: string };
type SessionExercise = { scheduledWorkoutExerciseId: string; name: string; plan: Plan; setLogs: SetLog[] };
type SessionDetail = { id: string; status: "ACTIVE" | "COMPLETED"; athlete: { id: string; name: string }; exercises: SessionExercise[] };
type SetLogFormState = { load: string; unit: "kg" | "lb"; reps: string; rpe: string; submitting: boolean; error: string | null };
type SetLogKind = "PLANNED" | "EXTRA";

function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function emptyForm(): SetLogFormState {
  return { load: "", unit: "kg", reps: "", rpe: "", submitting: false, error: null };
}

function formForPlannedSet(target: PlannedSet): SetLogFormState {
  return { load: target.load === undefined ? "" : String(target.load), unit: target.unit ?? "kg", reps: target.reps === undefined ? "" : String(target.reps), rpe: "", submitting: false, error: null };
}

function orderedTargets(exercise: SessionExercise): PlannedSet[] {
  return [...exercise.plan.sets].sort((left, right) => left.position - right.position);
}

function actualForTarget(exercise: SessionExercise, target: PlannedSet): SetLog | undefined {
  return exercise.setLogs.find((log) => log.kind === "PLANNED" && log.scheduledWorkoutPlannedSetId === target.scheduledWorkoutPlannedSetId);
}

function firstIncompleteTarget(exercise: SessionExercise): PlannedSet | undefined {
  const completedPlannedSetIds = new Set(
    exercise.setLogs
      .filter((log) => log.kind === "PLANNED" && log.scheduledWorkoutPlannedSetId !== undefined)
      .map((log) => log.scheduledWorkoutPlannedSetId),
  );
  return orderedTargets(exercise).find((target) => !completedPlannedSetIds.has(target.scheduledWorkoutPlannedSetId));
}

function targetSummary(target: PlannedSet): string {
  const prescription = target.reps === undefined ? target.prescriptionNote ?? "" : `${target.reps} reps`;
  return [prescription, target.load === undefined ? "" : `${target.load} ${target.unit}`, target.rpe === undefined ? "" : `RPE ${target.rpe}`].filter(Boolean).join(" · ");
}

function actualSummary(log: SetLog): string {
  return [log.load === undefined ? "Bodyweight" : `${log.load} ${log.unit}`, `${log.reps} reps`, log.rpe === undefined ? "" : `RPE ${log.rpe}`].filter(Boolean).join(" · ");
}

function plannedFormKey(target: PlannedSet): string {
  return `planned:${target.scheduledWorkoutPlannedSetId}`;
}

function extraFormKey(exercise: SessionExercise): string {
  return `extra:${exercise.scheduledWorkoutExerciseId}`;
}

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, SetLogFormState>>({});
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const [extraOpen, setExtraOpen] = useState<Record<string, boolean>>({});
  const submittingFormKeys = useRef(new Set<string>());
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch<SessionDetail>(idToken, `/api/v1/sessions/${sessionId}`);
        if (!cancelled) {
          setLoadError(null);
          setSession(response);
        }
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(error));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, sessionId]);

  function getForm(key: string, initial: SetLogFormState): SetLogFormState {
    return forms[key] ?? initial;
  }

  function updateForm(key: string, initial: SetLogFormState, patch: Partial<SetLogFormState>) {
    setForms((previous) => ({ ...previous, [key]: { ...(previous[key] ?? initial), ...patch } }));
  }

  function clearForm(key: string) {
    setForms((previous) => {
      const rest = { ...previous };
      delete rest[key];
      return rest;
    });
  }

  function activeTarget(exercise: SessionExercise): PlannedSet | undefined {
    const selectedId = selectedTargets[exercise.scheduledWorkoutExerciseId];
    const selected = selectedId === undefined ? undefined : orderedTargets(exercise).find((target) => target.scheduledWorkoutPlannedSetId === selectedId);
    if (selected !== undefined && actualForTarget(exercise, selected) === undefined) return selected;
    return firstIncompleteTarget(exercise);
  }

  function appendSetLog(exerciseId: string, log: SetLog) {
    setSession((previous) => previous === null ? previous : {
      ...previous,
      exercises: previous.exercises.map((exercise) => exercise.scheduledWorkoutExerciseId === exerciseId ? { ...exercise, setLogs: [...exercise.setLogs, log] } : exercise),
    });
  }

  async function handleLogSet(exercise: SessionExercise, kind: SetLogKind, target?: PlannedSet) {
    if (!idToken) return;
    const key = kind === "PLANNED" && target !== undefined ? plannedFormKey(target) : extraFormKey(exercise);
    const initial = kind === "PLANNED" && target !== undefined ? formForPlannedSet(target) : emptyForm();
    const form = getForm(key, initial);
    if (form.submitting || submittingFormKeys.current.has(key)) return;

    const reps = Number(form.reps);
    if (form.reps.trim() === "" || !Number.isInteger(reps) || reps < 1) {
      updateForm(key, initial, { error: "Reps must be a whole number ≥ 1." });
      return;
    }
    let load: number | undefined;
    if (form.load.trim() !== "") {
      load = Number(form.load);
      if (!Number.isFinite(load) || load < 0) {
        updateForm(key, initial, { error: "Load must be a number ≥ 0." });
        return;
      }
    }
    let rpe: number | undefined;
    if (form.rpe.trim() !== "") {
      rpe = Number(form.rpe);
      if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) {
        updateForm(key, initial, { error: "Actual RPE must be between 1 and 10." });
        return;
      }
    }

    const body: Record<string, unknown> = { kind, scheduledWorkoutExerciseId: exercise.scheduledWorkoutExerciseId, reps };
    if (kind === "PLANNED" && target !== undefined) body.scheduledWorkoutPlannedSetId = target.scheduledWorkoutPlannedSetId;
    if (load !== undefined) {
      body.load = load;
      body.unit = form.unit;
    }
    if (rpe !== undefined) body.rpe = rpe;

    submittingFormKeys.current.add(key);
    updateForm(key, initial, { submitting: true, error: null });
    try {
      const log = await apiFetch<SetLog>(idToken, `/api/v1/sessions/${sessionId}/set-logs`, { method: "POST", body });
      appendSetLog(exercise.scheduledWorkoutExerciseId, log);
      clearForm(key);
      if (kind === "PLANNED") {
        setSelectedTargets((previous) => {
          const rest = { ...previous };
          delete rest[exercise.scheduledWorkoutExerciseId];
          return rest;
        });
      } else {
        setExtraOpen((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: false }));
      }
    } catch (error) {
      updateForm(key, initial, { submitting: false, error: errorMessage(error) });
    } finally {
      submittingFormKeys.current.delete(key);
    }
  }

  async function handleComplete() {
    if (!idToken || completing) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const completed = await apiFetch<{ id: string; status: "COMPLETED" }>(idToken, `/api/v1/sessions/${sessionId}/complete`, { method: "POST" });
      setSession((previous) => previous === null ? previous : { ...previous, status: completed.status });
    } catch (error) {
      setCompleteError(errorMessage(error));
    } finally {
      setCompleting(false);
    }
  }

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  if (!user) return null;
  if (loadError) return <main className="min-h-screen bg-stone-100 p-6"><p role="alert" className="mx-auto max-w-lg rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{loadError}</p></main>;
  if (!session) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;

  const isActive = session.status === "ACTIVE";
  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Workout Session</p>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div><h1 className="text-3xl font-semibold tracking-tight">{session.athlete.name}</h1><p className="mt-2 text-sm text-slate-300">{isActive ? "Live training" : "Training complete"}</p></div>
            <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold tracking-wide ${isActive ? "bg-teal-400 text-slate-950" : "bg-emerald-400 text-emerald-950"}`}>{session.status}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        {session.exercises.map((exercise) => {
          const targets = orderedTargets(exercise);
          const currentTarget = isActive ? activeTarget(exercise) : undefined;
          const extras = exercise.setLogs.filter((log) => log.kind === "EXTRA").sort((left, right) => left.setNumber - right.setNumber);
          const showExtraForm = extraOpen[exercise.scheduledWorkoutExerciseId] === true;
          const extraKey = extraFormKey(exercise);
          const extraInitial = emptyForm();
          const extraForm = getForm(extraKey, extraInitial);

          return <section key={exercise.scheduledWorkoutExerciseId} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5">
            <div className="border-b border-slate-100 px-5 py-5">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Exercise</p>
              <h2 className="mt-2 break-words text-2xl font-semibold tracking-tight">{exercise.name}</h2>
              <p className="mt-2 text-sm text-slate-500">{targets.length} planned set{targets.length === 1 ? "" : "s"}</p>
            </div>

            <div className="space-y-3 px-4 py-4">
              {targets.map((target) => {
                const actual = actualForTarget(exercise, target);
                const isCurrent = currentTarget?.scheduledWorkoutPlannedSetId === target.scheduledWorkoutPlannedSetId;
                const key = plannedFormKey(target);
                const initial = formForPlannedSet(target);
                const form = getForm(key, initial);

                if (actual !== undefined) return <article key={target.scheduledWorkoutPlannedSetId} className="rounded-2xl border border-emerald-200 bg-emerald-50/50 px-4 py-4">
                  <CardHeading position={target.position} total={targets.length} status="Completed" statusClass="bg-emerald-100 text-emerald-800" />
                  <Detail label="Target" value={targetSummary(target)} />
                  <Detail label="Actual" value={actualSummary(actual)} />
                  <p className="mt-2 text-xs font-medium text-emerald-800">Logged #{actual.setNumber}</p>
                </article>;

                if (isCurrent) return <article key={target.scheduledWorkoutPlannedSetId} className="rounded-2xl border-2 border-teal-600 bg-teal-50/60 px-4 py-4 shadow-sm">
                  <CardHeading position={target.position} total={targets.length} status="Next" statusClass="bg-teal-600 text-white" />
                  <Detail label="Target" value={targetSummary(target)} />
                  <SetLogFields form={form} onChange={(patch) => updateForm(key, initial, patch)} textPrescription={target.prescriptionNote !== undefined} />
                  {form.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{form.error}</p>}
                  <button type="button" onClick={() => handleLogSet(exercise, "PLANNED", target)} disabled={form.submitting} className="mt-4 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50">{form.submitting ? "Logging set…" : "Log Set"}</button>
                </article>;

                return <article key={target.scheduledWorkoutPlannedSetId} className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                  <CardHeading position={target.position} total={targets.length} status="Not logged" statusClass="bg-slate-100 text-slate-600" />
                  <Detail label="Target" value={targetSummary(target)} />
                  {isActive && <button type="button" onClick={() => setSelectedTargets((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: target.scheduledWorkoutPlannedSetId }))} className="mt-3 min-h-11 rounded-xl px-3 text-sm font-bold text-teal-700 hover:bg-teal-50">Log this set instead</button>}
                </article>;
              })}
            </div>

            <div className="border-t border-slate-100 px-5 py-5">
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Extra sets</p><span className="text-sm font-semibold text-slate-500">{extras.length}</span></div>
              {extras.length > 0 && <ul className="mt-3 space-y-2">{extras.map((log) => <li key={log.id} className="rounded-2xl bg-stone-50 px-4 py-3"><p className="text-xs font-bold uppercase tracking-wide text-slate-500">Extra · Logged #{log.setNumber}</p><p className="mt-1 text-sm font-semibold text-slate-800">{actualSummary(log)}</p></li>)}</ul>}
              {isActive && <div className="mt-4">
                {!showExtraForm ? <button type="button" onClick={() => setExtraOpen((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: true }))} className={`min-h-12 w-full rounded-2xl px-4 text-sm font-bold ${currentTarget === undefined ? "bg-slate-950 text-white hover:bg-slate-800" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}>Add Extra Set</button> :
                  <div className="rounded-2xl border border-slate-200 bg-stone-50 p-4">
                    <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-900">Add Extra Set</p><button type="button" onClick={() => setExtraOpen((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: false }))} className="min-h-11 px-2 text-sm font-bold text-slate-600">Close</button></div>
                    <SetLogFields form={extraForm} onChange={(patch) => updateForm(extraKey, extraInitial, patch)} />
                    {extraForm.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{extraForm.error}</p>}
                    <button type="button" onClick={() => handleLogSet(exercise, "EXTRA")} disabled={extraForm.submitting} className="mt-4 min-h-14 w-full rounded-2xl bg-slate-950 px-5 text-base font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50">{extraForm.submitting ? "Logging set…" : "Log Extra Set"}</button>
                  </div>}
              </div>}
            </div>
          </section>;
        })}

        {isActive && <section className="pt-2"><p className="mb-3 px-1 text-sm leading-6 text-slate-500">When training is finished, complete the workout to lock in these results.</p>{completeError && <p role="alert" className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{completeError}</p>}<button type="button" onClick={handleComplete} disabled={completing} className="min-h-14 w-full rounded-2xl border border-slate-300 bg-white px-5 text-base font-bold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50">{completing ? "Completing workout…" : "Complete Workout"}</button></section>}
      </div>
    </main>
  );
}

function CardHeading({ position, total, status, statusClass }: { position: number; total: number; status: string; statusClass: string }) {
  return <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-600">Set {position} of {total}</p><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${statusClass}`}>{status}</span></div>;
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="mt-3"><p className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</p><p className="mt-1 break-words text-sm font-semibold text-slate-800">{value}</p></div>;
}

function SetLogFields({ form, onChange, textPrescription = false }: { form: SetLogFormState; onChange: (patch: Partial<SetLogFormState>) => void; textPrescription?: boolean }) {
  return <div className="mt-4">
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
      <Field label="Load" optional><input type="number" inputMode="decimal" value={form.load} onChange={(event) => onChange({ load: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
      <Field label="Unit"><select value={form.unit} onChange={(event) => onChange({ unit: event.target.value as "kg" | "lb" })} disabled={form.load.trim() === ""} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="kg">kg</option><option value="lb">lb</option></select></Field>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <Field label="Reps"><input type="number" inputMode="numeric" value={form.reps} onChange={(event) => onChange({ reps: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
      <Field label="Actual RPE" optional><input type="number" inputMode="decimal" value={form.rpe} onChange={(event) => onChange({ rpe: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
    </div>
    {textPrescription && <p className="mt-3 text-sm leading-5 text-slate-600">Record the numeric reps completed.</p>}
  </div>;
}

function Field({ children, label, optional = false }: { children: ReactNode; label: string; optional?: boolean }) {
  return <label className="min-w-0"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}{optional && <span className="ml-1 font-normal text-slate-400">optional</span>}</span>{children}</label>;
}
