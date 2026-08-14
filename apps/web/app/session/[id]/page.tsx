"use client";

// Shared Training Session screen for both Coach and Athlete — one screen,
// backend authorization decides who may view/act on it (see
// docs/frontend-ui-spec.md). ACTIVE sessions get manual set-logging forms
// and a Complete button; COMPLETED sessions are read-only (plan + actual).
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

type Plan = {
  sets: number;
  reps?: number;
  prescriptionNote?: string;
  rpe?: number;
};

type SetLog = {
  id: string;
  setNumber: number;
  load?: number;
  unit?: "kg" | "lb";
  reps: number;
  rpe?: number;
  loggedByUserId: string;
};

type SessionExercise = {
  scheduledWorkoutExerciseId: string;
  name: string;
  plan: Plan;
  setLogs: SetLog[];
};

type SessionDetail = {
  id: string;
  status: "ACTIVE" | "COMPLETED";
  athlete: { id: string; name: string };
  exercises: SessionExercise[];
};

function planSummary(plan: Plan): string {
  const parts = [`${plan.sets} sets`];
  if (plan.reps !== undefined) {
    parts.push(`${plan.reps} reps`);
  } else if (plan.prescriptionNote) {
    parts.push(plan.prescriptionNote);
  }
  if (plan.rpe !== undefined) {
    parts.push(`RPE ${plan.rpe}`);
  }
  return parts.join(" · ");
}

function setLogSummary(log: SetLog): string {
  const parts = [`Set ${log.setNumber}`];
  if (log.load !== undefined && log.unit) {
    parts.push(`${log.load} ${log.unit}`);
  }
  parts.push(`× ${log.reps}`);
  if (log.rpe !== undefined) {
    parts.push(`RPE ${log.rpe}`);
  }
  return parts.join(" ");
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}

type SetLogFormState = {
  load: string;
  unit: "kg" | "lb";
  reps: string;
  rpe: string;
  submitting: boolean;
  error: string | null;
};

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
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  async function fetchSession(): Promise<SessionDetail | undefined> {
    if (!idToken) return undefined;
    const res = await apiFetch<SessionDetail>(
      idToken,
      `/api/v1/sessions/${sessionId}`,
    );
    setSession(res);
    return res;
  }

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch<SessionDetail>(
          idToken,
          `/api/v1/sessions/${sessionId}`,
        );
        if (cancelled) return;
        setSession(res);
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorMessage(err));
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
    setForms((prev) => ({
      ...prev,
      [exerciseId]: { ...getForm(exerciseId), ...patch },
    }));
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

    const body: Record<string, unknown> = {
      scheduledWorkoutExerciseId: exerciseId,
      reps: repsNum,
    };
    if (load !== undefined) {
      body.load = load;
      body.unit = form.unit;
    }
    if (rpe !== undefined) {
      body.rpe = rpe;
    }

    updateForm(exerciseId, { submitting: true, error: null });
    try {
      await apiFetch(idToken, `/api/v1/sessions/${sessionId}/set-logs`, {
        method: "POST",
        body,
      });
      setForms((prev) => ({ ...prev, [exerciseId]: emptyForm() }));
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
      await apiFetch(idToken, `/api/v1/sessions/${sessionId}/complete`, {
        method: "POST",
      });
      await fetchSession();
    } catch (err) {
      setCompleteError(errorMessage(err));
    } finally {
      setCompleting(false);
    }
  }

  if (authLoading || (user && !idToken)) {
    return <main className="p-4">Loading…</main>;
  }

  if (!user) {
    return null;
  }

  if (loadError) {
    return (
      <main className="p-4">
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      </main>
    );
  }

  if (!session) {
    return <main className="p-4">Loading…</main>;
  }

  const isActive = session.status === "ACTIVE";

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4 pb-24">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{session.athlete.name}</h1>
        <p className="text-sm text-black/70 dark:text-white/70">
          Status: {session.status}
        </p>
      </div>

      <ul className="flex flex-col gap-4">
        {session.exercises.map((ex) => {
          const form = getForm(ex.scheduledWorkoutExerciseId);
          return (
            <li
              key={ex.scheduledWorkoutExerciseId}
              className="flex flex-col gap-3 rounded border border-black/10 p-3 dark:border-white/10"
            >
              <div className="text-lg font-medium">{ex.name}</div>
              <div className="text-sm text-black/70 dark:text-white/70">
                Plan: {planSummary(ex.plan)}
              </div>

              {ex.setLogs.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {ex.setLogs.map((log) => (
                    <li key={log.id} className="text-sm">
                      {setLogSummary(log)}
                    </li>
                  ))}
                </ul>
              )}

              {isActive && (
                <div className="flex flex-col gap-2 border-t border-black/10 pt-3 dark:border-white/10">
                  <div className="flex gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      Load (optional)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={form.load}
                        onChange={(e) =>
                          updateForm(ex.scheduledWorkoutExerciseId, {
                            load: e.target.value,
                          })
                        }
                        className="rounded border border-black/20 px-3 py-2 text-base dark:border-white/20"
                      />
                    </label>
                    <label className="flex w-24 flex-col gap-1 text-sm">
                      Unit
                      <select
                        value={form.unit}
                        onChange={(e) =>
                          updateForm(ex.scheduledWorkoutExerciseId, {
                            unit: e.target.value as "kg" | "lb",
                          })
                        }
                        disabled={form.load.trim() === ""}
                        className="rounded border border-black/20 px-3 py-2 text-base disabled:opacity-50 dark:border-white/20"
                      >
                        <option value="kg">kg</option>
                        <option value="lb">lb</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex gap-2">
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      Reps
                      <input
                        type="number"
                        inputMode="numeric"
                        value={form.reps}
                        onChange={(e) =>
                          updateForm(ex.scheduledWorkoutExerciseId, {
                            reps: e.target.value,
                          })
                        }
                        className="rounded border border-black/20 px-3 py-2 text-base dark:border-white/20"
                      />
                    </label>
                    <label className="flex flex-1 flex-col gap-1 text-sm">
                      RPE (optional)
                      <input
                        type="number"
                        inputMode="decimal"
                        value={form.rpe}
                        onChange={(e) =>
                          updateForm(ex.scheduledWorkoutExerciseId, {
                            rpe: e.target.value,
                          })
                        }
                        className="rounded border border-black/20 px-3 py-2 text-base dark:border-white/20"
                      />
                    </label>
                  </div>

                  {form.error && (
                    <p
                      role="alert"
                      className="text-sm text-red-600 dark:text-red-400"
                    >
                      {form.error}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => handleLogSet(ex.scheduledWorkoutExerciseId)}
                    disabled={form.submitting}
                    className="rounded bg-foreground px-4 py-3 text-base text-background disabled:opacity-50"
                  >
                    {form.submitting ? "Logging…" : "Log Set"}
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {isActive && (
        <div className="flex flex-col gap-2">
          {completeError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {completeError}
            </p>
          )}
          <button
            type="button"
            onClick={handleComplete}
            disabled={completing}
            className="rounded bg-foreground px-4 py-4 text-base font-medium text-background disabled:opacity-50"
          >
            {completing ? "Completing…" : "Complete Workout"}
          </button>
        </div>
      )}
    </main>
  );
}
