"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

type Plan = { sets: number; reps?: number; prescriptionNote?: string; rpe?: number };
type SetLog = { id: string; setNumber: number; load?: number; unit?: "kg" | "lb"; reps: number; rpe?: number; loggedByUserId: string };
type SessionExercise = { scheduledWorkoutExerciseId: string; name: string; plan: Plan; setLogs: SetLog[] };
type SessionDetail = { id: string; status: "ACTIVE" | "COMPLETED"; athlete: { id: string; name: string }; exercises: SessionExercise[] };
type SetLogFormState = { load: string; unit: "kg" | "lb"; reps: string; rpe: string; submitting: boolean; error: string | null };

function planSummary(plan: Plan): string {
  const prescription = plan.reps === undefined ? plan.prescriptionNote ?? "" : `${plan.sets} × ${plan.reps}`;
  return [prescription, plan.rpe === undefined ? "" : `Target RPE ${plan.rpe}`].filter(Boolean).join(" · ");
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}

function emptyForm(): SetLogFormState {
  return { load: "", unit: "kg", reps: "", rpe: "", submitting: false, error: null };
}

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, SetLogFormState>>({});
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  async function fetchSession(): Promise<SessionDetail | undefined> {
    if (!idToken) return undefined;
    const response = await apiFetch<SessionDetail>(idToken, `/api/v1/sessions/${sessionId}`);
    setSession(response);
    return response;
  }

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch<SessionDetail>(idToken, `/api/v1/sessions/${sessionId}`);
        if (!cancelled) setSession(response);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, sessionId]);

  function getForm(exerciseId: string): SetLogFormState {
    return forms[exerciseId] ?? emptyForm();
  }

  function updateForm(exerciseId: string, patch: Partial<SetLogFormState>) {
    setForms((previous) => ({ ...previous, [exerciseId]: { ...getForm(exerciseId), ...patch } }));
  }

  async function handleLogSet(exerciseId: string) {
    if (!idToken) return;
    const form = getForm(exerciseId);
    if (form.submitting) return;
    const repsNum = Number(form.reps);
    if (form.reps.trim() === "" || !Number.isInteger(repsNum) || repsNum < 1) {
      updateForm(exerciseId, { error: "Reps must be a whole number ≥ 1." });
      return;
    }
    let load: number | undefined;
    if (form.load.trim() !== "") {
      const loadNum = Number(form.load);
      if (Number.isNaN(loadNum) || loadNum < 0) {
        updateForm(exerciseId, { error: "Load must be a number ≥ 0." });
        return;
      }
      load = loadNum;
    }
    let rpe: number | undefined;
    if (form.rpe.trim() !== "") {
      const rpeNum = Number(form.rpe);
      if (Number.isNaN(rpeNum) || rpeNum < 1 || rpeNum > 10) {
        updateForm(exerciseId, { error: "RPE must be between 1 and 10." });
        return;
      }
      rpe = rpeNum;
    }
    const body: Record<string, unknown> = { scheduledWorkoutExerciseId: exerciseId, reps: repsNum };
    if (load !== undefined) {
      body.load = load;
      body.unit = form.unit;
    }
    if (rpe !== undefined) body.rpe = rpe;
    updateForm(exerciseId, { submitting: true, error: null });
    try {
      await apiFetch(idToken, `/api/v1/sessions/${sessionId}/set-logs`, { method: "POST", body });
      setForms((previous) => ({ ...previous, [exerciseId]: emptyForm() }));
      await fetchSession();
    } catch (err) {
      updateForm(exerciseId, { submitting: false, error: errorMessage(err) });
    }
  }

  async function handleComplete() {
    if (!idToken || completing) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await apiFetch(idToken, `/api/v1/sessions/${sessionId}/complete`, { method: "POST" });
      await fetchSession();
    } catch (err) {
      setCompleteError(errorMessage(err));
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
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold tracking-wide ${isActive ? "bg-teal-400 text-slate-950" : "bg-emerald-400 text-emerald-950"}`}>{session.status}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        {session.exercises.map((exercise) => {
          const form = getForm(exercise.scheduledWorkoutExerciseId);
          return (
            <section key={exercise.scheduledWorkoutExerciseId} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5">
              <div className="border-b border-slate-100 px-5 py-5">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Exercise</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight">{exercise.name}</h2>
                <p className="mt-2 text-base font-medium text-slate-600">{planSummary(exercise.plan)}</p>
              </div>

              <div className="px-5 py-5">
                <div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Completed sets</p><span className="text-sm font-semibold text-slate-500">{exercise.setLogs.length} logged</span></div>
                {exercise.setLogs.length === 0 ? (
                  <p className="mt-3 rounded-2xl bg-stone-50 px-4 py-3 text-sm text-slate-500">No sets logged yet.</p>
                ) : (
                  <ul className="mt-3 overflow-hidden rounded-2xl border border-slate-100">
                    <li className="grid grid-cols-[.75fr_1.35fr_.8fr_.7fr] gap-1 bg-stone-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500"><span>Set</span><span>Load</span><span>Reps</span><span>RPE</span></li>
                    {exercise.setLogs.map((log) => <li key={log.id} className="grid grid-cols-[.75fr_1.35fr_.8fr_.7fr] gap-1 border-t border-slate-100 px-3 py-3 text-sm font-semibold"><span>{log.setNumber}</span><span>{log.load === undefined ? "Bodyweight" : `${log.load} ${log.unit}`}</span><span>{log.reps}</span><span>{log.rpe ?? "—"}</span></li>)}
                  </ul>
                )}
              </div>

              {isActive && (
                <div className="border-t border-slate-100 bg-stone-50 px-5 py-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Log next set</p>
                  <div className="mt-4 grid grid-cols-[minmax(0,1fr)_6.5rem] gap-3">
                    <Field label="Load" optional><input type="number" inputMode="decimal" value={form.load} onChange={(event) => updateForm(exercise.scheduledWorkoutExerciseId, { load: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
                    <Field label="Unit"><select value={form.unit} onChange={(event) => updateForm(exercise.scheduledWorkoutExerciseId, { unit: event.target.value as "kg" | "lb" })} disabled={form.load.trim() === ""} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="kg">kg</option><option value="lb">lb</option></select></Field>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Reps"><input type="number" inputMode="numeric" value={form.reps} onChange={(event) => updateForm(exercise.scheduledWorkoutExerciseId, { reps: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
                    <Field label="RPE" optional><input type="number" inputMode="decimal" value={form.rpe} onChange={(event) => updateForm(exercise.scheduledWorkoutExerciseId, { rpe: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
                  </div>
                  {form.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{form.error}</p>}
                  <button type="button" onClick={() => handleLogSet(exercise.scheduledWorkoutExerciseId)} disabled={form.submitting} className="mt-4 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50">{form.submitting ? "Logging set…" : "Log Set"}</button>
                </div>
              )}
            </section>
          );
        })}

        {isActive && <section className="pt-2"><p className="mb-3 px-1 text-sm leading-6 text-slate-500">When training is finished, complete the workout to lock in these results.</p>{completeError && <p role="alert" className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{completeError}</p>}<button type="button" onClick={handleComplete} disabled={completing} className="min-h-14 w-full rounded-2xl border border-slate-300 bg-white px-5 text-base font-bold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50">{completing ? "Completing workout…" : "Complete Workout"}</button></section>}
      </div>
    </main>
  );
}

function Field({ children, label, optional = false }: { children: ReactNode; label: string; optional?: boolean }) {
  return <label className="min-w-0"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}{optional && <span className="ml-1 font-normal text-slate-400">optional</span>}</span>{children}</label>;
}
