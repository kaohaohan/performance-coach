"use client";

import { useState } from "react";
import { localizeExerciseName } from "@/lib/i18n/exercise-names";
import { useLocale, useT } from "@/lib/i18n";
import {
  actualForTarget,
  actualSummary,
  editKey,
  emptyForm,
  extraFormKey,
  formForPlannedSet,
  orderedTargets,
  plannedFormKey,
  targetSummary,
  type EditFormState,
  type Me,
  type PlannedSet,
  type SessionExercise,
  type SetLog,
  type SetLogFormState,
  type SetLogKind,
} from "./session-model";

export function ExerciseFocus({
  exercise,
  isActive,
  me,
  currentTarget,
  extras,
  extraOpen,
  editingLogId,
  getForm,
  updateForm,
  editingCueId,
  cueDraft,
  savingCue,
  cueError,
  adjusting,
  canRemove,
  hasPrev,
  hasNext,
  index,
  total,
  onBack,
  onPrev,
  onNext,
  onLog,
  onBeginEdit,
  onCancelEdit,
  onSaveEdit,
  onSkipAhead,
  onToggleExtra,
  onRemove,
  onCueDraft,
  onBeginCue,
  onCancelCue,
  onSaveCue,
}: {
  exercise: SessionExercise;
  isActive: boolean;
  me: Me | null;
  currentTarget: PlannedSet | undefined;
  extras: SetLog[];
  extraOpen: boolean;
  editingLogId: string | null;
  getForm: (key: string, initial: SetLogFormState) => SetLogFormState;
  updateForm: (key: string, initial: SetLogFormState, patch: Partial<SetLogFormState>) => void;
  editingCueId: string | null;
  cueDraft: string;
  savingCue: boolean;
  cueError: string | null;
  adjusting: boolean;
  canRemove: boolean;
  hasPrev: boolean;
  hasNext: boolean;
  index: number;
  total: number;
  onBack: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLog: (exercise: SessionExercise, kind: SetLogKind, target?: PlannedSet) => void;
  onBeginEdit: (log: SetLog) => void;
  onCancelEdit: (log: SetLog) => void;
  onSaveEdit: (log: SetLog, exerciseId: string) => void;
  onSkipAhead: (targetId: string) => void;
  onToggleExtra: (open: boolean) => void;
  onRemove: () => void;
  onCueDraft: (value: string) => void;
  onBeginCue: () => void;
  onCancelCue: () => void;
  onSaveCue: () => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const targets = orderedTargets(exercise);
  const canEditCoachCue = isActive && me?.role === "COACH";
  const extraKey = extraFormKey(exercise);
  const extraInitial = emptyForm();
  const extraForm = getForm(extraKey, extraInitial);

  return (
    <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-950/5">
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <button type="button" onClick={onBack} className="min-h-11 px-2 text-sm font-bold text-teal-700">{t("athlete.session.backToOverview")}</button>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={onPrev} disabled={!hasPrev} aria-label={t("athlete.session.previousExercise")} className="grid h-11 w-11 place-items-center rounded-xl text-lg font-bold text-slate-700 disabled:opacity-30">‹</button>
          <span className="min-w-10 text-center text-xs font-semibold tabular-nums text-slate-500">{t("athlete.session.exercisePosition", { current: index + 1, total })}</span>
          <button type="button" onClick={onNext} disabled={!hasNext} aria-label={t("athlete.session.nextExercise")} className="grid h-11 w-11 place-items-center rounded-xl text-lg font-bold text-slate-700 disabled:opacity-30">›</button>
        </div>
      </div>
      <div className="px-4 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{localizeExerciseName(exercise.name, locale)}</h2>
          {exercise.origin === "ATHLETE_ADDED" && <span className="text-[11px] font-medium text-slate-500">{t("athlete.session.athleteAdded")}</span>}
          {exercise.origin === "COACH_ADDED" && <span className="text-[11px] font-medium text-slate-500">{t("athlete.session.coachAdded")}</span>}
        </div>
        <p className="mt-1 text-sm text-slate-500">{t("athlete.session.progressSummary", { completed: targets.filter((target) => actualForTarget(exercise, target) !== undefined).length, total: targets.length })}</p>
        {exercise.youtubeUrl && <a href={exercise.youtubeUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-bold text-teal-700">{t("athlete.watchVideo")}</a>}
      </div>

      {(exercise.coachCue || canEditCoachCue) && <CueBlock exercise={exercise} canEdit={canEditCoachCue} editing={editingCueId === exercise.scheduledWorkoutExerciseId} cueDraft={cueDraft} saving={savingCue} error={cueError} onDraft={onCueDraft} onBegin={onBeginCue} onCancel={onCancelCue} onSave={onSaveCue} />}

      <div className="px-4 pb-2">
        <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-2 border-b border-slate-200 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
          <span>{t("athlete.session.colSet")}</span>
          <span>{t("athlete.session.colTarget")}</span>
          <span>{t("athlete.session.actual")}</span>
        </div>
        {targets.map((target) => {
          const actual = actualForTarget(exercise, target);
          const isCurrent = currentTarget?.scheduledWorkoutPlannedSetId === target.scheduledWorkoutPlannedSetId;
          if (actual !== undefined) {
            const summary = (
              <>
                <span className="text-sm font-bold text-slate-700">{target.position}</span>
                <span className="truncate text-sm text-slate-500">{targetSummary(t, target)}</span>
                <span className="text-sm font-semibold text-emerald-800">{actualSummary(t, actual)}</span>
              </>
            );
            return (
              <div key={target.scheduledWorkoutPlannedSetId} className="border-b border-slate-100 py-2">
                {isActive ? (
                  <button type="button" className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 text-left" onClick={() => onBeginEdit(actual)}>
                    {summary}
                  </button>
                ) : (
                  <div className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2">
                    {summary}
                  </div>
                )}
                {isActive && editingLogId === actual.id && <div className="mt-2"><EditLog form={getForm(editKey(actual), emptyForm())} onChange={(patch) => updateForm(editKey(actual), getForm(editKey(actual), emptyForm()), patch)} onSave={() => onSaveEdit(actual, exercise.scheduledWorkoutExerciseId)} onCancel={() => onCancelEdit(actual)} /></div>}
              </div>
            );
          }
          if (isCurrent) {
            const key = plannedFormKey(target);
            const initial = formForPlannedSet(target);
            const form = getForm(key, initial);
            return (
              <div key={target.scheduledWorkoutPlannedSetId} className="border-b border-teal-200 bg-teal-50/50 py-2">
                <div className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-2">
                  <span className="text-sm font-bold text-teal-800">{target.position}</span>
                  <span className="truncate text-sm text-slate-600">{targetSummary(t, target)}</span>
                </div>
                <CompactFields form={form} onChange={(patch) => updateForm(key, initial, patch)} />
                {form.error && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{form.error}</p>}
                <button type="button" onClick={() => onLog(exercise, "PLANNED", target)} disabled={form.submitting} className="mt-2 min-h-11 w-full rounded-xl bg-teal-600 text-sm font-bold text-white disabled:opacity-50">{form.submitting ? t("athlete.session.loggingSet") : t("athlete.session.logSet")}</button>
              </div>
            );
          }
          return (
            <div key={target.scheduledWorkoutPlannedSetId} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 py-2">
              <span className="text-sm font-bold text-slate-400">{target.position}</span>
              <span className="truncate text-sm text-slate-500">{targetSummary(t, target)}</span>
              {isActive && <button type="button" onClick={() => onSkipAhead(target.scheduledWorkoutPlannedSetId)} className="min-h-10 px-2 text-sm font-bold text-teal-700">{t("athlete.session.logThisSetInstead")}</button>}
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-200 px-4 py-3">
        <button type="button" onClick={() => onToggleExtra(!extraOpen)} className="text-sm font-bold text-slate-700">{t(extraOpen ? "athlete.session.hideExtras" : "athlete.session.showExtras", { count: extras.length })}</button>
        {extraOpen && (
          <div className="mt-3">
            {extras.map((log) => (
              <div key={log.id} className="mb-2 rounded-xl bg-stone-50 px-3 py-2">
                {isActive && editingLogId === log.id ? <EditLog form={getForm(editKey(log), emptyForm())} onChange={(patch) => updateForm(editKey(log), getForm(editKey(log), emptyForm()), patch)} onSave={() => onSaveEdit(log, exercise.scheduledWorkoutExerciseId)} onCancel={() => onCancelEdit(log)} /> : isActive ? <button type="button" className="block w-full text-left" onClick={() => onBeginEdit(log)}><p className="text-xs font-bold text-slate-500">{t("athlete.session.extraLoggedNumber", { number: log.setNumber })}</p><p className="mt-1 text-sm font-semibold">{actualSummary(t, log)}</p></button> : <><p className="text-xs font-bold text-slate-500">{t("athlete.session.extraLoggedNumber", { number: log.setNumber })}</p><p className="mt-1 text-sm font-semibold">{actualSummary(t, log)}</p></>}
              </div>
            ))}
            {isActive && (
              <div className="mt-2">
                <CompactFields form={extraForm} onChange={(patch) => updateForm(extraKey, extraInitial, patch)} />
                {extraForm.error && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{extraForm.error}</p>}
                <button type="button" onClick={() => onLog(exercise, "EXTRA")} disabled={extraForm.submitting} className="mt-2 min-h-11 w-full rounded-xl bg-slate-950 text-sm font-bold text-white disabled:opacity-50">{extraForm.submitting ? t("athlete.session.loggingSet") : t("athlete.session.logExtraSet")}</button>
              </div>
            )}
          </div>
        )}
        {canRemove && <button type="button" onClick={onRemove} disabled={adjusting} className="mt-3 min-h-11 w-full rounded-xl border border-red-200 text-sm font-bold text-red-700 disabled:opacity-50">{t("common.remove")}</button>}
      </div>
    </section>
  );
}

function CueBlock({
  exercise, canEdit, editing, cueDraft, saving, error, onDraft, onBegin, onCancel, onSave,
}: {
  exercise: SessionExercise;
  canEdit: boolean;
  editing: boolean;
  cueDraft: string;
  saving: boolean;
  error: string | null;
  onDraft: (value: string) => void;
  onBegin: () => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(Boolean(exercise.coachCue));
  if (editing) {
    return (
      <div className="mx-4 mb-3 grid gap-2">
        <textarea value={cueDraft} onChange={(event) => onDraft(event.target.value)} maxLength={500} rows={3} placeholder={t("athlete.session.coachCuePlaceholder")} className="w-full rounded-xl border border-teal-200 px-3 py-2 text-sm" />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="min-h-10 px-3 text-sm font-bold text-slate-700">{t("athlete.session.cancelCoachCue")}</button>
          <button type="button" onClick={onSave} disabled={saving} className="min-h-10 rounded-lg bg-teal-600 px-3 text-sm font-bold text-white">{saving ? t("common.saving") : t("athlete.session.saveCoachCue")}</button>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}
      </div>
    );
  }
  return (
    <div className="mx-4 mb-3">
      <button type="button" onClick={() => setOpen((current) => !current)} className="text-sm font-bold text-teal-800">{t(open ? "athlete.today.hideCoachCue" : "athlete.today.showCoachCue")}</button>
      {open && <p className="mt-1 text-sm leading-5 text-teal-900">{exercise.coachCue ? <>{exercise.coachCue}</> : <span className="text-slate-500">{t("athlete.session.noCoachCue")}</span>}{canEdit && <button type="button" onClick={onBegin} className="ml-2 font-bold text-teal-700">{exercise.coachCue ? t("athlete.session.editCoachCue") : t("athlete.session.addCoachCue")}</button>}</p>}
    </div>
  );
}

function CompactFields({ form, onChange }: { form: SetLogFormState; onChange: (patch: Partial<SetLogFormState>) => void }) {
  const t = useT();
  const field = "min-h-11 w-full min-w-0 rounded-lg border border-slate-200 px-2 text-sm font-semibold";
  return (
    <div className="mt-2 grid grid-cols-2 gap-2">
      <input aria-label={t("athlete.session.fieldLoad")} type="number" inputMode="decimal" placeholder={t("athlete.session.fieldLoad")} value={form.load} onChange={(event) => onChange({ load: event.target.value })} className={field} />
      <select aria-label={t("athlete.session.fieldUnit")} value={form.unit} onChange={(event) => onChange({ unit: event.target.value as "kg" | "lb" })} disabled={form.load.trim() === ""} className={`${field} disabled:bg-slate-100`}>
        <option value="kg">kg</option>
        <option value="lb">lb</option>
      </select>
      <input aria-label={t("athlete.session.fieldReps")} type="number" inputMode="numeric" placeholder={t("athlete.session.fieldReps")} value={form.reps} onChange={(event) => onChange({ reps: event.target.value })} className={field} />
      <input aria-label={t("athlete.session.fieldActualRpe")} type="number" inputMode="decimal" placeholder="RPE" value={form.rpe} onChange={(event) => onChange({ rpe: event.target.value })} className={field} />
    </div>
  );
}

function EditLog({ form, onChange, onSave, onCancel }: { form: EditFormState; onChange: (patch: Partial<EditFormState>) => void; onSave: () => void; onCancel: () => void }) {
  const t = useT();
  return (
    <div>
      <CompactFields form={form} onChange={onChange} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={form.submitting} className="min-h-11 rounded-xl border border-slate-300 text-sm font-bold text-slate-700">{t("athlete.session.cancelEdit")}</button>
        <button type="button" onClick={onSave} disabled={form.submitting} className="min-h-11 rounded-xl bg-teal-600 text-sm font-bold text-white">{form.submitting ? t("athlete.session.savingEdit") : t("athlete.session.saveEdit")}</button>
      </div>
      {form.error && <p role="alert" className="mt-2 text-sm font-medium text-red-700">{form.error}</p>}
    </div>
  );
}
