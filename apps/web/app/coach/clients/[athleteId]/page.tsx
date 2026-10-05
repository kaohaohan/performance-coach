"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLocale, useT, type Locale, type MessageKey } from "@/lib/i18n";
import { monthDay } from "@/lib/i18n/dates";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";
import { AppHeader } from "@/components/app-header";
import { completionText, eventChips, layoutSparkline, topSetText, type OverviewExercise, type ProgressOverview } from "@/lib/progress-overview";
import { localizeExerciseName } from "@/lib/i18n/exercise-names";

type Role = "COACH" | "ATHLETE";
type Athlete = { id: string; name: string; role: "ATHLETE" };
type Session = { id: string; status: "ACTIVE" | "COMPLETED" };
type ScheduledWorkout = {
  id: string;
  scheduledDate: string;
  athlete: { id: string; name: string };
  workout: { id: string; name: string };
  session: Session | null;
};

function localISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateRange(): { from: string; to: string } {
  const today = new Date();
  return {
    from: localISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 30)),
    to: localISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7)),
  };
}

// The date above each scheduled workout in the client's timeline —
// en "Sep 3", zh-TW "9月3日". Nothing uppercases it, so there is no Latin
// casing to strip for Chinese here.
function displayDate(locale: Locale, date: string): string {
  return monthDay(locale, date);
}

// The chip shows the raw API status, so its three keys carry the API's own
// casing in English. The workout-history list words the same three states
// differently (Calendar's sentence case) — an existing English divergence
// this task translates rather than unifies.
function statusKey(session: Session | null): MessageKey {
  if (session?.status === "ACTIVE") return "coach.sessionStatus.active";
  if (session?.status === "COMPLETED") return "coach.sessionStatus.completed";
  return "coach.sessionStatus.notStarted";
}

function statusClass(session: Session | null): string {
  if (session?.status === "ACTIVE") return "bg-teal-50 text-teal-700 ring-teal-600/20";
  if (session?.status === "COMPLETED") return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  return "bg-slate-100 text-slate-600 ring-slate-500/10";
}

// The Go API is the authority on why it rejected a call, so its own copy is
// passed through; anything else falls back to errors.unexpected.
const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

export default function CoachClientDetailPage() {
  const params = useParams<{ athleteId: string }>();
  const athleteId = params.athleteId;
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const t = useT();
  const { locale } = useLocale();
  const [role, setRole] = useState<Role | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [athletes, setAthletes] = useState<Athlete[] | null>(null);
  const [athleteError, setAthleteError] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<ScheduledWorkout[] | null>(null);
  const [timelineAthleteId, setTimelineAthleteId] = useState<string | null>(null);
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [overview, setOverview] = useState<{ athleteId: string; data: ProgressOverview | null } | null>(null);
  const overviewRequestId = useRef(0);
  const roleRequestId = useRef(0);
  const athleteRequestId = useRef(0);
  const timelineRequestId = useRef(0);
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

  const selectedAthlete = athletes?.find((athlete) => athlete.id === athleteId) ?? null;

  useEffect(() => {
    if (!idToken || !selectedAthlete) return;
    const requestId = ++timelineRequestId.current;
    const { from, to } = dateRange();
    let cancelled = false;
    (async () => {
      setTimelineError(null);
      setTimeline(null);
      setTimelineAthleteId(null);
      try {
        const result = await apiFetch<ScheduledWorkout[]>(
          idToken,
          `/api/v1/scheduled-workouts?athleteId=${encodeURIComponent(selectedAthlete.id)}&from=${from}&to=${to}`,
        );
        if (!cancelled && requestId === timelineRequestId.current) {
          setTimeline(result);
          setTimelineAthleteId(selectedAthlete.id);
          setTimelineError(null);
        }
      } catch (error) {
        if (!cancelled && requestId === timelineRequestId.current) setTimelineError(errorMessage(t, error, API_ERROR_POLICY));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, selectedAthlete, t]);

  // Objective N-week overview (GET /athletes/{athleteId}/progress-overview).
  // Failure shows a small notice: the timeline below is the page's primary
  // content.
  useEffect(() => {
    if (!idToken || !selectedAthlete) return;
    const requestId = ++overviewRequestId.current;
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<ProgressOverview>(idToken, `/api/v1/athletes/${encodeURIComponent(selectedAthlete.id)}/progress-overview`);
        if (!cancelled && requestId === overviewRequestId.current) setOverview({ athleteId: selectedAthlete.id, data });
      } catch {
        if (!cancelled && requestId === overviewRequestId.current) setOverview({ athleteId: selectedAthlete.id, data: null });
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, selectedAthlete]);

  async function handleStart(scheduledWorkoutId: string) {
    if (!idToken || startingRef.current !== null) return;
    startingRef.current = scheduledWorkoutId;
    setStartingId(scheduledWorkoutId);
    setStartError(null);
    try {
      const session = await apiFetch<{ id: string; status: string }>(
        idToken,
        `/api/v1/scheduled-workouts/${scheduledWorkoutId}/session`,
        { method: "POST" },
      );
      router.push(`/session/${session.id}`);
    } catch (error) {
      setStartError(errorMessage(t, error, API_ERROR_POLICY));
      startingRef.current = null;
      setStartingId(null);
    }
  }

  if (authLoading || (user && !idToken) || (user && !role && !roleError)) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("common.loading")}</main>;
  }
  if (!user) return null;

  if (roleError) return <ErrorPage message={roleError} />;
  if (athleteError) return <ErrorPage message={athleteError} />;
  if (role === "COACH" && athletes === null) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("coach.clientDetail.loading")}</main>;
  if (role === "COACH" && !selectedAthlete) return <ErrorPage message={t("coach.clientDetail.notConnected")} />;

  const athleteName = timeline?.[0]?.athlete.name ?? selectedAthlete?.name ?? t("coach.clientDetail.unknownName");
  const visibleTimeline = timelineAthleteId === selectedAthlete?.id ? timeline : null;
  const orderedTimeline = visibleTimeline ? [...visibleTimeline].sort((a, b) => b.scheduledDate.localeCompare(a.scheduledDate)) : null;

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <AppHeader>
        <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight">{athleteName}</h1>
        <p className="mt-2 text-sm text-slate-300">{t("coach.clientDetail.subtitle")}</p>
        <button type="button" onClick={() => router.push("/coach/clients")} className="mt-4 min-h-11 rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900">{t("coach.clientDetail.back")}</button>
      </AppHeader>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        <section>
          <div className="mb-3 px-1"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("progress.overview.heading")}</p></div>
          {overview === null || overview.athleteId !== selectedAthlete?.id ? <LoadingCard label={t("progress.overview.loading")} /> : overview.data === null ? <EmptyCard title={t("progress.overview.error")} /> : <OverviewSection athleteId={athleteId} data={overview.data} />}
        </section>
        <section>
          <div className="mb-3 px-1"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("coach.clientDetail.trainingHeading")}</p></div>
          {startError && <Notice>{startError}</Notice>}
          {timelineError && <Notice>{timelineError}</Notice>}
          {orderedTimeline === null ? <LoadingCard label={t("coach.clientDetail.loadingTraining")} /> : orderedTimeline.length === 0 ? <EmptyCard title={t("coach.clientDetail.noTraining")} /> : (
            <ul className="grid gap-3">
              {orderedTimeline.map((scheduledWorkout) => (
                <li key={scheduledWorkout.id} className="rounded-3xl bg-white p-5 shadow-sm ring-1 ring-slate-950/5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-500">{displayDate(locale, scheduledWorkout.scheduledDate)}</p>
                      <h2 className="mt-1 break-words text-xl font-semibold tracking-tight">{scheduledWorkout.workout.name}</h2>
                    </div>
                    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ring-1 ${statusClass(scheduledWorkout.session)}`}>{t(statusKey(scheduledWorkout.session))}</span>
                  </div>
                  <div className="mt-5 flex flex-wrap items-center justify-end gap-3 border-t border-slate-100 pt-4">
                    {scheduledWorkout.session === null ? (
                      <button type="button" onClick={() => handleStart(scheduledWorkout.id)} disabled={startingId === scheduledWorkout.id} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50">{startingId === scheduledWorkout.id ? t("coach.session.starting") : t("coach.session.start")}</button>
                    ) : (
                      <button type="button" onClick={() => router.push(`/session/${scheduledWorkout.session!.id}`)} className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white">{scheduledWorkout.session.status === "ACTIVE" ? t("coach.session.resume") : t("coach.session.review")}</button>
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

function OverviewSection({ athleteId, data }: { athleteId: string; data: ProgressOverview }) {
  const t = useT();
  const { locale } = useLocale();
  const { assignments: a } = data;
  const weeks = data.window.weeks;
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-3 gap-2">
        <StripCell label={t("progress.overview.completion")} value={completionText(a.completionRate)} detail={a.scheduled === 0 ? t("progress.overview.noAssignments") : t("progress.overview.completionDetail", { completed: a.completed, scheduled: a.scheduled })} />
        <StripCell label={t("progress.overview.sets")} value={t("progress.overview.setsValue", { completed: a.completedPlannedSets, planned: a.plannedSets })} detail={a.extraSets > 0 ? t("progress.overview.extraSets", { count: a.extraSets }) : undefined} />
        <StripCell label={t("progress.overview.prs")} value={String(data.recentEventTotals.total)} detail={t("progress.overview.prsDetail")} />
      </div>
      <p className="px-1 text-xs text-slate-500">{t("progress.overview.scopeNote")}</p>
      {data.exercises.length === 0 ? <EmptyCard title={t("progress.overview.empty", { weeks })} /> : (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-950/5">
          {data.exercises.map((exercise) => (
            <li key={`${exercise.exerciseId}-${exercise.unit}`}>
              <ExerciseRow athleteId={athleteId} exercise={exercise} weeks={weeks} locale={locale} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StripCell({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-white p-3 shadow-sm ring-1 ring-slate-950/5">
      <p className="text-[11px] font-semibold leading-tight text-slate-500">{label}</p>
      <p className="mt-1 break-words text-xl font-semibold tracking-tight text-slate-900">{value}</p>
      {detail && <p className="mt-0.5 text-[11px] leading-tight text-slate-500">{detail}</p>}
    </div>
  );
}

function ExerciseRow({ athleteId, exercise, weeks, locale }: { athleteId: string; exercise: OverviewExercise; weeks: number; locale: Locale }) {
  const t = useT();
  const chips = eventChips(t, exercise.recentEvents);
  return (
    <Link href={`/coach/clients/${athleteId}/exercises/${exercise.exerciseId}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-bold text-slate-900">{localizeExerciseName(exercise.name, locale)}</p>
        <p className="mt-0.5 text-xs font-medium text-slate-600">{topSetText(exercise.latest.topSet, exercise.unit)}</p>
        {chips.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {chips.map((chip) => <span key={chip.key} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">{chip.label}</span>)}
          </div>
        )}
      </div>
      <Sparkline exercise={exercise} caption={t("progress.overview.trendLabel", { weeks })} />
    </Link>
  );
}

// Inline SVG, same series color for every exercise. Weeks without data break
// the line; nothing is interpolated.
function Sparkline({ exercise, caption }: { exercise: OverviewExercise; caption: string }) {
  const s = layoutSparkline(exercise.trend);
  return (
    <svg viewBox={`0 0 ${s.width} ${s.height}`} role="img" aria-label={`${caption}: ${exercise.name}`} className="h-7 w-24 shrink-0">
      {s.runs.map((run, i) => run.length > 1 && <polyline key={i} fill="none" className="stroke-teal-600" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" points={run.map((p) => `${p.x},${p.y}`).join(" ")} />)}
      {s.runs.map((run, i) => run.length === 1 && <circle key={`d${i}`} cx={run[0].x} cy={run[0].y} r={1.5} className="fill-teal-600" />)}
      {s.last && <circle cx={s.last.x} cy={s.last.y} r={2.5} className="fill-teal-600" />}
    </svg>
  );
}

function ErrorPage({ message }: { message: string }) {
  return <main className="min-h-screen bg-stone-100 p-6"><p role="alert" className="mx-auto max-w-lg rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{message}</p></main>;
}

function Notice({ children }: { children: string }) {
  return <p role="alert" className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{children}</p>;
}

function LoadingCard({ label }: { label: string }) {
  return <div className="rounded-3xl bg-white p-5 text-sm font-medium text-slate-500 shadow-sm ring-1 ring-slate-950/5">{label}</div>;
}

function EmptyCard({ title }: { title: string }) {
  return <div className="rounded-3xl border border-dashed border-slate-200 bg-stone-50 px-5 py-5"><p className="font-semibold">{title}</p></div>;
}
