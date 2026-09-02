"use client";

import { useT, type Translate } from "@/lib/i18n";
import { isSameMonth, todayLocalISODate } from "./calendar-date";
import type { ScheduledWorkoutSummary, Session, Workout, WorkoutExercise } from "./types";

type Density = "week" | "month";

// prescriptionSummary renders the "4 x 8" line under an exercise name. A
// TEXT-mode prescription ("AMAP", "30 sec") has no rep count, so it shows the
// instruction instead. Per-set overrides are deliberately not expanded here:
// the card states the uniform prescription, and the day view is where a coach
// inspects individual sets.
//
// "4 x 8" is notation, not a sentence, so it stays assembled rather than
// translated; only the bare set count carries a noun and needs a key.
function prescriptionSummary(t: Translate, exercise: WorkoutExercise): string {
  const { setCount, defaults } = exercise.plan;
  if (defaults.reps !== undefined) return `${setCount} x ${defaults.reps}`;
  if (defaults.prescriptionNote) return `${setCount} x ${defaults.prescriptionNote}`;
  return setCount === 1
    ? t("calendar.dayCard.setCountOne")
    : t("calendar.dayCard.setCountOther", { count: setCount });
}

function statusLabel(t: Translate, session: Session | null): string {
  if (session?.status === "COMPLETED") return t("calendar.dayCard.statusDone");
  if (session?.status === "ACTIVE") return t("calendar.dayCard.statusInProgress");
  return t("calendar.dayCard.statusNotStarted");
}

function statusClass(session: Session | null): string {
  if (session?.status === "COMPLETED") return "bg-emerald-50 text-emerald-700 ring-emerald-600/20";
  if (session?.status === "ACTIVE") return "bg-teal-50 text-teal-700 ring-teal-600/20";
  return "bg-slate-100 text-slate-600 ring-slate-500/10";
}

export default function DayCard({
  date,
  selectedDate,
  monthAnchor,
  density,
  assignments,
  workoutsById,
  disabled,
  onSelect,
  onAddWorkout,
  onDuplicate,
}: {
  date: string;
  // The day currently marked selected (highlighted with a stronger ring).
  // Independent of monthAnchor: browsing months in Month view must not move
  // the coach's actual selection, mirroring the existing Day-view mini
  // calendar's split between "which month is paged" and "which day is
  // chosen".
  selectedDate: string;
  // Only consulted at density "month", to dim days outside the currently
  // paged month. Ignored at density "week" — a week almost always straddles
  // a month boundary, and none of its days should read as "outside".
  monthAnchor: string;
  density: Density;
  assignments: ScheduledWorkoutSummary[];
  workoutsById: Map<string, Workout>;
  disabled: boolean;
  onSelect: (date: string) => void;
  onAddWorkout: (date: string) => void;
  onDuplicate?: (date: string) => void;
}) {
  const t = useT();
  const isToday = date === todayLocalISODate();
  const isSelected = date === selectedDate;
  const outsideMonth = density === "month" && !isSameMonth(date, monthAnchor);

  const dayNumber = Number(date.slice(-2));
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(`${date}T00:00:00`));
  const monthShort = new Intl.DateTimeFormat("en-US", { month: "short" }).format(new Date(`${date}T00:00:00`));
  const heading = density === "week" ? `${weekday.toUpperCase()} ${dayNumber}` : `${weekday.toUpperCase()}, ${monthShort.toUpperCase()} ${dayNumber}`;

  const hasTraining = assignments.length > 0;

  return (
    <article
      className={`flex min-h-56 flex-col rounded-2xl bg-white ring-1 transition ${
        isSelected ? "ring-2 ring-teal-600" : "ring-slate-950/5"
      } ${outsideMonth ? "opacity-55" : ""}`}
    >
      <div className="flex items-center justify-between gap-1 px-2.5 pt-2.5">
        <button
          type="button"
          onClick={() => onSelect(date)}
          disabled={disabled}
          aria-current={isToday ? "date" : undefined}
          className={`min-w-0 truncate rounded-lg px-1.5 py-1 text-[11px] font-bold uppercase tracking-wide transition disabled:opacity-50 ${
            isToday ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {heading}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          {onDuplicate !== undefined && <button
            type="button"
            onClick={() => onDuplicate(date)}
            disabled={disabled || !hasTraining}
            aria-label={t("calendar.dayCard.duplicateFrom", { date })}
            title={t("calendar.dayCard.duplicateTitle")}
            className="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 5.5v-2a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2" />
            </svg>
          </button>}
        </div>
      </div>

      <div className="min-h-0 flex-1 px-2.5 py-2">
        {!hasTraining ? (
          <p className="px-1 text-xs font-medium text-slate-400">{t("calendar.dayCard.noTraining")}</p>
        ) : (
          <ul className="grid gap-2">
            {assignments.map((assignment) => {
              const workout = workoutsById.get(assignment.workout.id);
              return (
                <li key={assignment.id}>
                  <div className="flex items-start justify-between gap-2 px-1">
                    <p className="min-w-0 truncate text-xs font-bold text-slate-800">{assignment.workout.name}</p>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ring-1 ${statusClass(assignment.session)}`}>{statusLabel(t, assignment.session)}</span>
                  </div>
                  {workout === undefined ? (
                    <p className="px-1 pt-0.5 text-[11px] font-medium text-slate-400">{t("calendar.dayCard.prescriptionUnavailable")}</p>
                  ) : (
                    <ul className="mt-1 grid gap-1">
                      {workout.exercises.map((exercise) => (
                        <li key={exercise.workoutExerciseId} className="border-l-2 border-slate-200 pl-2">
                          <p className="truncate text-[13px] font-medium leading-tight text-slate-700">{exercise.name}</p>
                          <p className="text-[11px] leading-tight text-slate-400">{prescriptionSummary(t, exercise)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={() => onAddWorkout(date)}
        disabled={disabled}
        className="mx-2.5 mb-1 flex items-center gap-1.5 rounded-lg px-1 py-1.5 text-left text-xs font-bold text-teal-700 transition hover:bg-teal-50 disabled:opacity-50 disabled:hover:bg-transparent"
      >
        <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded bg-slate-900 text-sm leading-none text-white">+</span>
        {t("calendar.addWorkout")}
      </button>

    </article>
  );
}
