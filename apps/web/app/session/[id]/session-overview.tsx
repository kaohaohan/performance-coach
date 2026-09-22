"use client";

import { compactPrescription } from "@/lib/prescription-summary";
import { localizeExerciseName } from "@/lib/i18n/exercise-names";
import { useLocale, useT } from "@/lib/i18n";
import { actualForTarget, orderedTargets, type Me, type SessionExercise } from "./session-model";

export function SessionOverview({
  exercises,
  me,
  onOpen,
  onAddExercise,
}: {
  exercises: SessionExercise[];
  me: Me | null;
  onOpen: (id: string) => void;
  onAddExercise?: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-950/5">
      <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("athlete.session.exerciseEyebrow")}</p>
        {onAddExercise && <button type="button" onClick={onAddExercise} className="text-sm font-bold text-teal-700">{t(me?.role === "ATHLETE" ? "athlete.session.addOwnExercise" : "athlete.session.addExercise")}</button>}
      </div>
      <ul className="divide-y divide-slate-100">
        {exercises.map((exercise) => {
          const targets = orderedTargets(exercise);
          const completed = targets.filter((target) => actualForTarget(exercise, target) !== undefined).length;
          return (
            <li key={exercise.scheduledWorkoutExerciseId}>
              <button type="button" onClick={() => onOpen(exercise.scheduledWorkoutExerciseId)} className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-sm font-bold text-slate-900">{localizeExerciseName(exercise.name, locale)}</p>
                    {exercise.origin === "ATHLETE_ADDED" && <span className="text-[11px] font-medium text-slate-500">{t("athlete.session.athleteAdded")}</span>}
                    {exercise.origin === "COACH_ADDED" && <span className="text-[11px] font-medium text-slate-500">{t("athlete.session.coachAdded")}</span>}
                  </div>
                    <p className="mt-0.5 truncate text-sm text-slate-500">{compactPrescription(t, exercise.plan)}</p>
                    {exercise.youtubeUrl && <a href={exercise.youtubeUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} className="mt-1 inline-block text-xs font-bold text-teal-700">{t("athlete.watchVideo")}</a>}
                    {exercise.coachCue && <p className="mt-1 line-clamp-2 text-sm leading-5 text-slate-600">{exercise.coachCue}</p>}
                </div>
                <span className="shrink-0 text-sm font-bold text-slate-700">{completed}/{targets.length}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
