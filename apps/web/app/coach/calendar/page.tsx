"use client";

// Coach's primary pilot screen: pick a date, assign an existing Workout to
// one or more connected Athletes, and jump into a live session to log sets
// on the Athlete's behalf. Mobile-first, single-date view — no month
// calendar (see docs/frontend-ui-spec.md / pilot brief).
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

type Athlete = { id: string; name: string };

type Workout = { id: string; name: string };

type Session = { id: string; status: "ACTIVE" | "COMPLETED" };

type ScheduledWorkoutSummary = {
  id: string;
  scheduledDate: string;
  athlete: { id: string; name: string };
  workout: { id: string; name: string };
  session: Session | null;
};

// Local calendar date, not UTC — new Date().toISOString().slice(0, 10) can
// land on the wrong day in Taiwan (UTC+8) near midnight.
function todayLocalISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function CoachCalendarPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();

  const [date, setDate] = useState(todayLocalISODate);

  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [assignments, setAssignments] = useState<
    ScheduledWorkoutSummary[] | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const assignmentInFlight = useRef(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState(false);

  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  // Redirect unauthenticated users once auth state has settled.
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/login");
    }
  }, [authLoading, user, router]);

  // Athletes + workouts: load once auth is ready.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;

    (async () => {
      try {
        const [athletesRes, workoutsRes] = await Promise.all([
          apiFetch<Athlete[]>(idToken, "/api/v1/athletes"),
          apiFetch<Workout[]>(idToken, "/api/v1/workouts"),
        ]);
        if (cancelled) return;
        setAthletes(athletesRes);
        setWorkouts(workoutsRes);
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idToken]);

  // Assignments for the selected date: reload whenever the date changes.
  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await apiFetch<ScheduledWorkoutSummary[]>(
          idToken,
          `/api/v1/scheduled-workouts?from=${date}&to=${date}`,
        );
        if (cancelled) return;
        setAssignments(res);
      } catch (err) {
        if (cancelled) return;
        setLoadError(errorMessage(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [idToken, date]);

  async function refetchAssignments() {
    if (!idToken) return;
    try {
      const res = await apiFetch<ScheduledWorkoutSummary[]>(
        idToken,
        `/api/v1/scheduled-workouts?from=${date}&to=${date}`,
      );
      setAssignments(res);
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleAssign() {
    if (
      assignmentInFlight.current ||
      !idToken ||
      !selectedWorkoutId ||
      selectedAthleteIds.length === 0
    ) {
      return;
    }
    assignmentInFlight.current = true;
    setAssigning(true);
    setAssignError(null);
    setAssignSuccess(false);
    try {
      await apiFetch(idToken, "/api/v1/scheduled-workouts", {
        method: "POST",
        body: {
          workoutId: selectedWorkoutId,
          athleteIds: selectedAthleteIds,
          scheduledDate: date,
        },
      });
      setSelectedAthleteIds([]);
      setAssignSuccess(true);
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

  if (authLoading || (user && !idToken)) {
    return <main className="p-4">Loading…</main>;
  }

  if (!user) {
    // Redirect effect above will navigate away; render nothing meanwhile.
    return null;
  }

  return (
    <main className="mx-auto flex max-w-lg flex-col gap-6 p-4 pb-24">
      <h1 className="text-xl font-semibold">Coach Calendar</h1>

      <label className="flex flex-col gap-1 text-sm">
        Date
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded border border-black/20 px-3 py-2 text-base dark:border-white/20"
        />
      </label>

      {loadError && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {loadError}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded border border-black/10 p-3 dark:border-white/10">
        <h2 className="font-medium">Assign Workout</h2>

        {workouts === null ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            Loading workouts…
          </p>
        ) : workouts.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No workouts available
          </p>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            Workout
            <select
              value={selectedWorkoutId}
              onChange={(e) => setSelectedWorkoutId(e.target.value)}
              className="rounded border border-black/20 px-3 py-2 text-base dark:border-white/20"
            >
              <option value="">Select a workout…</option>
              {workouts.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {athletes === null ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            Loading athletes…
          </p>
        ) : athletes.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No connected athletes
          </p>
        ) : (
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">Athletes</legend>
            {athletes.map((a) => (
              <label
                key={a.id}
                className="flex items-center gap-2 text-base"
              >
                <input
                  type="checkbox"
                  className="h-5 w-5"
                  checked={selectedAthleteIds.includes(a.id)}
                  onChange={() => toggleAthlete(a.id)}
                />
                {a.name}
              </label>
            ))}
          </fieldset>
        )}

        {assignError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {assignError}
          </p>
        )}
        {assignSuccess && (
          <p className="text-sm text-green-700 dark:text-green-400">
            Assigned.
          </p>
        )}

        <button
          type="button"
          onClick={handleAssign}
          disabled={
            assigning ||
            !selectedWorkoutId ||
            selectedAthleteIds.length === 0
          }
          className="rounded bg-foreground px-4 py-3 text-base text-background disabled:opacity-50"
        >
          {assigning ? "Assigning…" : "Assign"}
        </button>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-medium">Assignments for {date}</h2>

        {startError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {startError}
          </p>
        )}

        {assignments === null ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            Loading…
          </p>
        ) : assignments.length === 0 ? (
          <p className="text-sm text-black/60 dark:text-white/60">
            No assignments for this date
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {assignments.map((a) => (
              <li
                key={a.id}
                className="flex flex-col gap-2 rounded border border-black/10 p-3 dark:border-white/10"
              >
                <div className="text-base font-medium">{a.athlete.name}</div>
                <div className="text-sm text-black/70 dark:text-white/70">
                  {a.workout.name}
                </div>

                {a.session === null && (
                  <button
                    type="button"
                    onClick={() => handleStart(a.id)}
                    disabled={startingId === a.id}
                    className="rounded bg-foreground px-4 py-3 text-base text-background disabled:opacity-50"
                  >
                    {startingId === a.id ? "Starting…" : "Start Session"}
                  </button>
                )}

                {a.session?.status === "ACTIVE" && (
                  <button
                    type="button"
                    onClick={() => router.push(`/session/${a.session!.id}`)}
                    className="rounded bg-foreground px-4 py-3 text-base text-background"
                  >
                    Resume
                  </button>
                )}

                {a.session?.status === "COMPLETED" && (
                  <button
                    type="button"
                    onClick={() => router.push(`/session/${a.session!.id}`)}
                    className="rounded border border-black/20 px-4 py-3 text-base dark:border-white/20"
                  >
                    Review
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return "Something went wrong. Please try again.";
}
