"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import SignOutButton from "@/components/sign-out-button";
import { AppHeader } from "@/components/app-header";
import { useT, type Translate } from "@/lib/i18n";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";

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

// Everything this page can fail at is a call to the Go API, which writes its
// own `{ error: { message } }` copy and is the authority on why it refused.
// serverMessage passes that through; anything else lands on
// errors.unexpected, which is the same sentence the page's old local
// errorMessage() fell back to.
const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

function todayLocalISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Still en-US: locale-aware dates are decision D3, implemented in sub-task 6
// together with the calendar's identical helpers. Leaving it here rather than
// converting it half-way is deliberate — D3 rewrites this line and the
// calendar's in one place.
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

// Takes `t` rather than reading a hook: it is called from inside a map and
// from a component, and a plain function keeps both call sites identical.
// "RPE" and the kg/lb symbols stay literal — Taiwan coaches use both exactly
// as written, so there is nothing to translate.
function plannedSetSummary(t: Translate, target: PlannedSet): string {
  const parts = [target.reps === undefined ? target.prescriptionNote ?? "" : t("athlete.set.reps", { count: target.reps })];
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
  const t = useT();
  const targets = orderedPlannedSets(plan);
  if (targets.length === 0) return <p className="mt-1 text-sm font-medium text-slate-500">{t("athlete.plan.none")}</p>;

  const uniform = targets.every((target) => samePrescription(targets[0], target));
  if (uniform) return <div className="mt-2">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t(targets.length === 1 ? "athlete.plan.setCountOne" : "athlete.plan.setCountOther", { count: targets.length })}</p>
    <p className="mt-1 text-base font-medium leading-6 text-slate-600">{plannedSetSummary(t, targets[0])}</p>
  </div>;

  return <div className="mt-2">
    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{t("athlete.plan.plannedSetCount", { count: targets.length })}</p>
    <ol className="mt-2 space-y-1.5">
      {targets.map((target) => <li key={target.scheduledWorkoutPlannedSetId} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-sm leading-5">
        <span className="font-bold text-slate-700">{t("athlete.set.label", { position: target.position })}</span>
        <span className="min-w-0 font-medium text-slate-600">{plannedSetSummary(t, target)}</span>
      </li>)}
    </ol>
  </div>;
}

export default function AthleteTodayPage() {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const t = useT();
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
        if (!cancelled) setLoadError(errorMessage(t, err, API_ERROR_POLICY));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [idToken, selectedDate, t]);

  async function handleStart(scheduledWorkoutId: string) {
    if (!idToken || startingId) return;
    setStartingId(scheduledWorkoutId);
    setStartError(null);
    try {
      const session = await apiFetch<{ id: string; status: string }>(idToken, `/api/v1/scheduled-workouts/${scheduledWorkoutId}/session`, { method: "POST" });
      router.push(`/session/${session.id}`);
    } catch (err) {
      setStartError(errorMessage(t, err, API_ERROR_POLICY));
      setStartingId(null);
    }
  }

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("common.loading")}</main>;
  if (!user) return null;

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <AppHeader
        padding="pb-9"
        actions={
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => router.push("/settings")} className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white">{t("athlete.today.account")}</button>
            <SignOutButton className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400 transition hover:text-white disabled:opacity-50" />
          </div>
        }
      >
        <p className="mt-7 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{selectedDate === today ? t("athlete.today.eyebrowToday") : t("athlete.today.eyebrowTraining")}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" aria-label={t("athlete.today.previousDay")} onClick={() => setSelectedDate((current) => shiftLocalDate(current, -1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-2xl text-white transition hover:bg-white/20">‹</button>
          <h1 className="min-w-0 text-center text-xl font-semibold tracking-tight sm:text-2xl">{displayDate(selectedDate)}</h1>
          <button type="button" aria-label={t("athlete.today.nextDay")} onClick={() => setSelectedDate((current) => shiftLocalDate(current, 1))} className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white/10 text-2xl text-white transition hover:bg-white/20">›</button>
        </div>
        {selectedDate !== today && <button type="button" onClick={() => setSelectedDate(today)} className="mx-auto mt-3 block rounded-full bg-teal-400/15 px-3 py-1 text-xs font-bold text-teal-300 transition hover:bg-teal-400/25">{t("athlete.today.jumpToToday")}</button>}
        <p className="mt-2 text-sm text-slate-300">{t("athlete.today.subtitle")}</p>
      </AppHeader>

      <div className="mx-auto -mt-3 max-w-lg px-4">
        {loadError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{loadError}</p>}
        {startError && <p role="alert" className="mt-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{startError}</p>}

        {workouts === null ? (
          <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-950/5"><p className="text-sm font-medium text-slate-500">{t("athlete.today.loading")}</p></section>
        ) : workouts.length === 0 ? (
          <section className="rounded-3xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-950/5">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-slate-100 text-2xl">○</div>
            <h2 className="mt-5 text-xl font-semibold tracking-tight">{selectedDate === today ? t("athlete.today.emptyTodayTitle") : t("athlete.today.emptyDateTitle")}</h2>
            <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">{selectedDate === today ? t("athlete.today.emptyTodayBody") : t("athlete.today.emptyDateBody")}</p>
          </section>
        ) : (
          <div className="grid gap-4">
            {workouts.map((workout) => {
              const status = workout.session?.status;
              return (
                <section key={workout.id} className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5">
                  <div className="border-b border-slate-100 px-5 pb-5 pt-6">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("athlete.today.workoutEyebrow")}</p>
                      {status && <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${status === "ACTIVE" ? "bg-teal-50 text-teal-700 ring-teal-600/20" : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"}`}>{t(status === "ACTIVE" ? "athlete.status.active" : "athlete.status.completed")}</span>}
                    </div>
                    <h2 className="mt-2 text-2xl font-semibold tracking-tight">{workout.workoutName}</h2>
                    <p className="mt-2 text-sm text-slate-500">{t(workout.exercises.length === 1 ? "athlete.today.exerciseSummaryOne" : "athlete.today.exerciseSummaryOther", { count: workout.exercises.length })}</p>
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
                      <button type="button" onClick={() => handleStart(workout.id)} disabled={startingId === workout.id} className="min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm transition hover:bg-teal-700 disabled:opacity-50">{startingId === workout.id ? t("athlete.today.startingWorkout") : t("athlete.today.startWorkout")}</button>
                    ) : (
                      <button type="button" onClick={() => router.push(`/session/${workout.session!.id}`)} className={`min-h-14 w-full rounded-2xl px-5 text-base font-bold text-white shadow-sm ${status === "ACTIVE" ? "bg-teal-600 hover:bg-teal-700" : "bg-slate-950 hover:bg-slate-800"}`}>{status === "ACTIVE" ? t("athlete.today.resumeWorkout") : t("athlete.today.viewResult")}</button>
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
