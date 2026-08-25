"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch, ApiError } from "@/lib/api";
import SignOutButton from "@/components/sign-out-button";

type PlannedSet = {
  scheduledWorkoutPlannedSetId: string;
  position: number;
  reps?: number;
  prescriptionNote?: string;
  load?: number;
  unit?: "kg" | "lb";
  rpe?: number;
};
type Plan = { sets: PlannedSet[] };
type ExerciseSummary = { scheduledWorkoutExerciseId: string; exerciseId: string; name: string; plan: Plan; position: number };
type Session = { id: string; status: "ACTIVE" | "COMPLETED" };
type TodayScheduledWorkout = { id: string; scheduledDate: string; workoutName: string; exercises: ExerciseSummary[]; session: Session | null };

function todayLocalISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function displayDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date(`${date}T00:00:00`));
}

function shiftLocalDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(year, month - 1, day + days);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}

function orderedPlannedSets(plan: Plan): PlannedSet[] {
  return [...plan.sets].sort((left, right) => left.position - right.position);
}

function plannedSetSummary(target: PlannedSet): string {
  const parts = [target.reps === undefined ? target.prescriptionNote ?? "" : `${target.reps} reps`];
  if (target.load !== undefined) parts.push(target.unit === undefined ? `${target.load}` : `${target.load} ${target.unit}`);
  if (target.rpe !== undefined) parts.push(`RPE ${target.rpe}`);
  return parts.filter(Boolean).join(" · ");
}

function samePrescription(left: PlannedSet, right: PlannedSet): boolean {
  return left.reps === right.reps
    && left.prescriptionNote === right.prescriptionNote
    && left.load === right.load
    && left.unit === right.unit
    && left.rpe === right.rpe;
}

function PlannedSetPreview({ plan }: { plan: Plan }) {
  const targets = orderedPlannedSets(plan);
  if (targets.length === 0) return <p className="mt-1 text-sm font-medium text-slate-500">No planned sets</p>;

  const uniform = targets.every((target) => samePrescription(targets[0], target));
  if (uniform) return <div className="mt-2">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{targets.length} set{targets.length === 1 ? "" : "s"}</p>
    <p className="mt-1 text-base font-medium leading-6 text-slate-600">{plannedSetSummary(targets[0])}</p>
  </div>;

  return <div className="mt-2">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{targets.length} planned sets</p>
    <ol className="mt-2 space-y-1.5">
      {targets.map((target) => <li key={target.scheduledWorkoutPlannedSetId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-sm leading-5">
        <span className="font-bold text-slate-700">Set {target.position}</span>
        <span className="min-w-0 font-medium text-slate-600">{plannedSetSummary(target)}</span>
      </li>)}
    </ol>
  </div>;
}

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Something went wrong. Please try again.";
}

export default function AthleteTodayPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const today = todayLocalISODate();
  const [selectedDate, setSelectedDate] = useState(today);
  const [workouts, setWorkouts] = useState<TodayScheduledWorkout[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        const response = await apiFetch<TodayScheduledWorkout[]>(idToken, `/api/v1/me/scheduled-workouts?date=${selectedDate}`);
        if (!cancelled) setWorkouts(response);
      } catch (err) {
        if (!cancelled) setLoadError(errorMessage(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, selectedDate]);

  async function handleStart(scheduledWorkoutId: string) {
    if (!idToken || startingId) return;
    setStartingId(scheduledWorkoutId);
    setStartError(null);
    try {
      const session = await apiFetch<{ id: string; status: string }>(idToken, `/api/v1/scheduled-workouts/${scheduledWorkoutId}/session`, { method: "POST" });
      router.push(`/session/${session.id}`);
    } catch (err) {
      setStartError(errorMessage(err));
      setStartingId(null);
    }
  }

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">Loading…</main>;
  if (!user) return null;

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-9 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-lg">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">PumpLoop</p>
            <SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />
          </div>
          <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{selectedDate === today ? "Today" : "Training"}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" aria-label="Previous day" onClick={() => setSelectedDate((current) => shiftLocalDate(current, -1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-2xl text-white transition hover:bg-white/20">‹</button>
            <h1 className="min-w-0 text-center text-xl font-semibold tracking-tight sm:text-2xl">{displayDate(selectedDate)}</h1>
            <button type="button" aria-label="Next day" onClick={() => setSelectedDate((current) => shiftLocalDate(current, 1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-2xl text-white transition hover:bg-white/20">›</button>
          </div>
          {selectedDate !== today && <button type="button" onClick={() => setSelectedDate(today)} className="mx-auto mt-3 block rounded-full bg-teal-400/15 px-3 py-1 text-xs font-bold text-teal-300 transition hover:bg-teal-400/25">Today</button>}
          <p className="mt-2 text-sm text-slate-300">Your training, scheduled by your coach.</p>
        </div>
      </header>

      <div className="mx-auto -mt-3 max-w-lg px-4">
        {loadError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{loadError}</p>}
        {startError && <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{startError}</p>}

        {workouts === null ? (
          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5"><p className="text-sm font-medium text-slate-500">Loading your scheduled training…</p></section>
        ) : workouts.length === 0 ? (
          <section className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-950/5">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-2xl">○</div>
            <h2 className="mt-5 text-xl font-semibold tracking-tight">{selectedDate === today ? "No Workout Today" : "No Workout Scheduled"}</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">{selectedDate === today ? "No training session has been scheduled for today." : "No training session has been scheduled for this date."}</p>
          </section>
        ) : (
          <div className="grid gap-4">
            {workouts.map((workout) => {
              const status = workout.session?.status;
              return (
                <section key={workout.id} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5">
                  <div className="border-b border-slate-100 px-5 pb-5 pt-6">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Your workout</p>
                      {status && <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${status === "ACTIVE" ? "bg-teal-50 text-teal-700 ring-teal-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"}`}>{status}</span>}
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight">{workout.workoutName}</h2>
                    <p className="mt-2 text-sm text-slate-500">{workout.exercises.length} exercise{workout.exercises.length === 1 ? "" : "s"} · placed on your day by your coach</p>
                  </div>
                  <ul className="divide-y divide-slate-100 px-5">
                    {workout.exercises.map((exercise) => (
                      <li key={exercise.scheduledWorkoutExerciseId} className="py-4">
                        <p className="text-sm font-bold uppercase tracking-wide text-slate-900">{exercise.name}</p>
                        <PlannedSetPreview plan={exercise.plan} />
                      </li>
                    ))}
                  </ul>
                  <div className="px-5 pb-5 pt-2">
                    {workout.session === null ? (
                      <button type="button" onClick={() => handleStart(workout.id)} disabled={startingId === workout.id} className="min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50">{startingId === workout.id ? "Starting workout…" : "Start Workout"}</button>
                    ) : (
                      <button type="button" onClick={() => router.push(`/session/${workout.session!.id}`)} className={`min-h-14 w-full rounded-2xl px-5 text-base font-bold text-white shadow-sm ${status === "ACTIVE" ? "bg-teal-600 hover:bg-teal-700" : "bg-slate-950 hover:bg-slate-800"}`}>{status === "ACTIVE" ? "Resume Workout" : "View Result"}</button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
