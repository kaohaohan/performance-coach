"use client";

// Athlete's only real destination in the pilot: today's scheduled
// workout(s) and a way into the shared session screen to start/resume/log.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

type Plan = {
  sets: number;
  reps?: number;
  prescriptionNote?: string;
  rpe?: number;
};

type ExerciseSummary = {
  scheduledWorkoutExerciseId: string;
  exerciseId: string;
  name: string;
  plan: Plan;
  position: number;
};

type Session = { id: string; status: "ACTIVE" | "COMPLETED" };

type TodayScheduledWorkout = {
  id: string;
  scheduledDate: string;
  workoutName: string;
  exercises: ExerciseSummary[];
  session: Session | null;
};

// Local calendar date, not UTC — see coach/calendar/page.tsx for why
// toISOString().slice(0, 10) is wrong here (Taiwan is UTC+8).
function todayLocalISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}

export default function AthleteTodayPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();

  const [date] = useState(todayLocalISODate);
  const [workouts, setWorkouts] = useState<TodayScheduledWorkout[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch<TodayScheduledWorkout[]>(
          idToken,
          `/api/v1/me/scheduled-workouts?date=${date}`,
        );
        if (cancelled) return;
        setWorkouts(res);
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idToken, date]);

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

  if (authLoading || (user && !idToken)) {
    return <main className="p-4">Loading…</main>;
  }

  if (!user) {
    return null;
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4 pb-24">
      <h1 className="text-xl font-semibold">Today</h1>

      {loadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}
      {startError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {startError}
        </p>
      )}

      {workouts === null ? (
        <p className="text-sm text-black/60 dark:text-white/60">Loading…</p>
      ) : workouts.length === 0 ? (
        <p className="text-sm text-black/60 dark:text-white/60">
          No workout scheduled for today
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {workouts.map((w) => (
            <li
              key={w.id}
              className="flex flex-col gap-3 rounded border border-black/10 p-3 dark:border-white/10"
            >
              <div className="text-lg font-medium">{w.workoutName}</div>

              <ul className="flex flex-col gap-1">
                {w.exercises.map((ex) => (
                  <li key={ex.scheduledWorkoutExerciseId} className="text-sm">
                    <span className="font-medium">{ex.name}</span>{" "}
                    <span className="text-black/70 dark:text-white/70">
                      {planSummary(ex.plan)}
                    </span>
                  </li>
                ))}
              </ul>

              {w.session === null && (
                <button
                  type="button"
                  onClick={() => handleStart(w.id)}
                  disabled={startingId === w.id}
                  className="rounded bg-foreground px-4 py-3 text-base text-background disabled:opacity-50"
                >
                  {startingId === w.id ? "Starting…" : "Start Workout"}
                </button>
              )}

              {w.session?.status === "ACTIVE" && (
                <button
                  type="button"
                  onClick={() => router.push(`/session/${w.session!.id}`)}
                  className="rounded bg-foreground px-4 py-3 text-base text-background"
                >
                  Resume
                </button>
              )}

              {w.session?.status === "COMPLETED" && (
                <button
                  type="button"
                  onClick={() => router.push(`/session/${w.session!.id}`)}
                  className="rounded border border-black/20 px-4 py-3 text-base dark:border-white/20"
                >
                  View Result
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
