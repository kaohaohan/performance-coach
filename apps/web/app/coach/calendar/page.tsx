"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";

type Athlete = { id: string; name: string };
type Workout = { id: string; name: string };
type Session = { id: string; status: "ACTIVE" | "COMPLETED" };
type ScheduledWorkoutSummary = {
  id: string;
  scheduledDate: string;
  athlete: Athlete;
  workout: Workout;
  session: Session | null;
};

function todayLocalISODate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00`));
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

export default function CoachCalendarPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const [date, setDate] = useState(todayLocalISODate);
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [workouts, setWorkouts] = useState<Workout[] | null>(null);
  const [assignments, setAssignments] = useState<ScheduledWorkoutSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedWorkoutId, setSelectedWorkoutId] = useState("");
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [assigning, setAssigning] = useState(false);
  const assignmentInFlight = useRef(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignSuccess, setAssignSuccess] = useState(false);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const [athletesRes, workoutsRes] = await Promise.all([
          apiFetch<Athlete[]>(idToken, "/api/v1/athletes"),
          apiFetch<Workout[]>(idToken, "/api/v1/workouts"),
        ]);
        if (!cancelled) {
          setAthletes(athletesRes);
          setWorkouts(workoutsRes);
        }
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch<ScheduledWorkoutSummary[]>(
          idToken,
          `/api/v1/scheduled-workouts?from=${date}&to=${date}`,
        );
        if (!cancelled) setAssignments(res);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, date]);

  async function refetchAssignments() {
    if (!idToken) return;
    try {
      setAssignments(
        await apiFetch<ScheduledWorkoutSummary[]>(
          idToken,
          `/api/v1/scheduled-workouts?from=${date}&to=${date}`,
        ),
      );
    } catch (err) {
      setLoadError(errorMessage(err));
    }
  }

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id],
    );
  }

  async function handleAssign() {
    if (assignmentInFlight.current || !idToken || !selectedWorkoutId || selectedAthleteIds.length === 0) return;
    assignmentInFlight.current = true;
    setAssigning(true);
    setAssignError(null);
    setAssignSuccess(false);
    try {
      await apiFetch(idToken, "/api/v1/scheduled-workouts", {
        method: "POST",
        body: { workoutId: selectedWorkoutId, athleteIds: selectedAthleteIds, scheduledDate: date },
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

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  if (!user) return null;

  const selectedCount = selectedAthleteIds.length;

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-lg">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">Performance Coach</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Coach Workspace</h1>
          <p className="mt-2 text-sm text-slate-300">{displayDate(date)}</p>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-6 px-4">
        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Calendar date</p>
              <p className="mt-1 text-lg font-semibold">{displayDate(date)}</p>
            </div>
            <label className="shrink-0">
              <span className="sr-only">Calendar date</span>
              <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-xl border border-slate-200 bg-stone-50 px-3 py-2 text-sm font-medium text-slate-700 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" />
            </label>
          </div>
        </section>

        {loadError && <Notice tone="error">{loadError}</Notice>}

        <section className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Athletes</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Who are you coaching?</h2>
            </div>
            {selectedCount > 0 && <span className="rounded-full bg-teal-50 px-3 py-1 text-xs font-bold text-teal-700">{selectedCount} selected</span>}
          </div>

          {athletes === null ? <LoadingCard label="Loading athletes…" /> : athletes.length === 0 ? <EmptyCard title="No connected athletes" body="Connect an athlete before assigning training." /> : (
            <fieldset className="mt-4 grid gap-2">
              <legend className="sr-only">Athletes</legend>
              {athletes.map((athlete) => {
                const selected = selectedAthleteIds.includes(athlete.id);
                return (
                  <label key={athlete.id} className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border p-3 transition ${selected ? "border-teal-600 bg-teal-50" : "border-slate-200 bg-white hover:border-slate-300"}`}>
                    <input type="checkbox" checked={selected} onChange={() => toggleAthlete(athlete.id)} className="sr-only" />
                    <span className={`grid h-10 w-10 place-items-center rounded-full text-sm font-bold ${selected ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600"}`}>{initials(athlete.name)}</span>
                    <span className="flex-1 font-semibold">{athlete.name}</span>
                    <span aria-hidden="true" className={`grid h-6 w-6 place-items-center rounded-full border text-sm font-bold ${selected ? "border-teal-600 bg-teal-600 text-white" : "border-slate-300 text-transparent"}`}>✓</span>
                  </label>
                );
              })}
            </fieldset>
          )}

          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Workout</p>
            {workouts === null ? <div className="mt-3"><LoadingCard label="Loading workouts…" /></div> : workouts.length === 0 ? <div className="mt-3"><EmptyCard title="No workouts available" body="Create a workout template before scheduling training." /></div> : (
              <label className="mt-3 block">
                <span className="sr-only">Workout</span>
                <select value={selectedWorkoutId} onChange={(event) => setSelectedWorkoutId(event.target.value)} className="min-h-14 w-full rounded-2xl border border-slate-200 bg-stone-50 px-4 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15">
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
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between gap-4 px-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Today&apos;s athletes</p>
              <h2 className="mt-1 text-xl font-semibold tracking-tight">Scheduled training</h2>
            </div>
            {assignments && <span className="text-sm font-medium text-slate-500">{assignments.length} scheduled</span>}
          </div>
          {startError && <div className="mb-3"><Notice tone="error">{startError}</Notice></div>}
          {assignments === null ? <LoadingCard label="Loading scheduled training…" /> : assignments.length === 0 ? <EmptyCard title="No training scheduled" body="Choose athletes and a workout above to place training on this day." /> : (
            <ul className="grid gap-3">
              {assignments.map((assignment) => (
                <li key={assignment.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
                  <div className="flex items-start gap-3">
                    <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-slate-950 text-sm font-bold text-white">{initials(assignment.athlete.name)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{assignment.athlete.name}</p>
                      <p className="mt-1 text-lg font-semibold tracking-tight">{assignment.workout.name}</p>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${statusClass(assignment.session)}`}>{statusLabel(assignment.session)}</span>
                  </div>
                  <div className="mt-5 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
                    <p className="text-sm text-slate-500">{assignment.session ? "This athlete’s training session" : "Ready to begin this athlete’s session"}</p>
                    {assignment.session === null ? (
                      <button type="button" onClick={() => handleStart(assignment.id)} disabled={startingId === assignment.id} className="min-h-11 shrink-0 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50">{startingId === assignment.id ? "Starting…" : "Start Session"}</button>
                    ) : (
                      <button type="button" onClick={() => router.push(`/session/${assignment.session!.id}`)} className="min-h-11 shrink-0 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white">{assignment.session.status === "ACTIVE" ? "Resume" : "Review"}</button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
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

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}
