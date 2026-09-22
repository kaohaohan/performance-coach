"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { useLocale, useT } from "@/lib/i18n";
import { localizeExerciseName } from "@/lib/i18n/exercise-names";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";
import { editPayload, editValuesForLog } from "./set-log-edit";
import { ExerciseFocus } from "./exercise-focus";
import { SessionOverview } from "./session-overview";
import {
  actualForTarget,
  editKey,
  emptyForm,
  extraFormKey,
  firstIncompleteTarget,
  formForPlannedSet,
  orderedTargets,
  plannedFormKey,
  type ExerciseOption,
  type Me,
  type PlannedSet,
  type SessionDetail,
  type SessionExercise,
  type SetLog,
  type SetLogFormState,
  type SetLogKind,
} from "./session-model";

const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

export default function SessionPage() {
  const params = useParams<{ id: string }>();
  const sessionId = params.id;
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const t = useT();
  const { locale } = useLocale();
  const [session, setSession] = useState<SessionDetail | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [forms, setForms] = useState<Record<string, SetLogFormState>>({});
  const [selectedTargets, setSelectedTargets] = useState<Record<string, string>>({});
  const [extraOpen, setExtraOpen] = useState<Record<string, boolean>>({});
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const submittingFormKeys = useRef(new Set<string>());
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [exerciseOptions, setExerciseOptions] = useState<ExerciseOption[]>([]);
  const [selectedExerciseId, setSelectedExerciseId] = useState("");
  const [replaceExerciseId, setReplaceExerciseId] = useState("");
  const [addedSets, setAddedSets] = useState("3");
  const [addedReps, setAddedReps] = useState("10");
  const [addedLoad, setAddedLoad] = useState("");
  const [addedRpe, setAddedRpe] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [adjustError, setAdjustError] = useState<string | null>(null);
  const [editingCueId, setEditingCueId] = useState<string | null>(null);
  const [cueDraft, setCueDraft] = useState("");
  const [savingCue, setSavingCue] = useState(false);
  const [cueError, setCueError] = useState<string | null>(null);
  const [focusedExerciseId, setFocusedExerciseId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    void apiFetch<Me>(idToken, "/api/v1/me")
      .then((profile) => { if (!cancelled) setMe(profile); })
      .catch(() => { if (!cancelled) setMe(null); });
    return () => { cancelled = true; };
  }, [idToken]);

  function applySession(next: SessionDetail) {
    setSession(next);
    setFocusedExerciseId((current) => {
      if (current === null) return null;
      return next.exercises.some((exercise) => exercise.scheduledWorkoutExerciseId === current && exercise.removedAt === undefined) ? current : null;
    });
  }

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await apiFetch<SessionDetail>(idToken, `/api/v1/sessions/${sessionId}`);
        if (!cancelled) {
          setLoadError(null);
          applySession(response);
        }
      } catch (error) {
        if (!cancelled) setLoadError(errorMessage(t, error, API_ERROR_POLICY));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, sessionId, t]);

  useEffect(() => {
    if (!idToken || session?.status !== "ACTIVE") return;
    let refreshing = false;
    const refresh = async () => {
      if (refreshing || document.visibilityState !== "visible") return;
      refreshing = true;
      try { applySession(await apiFetch<SessionDetail>(idToken, `/api/v1/sessions/${sessionId}`)); } catch { /* retain last successful view */ }
      finally { refreshing = false; }
    };
    const interval = window.setInterval(() => { void refresh(); }, 15000);
    const onVisibility = () => { void refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("focus", onVisibility); };
  }, [idToken, session?.status, sessionId]);

  useEffect(() => {
    if (!idToken || !adjustOpen) return;
    let cancelled = false;
    void apiFetch<ExerciseOption[]>(idToken, `/api/v1/sessions/${sessionId}/exercise-options`)
      .then((options) => { if (!cancelled) { setExerciseOptions(options); setSelectedExerciseId((current) => current || options[0]?.id || ""); } })
      .catch((error) => { if (!cancelled) setAdjustError(errorMessage(t, error, API_ERROR_POLICY)); });
    return () => { cancelled = true; };
  }, [adjustOpen, idToken, sessionId, t]);

  function getForm(key: string, initial: SetLogFormState): SetLogFormState {
    return forms[key] ?? initial;
  }

  function updateForm(key: string, initial: SetLogFormState, patch: Partial<SetLogFormState>) {
    setForms((previous) => ({ ...previous, [key]: { ...(previous[key] ?? initial), ...patch } }));
  }

  function clearForm(key: string) {
    setForms((previous) => {
      const rest = { ...previous };
      delete rest[key];
      return rest;
    });
  }

  function beginEdit(log: SetLog) {
    if (session?.status !== "ACTIVE") return;
    const key = editKey(log);
    const values = editValuesForLog(log);
    setEditingLogId(log.id);
    setForms((previous) => ({ ...previous, [key]: { ...values, submitting: false, error: null } }));
  }
  function cancelEdit(log: SetLog) { setEditingLogId((current) => current === log.id ? null : current); clearForm(editKey(log)); }
  async function handleEdit(log: SetLog, exerciseId: string) {
    if (!idToken || session?.status !== "ACTIVE") return;
    const key = editKey(log); const form = forms[key];
    if (!form || form.submitting || submittingFormKeys.current.has(key)) return;
    const payload = editPayload(form);
    if ("error" in payload) { updateForm(key, form, { error: t(`athlete.session.${payload.error}Invalid` as never) }); return; }
    submittingFormKeys.current.add(key); updateForm(key, form, { submitting: true, error: null });
    try {
      const updated = await apiFetch<SetLog>(idToken, `/api/v1/set-logs/${log.id}`, { method: "PATCH", body: payload });
      setSession((previous) => previous === null ? previous : { ...previous, exercises: previous.exercises.map((exercise) => exercise.scheduledWorkoutExerciseId !== exerciseId ? exercise : { ...exercise, setLogs: exercise.setLogs.map((item) => item.id === log.id ? updated : item) }) });
      setEditingLogId(null); clearForm(key);
    } catch (error) { updateForm(key, form, { submitting: false, error: errorMessage(t, error, API_ERROR_POLICY) }); }
    finally { submittingFormKeys.current.delete(key); }
  }

  function activeTarget(exercise: SessionExercise): PlannedSet | undefined {
    const selectedId = selectedTargets[exercise.scheduledWorkoutExerciseId];
    const selected = selectedId === undefined ? undefined : orderedTargets(exercise).find((target) => target.scheduledWorkoutPlannedSetId === selectedId);
    if (selected !== undefined && actualForTarget(exercise, selected) === undefined) return selected;
    return firstIncompleteTarget(exercise);
  }

  function appendSetLog(exerciseId: string, log: SetLog) {
    setSession((previous) => previous === null ? previous : {
      ...previous,
      exercises: previous.exercises.map((exercise) => exercise.scheduledWorkoutExerciseId === exerciseId ? { ...exercise, setLogs: [...exercise.setLogs, log] } : exercise),
    });
  }

  async function handleLogSet(exercise: SessionExercise, kind: SetLogKind, target?: PlannedSet) {
    if (!idToken || session?.status !== "ACTIVE") return;
    const key = kind === "PLANNED" && target !== undefined ? plannedFormKey(target) : extraFormKey(exercise);
    const initial = kind === "PLANNED" && target !== undefined ? formForPlannedSet(target) : emptyForm();
    const form = getForm(key, initial);
    if (form.submitting || submittingFormKeys.current.has(key)) return;

    const reps = Number(form.reps);
    if (form.reps.trim() === "" || !Number.isInteger(reps) || reps < 1) {
      updateForm(key, initial, { error: t("athlete.session.repsInvalid") });
      return;
    }
    let load: number | undefined;
    if (form.load.trim() !== "") {
      load = Number(form.load);
      if (!Number.isFinite(load) || load < 0) {
        updateForm(key, initial, { error: t("athlete.session.loadInvalid") });
        return;
      }
    }
    let rpe: number | undefined;
    if (form.rpe.trim() !== "") {
      rpe = Number(form.rpe);
      if (!Number.isFinite(rpe) || rpe < 1 || rpe > 10) {
        updateForm(key, initial, { error: t("athlete.session.rpeInvalid") });
        return;
      }
    }

    const body: Record<string, unknown> = { kind, scheduledWorkoutExerciseId: exercise.scheduledWorkoutExerciseId, reps };
    if (kind === "PLANNED" && target !== undefined) body.scheduledWorkoutPlannedSetId = target.scheduledWorkoutPlannedSetId;
    if (load !== undefined) {
      body.load = load;
      body.unit = form.unit;
    }
    if (rpe !== undefined) body.rpe = rpe;

    submittingFormKeys.current.add(key);
    updateForm(key, initial, { submitting: true, error: null });
    try {
      const log = await apiFetch<SetLog>(idToken, `/api/v1/sessions/${sessionId}/set-logs`, { method: "POST", body });
      appendSetLog(exercise.scheduledWorkoutExerciseId, log);
      clearForm(key);
      if (kind === "PLANNED") {
        setSelectedTargets((previous) => {
          const rest = { ...previous };
          delete rest[exercise.scheduledWorkoutExerciseId];
          return rest;
        });
      }
    } catch (error) {
      updateForm(key, initial, { submitting: false, error: errorMessage(t, error, API_ERROR_POLICY) });
    } finally {
      submittingFormKeys.current.delete(key);
    }
  }

  async function handleComplete() {
    if (!idToken || completing) return;
    const confirmed = window.confirm(locale === "zh-TW"
      ? "確定要完成這次訓練嗎？完成後這份課表會完全鎖定，無法再新增或修改任何紀錄。"
      : "Complete this workout? After completion it is fully locked. You cannot add or edit any recorded results.");
    if (!confirmed) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      const completed = await apiFetch<{ id: string; status: "COMPLETED" }>(idToken, `/api/v1/sessions/${sessionId}/complete`, { method: "POST" });
      setSession((previous) => previous === null ? previous : { ...previous, status: completed.status });
    } catch (error) {
      setCompleteError(errorMessage(t, error, API_ERROR_POLICY));
    } finally {
      setCompleting(false);
    }
  }

  async function refreshSession() {
    if (!idToken) return;
    const response = await apiFetch<SessionDetail>(idToken, `/api/v1/sessions/${sessionId}`);
    applySession(response);
  }

  function beginEditCue(exercise: SessionExercise) {
    setEditingCueId(exercise.scheduledWorkoutExerciseId);
    setCueDraft(exercise.coachCue ?? "");
    setCueError(null);
  }

  function cancelEditCue() {
    setEditingCueId(null);
    setCueDraft("");
    setCueError(null);
  }

  async function handleSaveCue(exercise: SessionExercise) {
    if (!idToken || savingCue) return;
    setSavingCue(true);
    setCueError(null);
    try {
      const updated = await apiFetch<SessionExercise>(idToken, `/api/v1/sessions/${sessionId}/exercises/${exercise.scheduledWorkoutExerciseId}/coach-cue`, {
        method: "PATCH",
        body: { coachCue: cueDraft },
      });
      setSession((previous) => previous === null ? previous : {
        ...previous,
        exercises: previous.exercises.map((item) => item.scheduledWorkoutExerciseId === exercise.scheduledWorkoutExerciseId ? { ...item, coachCue: updated.coachCue } : item),
      });
      cancelEditCue();
    } catch (error) {
      setCueError(errorMessage(t, error, API_ERROR_POLICY));
    } finally {
      setSavingCue(false);
    }
  }

  async function handleAddExercise() {
    if (!idToken || !selectedExerciseId || adjusting) return;
    const setCount = Number(addedSets);
    const reps = Number(addedReps);
    if (!Number.isInteger(setCount) || setCount < 1 || !Number.isInteger(reps) || reps < 1) {
      setAdjustError(t("athlete.session.adjustSetsRepsInvalid"));
      return;
    }
    setAdjusting(true);
    setAdjustError(null);
    try {
      const defaults: { reps: number; load?: number; unit?: "kg"; rpe?: number } = { reps };
      if (addedLoad.trim() !== "") { defaults.load = Number(addedLoad); defaults.unit = "kg"; }
      if (addedRpe.trim() !== "") defaults.rpe = Number(addedRpe);
      if ((defaults.load !== undefined && (!Number.isFinite(defaults.load) || defaults.load < 0)) || (defaults.rpe !== undefined && (!Number.isFinite(defaults.rpe) || defaults.rpe < 1 || defaults.rpe > 10))) { setAdjustError(t("athlete.session.adjustNumbersInvalid")); return; }
      const added = await apiFetch<SessionExercise>(idToken, `/api/v1/sessions/${sessionId}/exercises`, {
        method: "POST",
        body: { exerciseId: selectedExerciseId, plan: { setCount, defaults, overrides: [] }, ...(replaceExerciseId ? { replacesScheduledWorkoutExerciseId: replaceExerciseId } : {}) },
      });
      setAdjustOpen(false);
      setFocusedExerciseId(added.scheduledWorkoutExerciseId);
      await refreshSession();
    } catch (error) {
      setAdjustError(errorMessage(t, error, API_ERROR_POLICY));
    } finally {
      setAdjusting(false);
    }
  }

  async function handleRemoveExercise(exercise: SessionExercise) {
    if (!idToken || adjusting || !window.confirm(`Remove ${exercise.name} from the active workout?`)) return;
    setAdjusting(true);
    setAdjustError(null);
    try {
      await apiFetch(idToken, `/api/v1/sessions/${sessionId}/exercises/${exercise.scheduledWorkoutExerciseId}`, { method: "DELETE" });
      setFocusedExerciseId(null);
      await refreshSession();
    } catch (error) {
      setAdjustError(errorMessage(t, error, API_ERROR_POLICY));
    } finally {
      setAdjusting(false);
    }
  }

  if (authLoading || (user && !idToken)) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("common.loading")}</main>;
  if (!user) return null;
  if (loadError) return <main className="min-h-screen bg-stone-100 p-6"><p role="alert" className="mx-auto max-w-lg rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{loadError}</p></main>;
  if (!session) return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("common.loading")}</main>;

  const isActive = session.status === "ACTIVE";
  const activeExercises = session.exercises.filter((exercise) => exercise.removedAt === undefined);
  const removedExercises = session.exercises.filter((exercise) => exercise.removedAt !== undefined);
  const canManageExercises = isActive && me !== null;
  const canReplace = me?.role === "COACH";
  const focusedIndex = focusedExerciseId === null ? -1 : activeExercises.findIndex((exercise) => exercise.scheduledWorkoutExerciseId === focusedExerciseId);
  const focusedExercise = focusedIndex >= 0 ? activeExercises[focusedIndex] : undefined;

  function handleBack() {
    if (focusedExerciseId !== null) setFocusedExerciseId(null);
    else router.back();
  }

  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="sticky top-0 z-20 bg-slate-950 px-5 pb-4 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto flex max-w-lg items-start justify-between gap-3">
          <div className="min-w-0">
            <button type="button" onClick={handleBack} aria-label={t("common.back")} className="mb-2 -ml-2 flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M12.79 4.22a.75.75 0 0 1 0 1.06L8.06 10l4.73 4.72a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
            </button>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">{t("athlete.session.eyebrow")}</p>
            <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">{session.athlete.name}</h1>
            <p className="mt-1 text-sm text-slate-300">{isActive ? t("athlete.session.live") : t("athlete.session.finished")}</p>
          </div>
          {isActive ? (
            <button type="button" onClick={() => void handleComplete()} disabled={completing} className="mt-8 min-h-11 shrink-0 rounded-full bg-teal-400 px-4 text-sm font-bold text-slate-950 disabled:opacity-50">{completing ? t("athlete.session.completingWorkout") : t("athlete.session.finish")}</button>
          ) : (
            <span className="mt-8 shrink-0 rounded-full bg-emerald-400 px-3 py-1.5 text-xs font-bold text-emerald-950">{t("athlete.status.completed")}</span>
          )}
        </div>
      </header>

      <div className="mx-auto mt-4 flex max-w-lg flex-col gap-4 px-4">
        {completeError && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{completeError}</p>}
        {adjustError && !adjustOpen && <p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{adjustError}</p>}

        {adjustOpen && (
          <AddExerciseDialog
            title={t(me?.role === "ATHLETE" ? "athlete.session.addOwnExercise" : "athlete.session.addExercise")}
            closeLabel={t("common.close")}
            exerciseLabel={t("athlete.session.adjustExercise")}
            replaceLabel={t("athlete.session.replaceOptional")}
            addWithoutReplacing={t("athlete.session.addWithoutReplacing")}
            setsLabel={t("athlete.session.adjustSets")}
            repsLabel={t("athlete.session.adjustReps")}
            loadLabel={t("athlete.session.adjustLoad")}
            rpeLabel={t("athlete.session.adjustRpe")}
            submitLabel={adjusting ? t("common.saving") : replaceExerciseId ? t("athlete.session.replaceAndAdd") : t("athlete.session.addToWorkout")}
            canReplace={canReplace}
            adjusting={adjusting}
            error={adjustError}
            exerciseOptions={exerciseOptions}
            activeExercises={activeExercises}
            selectedExerciseId={selectedExerciseId}
            replaceExerciseId={replaceExerciseId}
            addedSets={addedSets}
            addedReps={addedReps}
            addedLoad={addedLoad}
            addedRpe={addedRpe}
            locale={locale}
            onClose={() => !adjusting && setAdjustOpen(false)}
            onSelectExercise={setSelectedExerciseId}
            onSelectReplace={setReplaceExerciseId}
            onSets={setAddedSets}
            onReps={setAddedReps}
            onLoad={setAddedLoad}
            onRpe={setAddedRpe}
            onSubmit={handleAddExercise}
          />
        )}

        {focusedExercise ? (
          <ExerciseFocus
            exercise={focusedExercise}
            isActive={isActive}
            me={me}
            currentTarget={isActive ? activeTarget(focusedExercise) : undefined}
            extras={focusedExercise.setLogs.filter((log) => log.kind === "EXTRA").sort((left, right) => left.setNumber - right.setNumber)}
            extraOpen={extraOpen[focusedExercise.scheduledWorkoutExerciseId] === true}
            editingLogId={editingLogId}
            getForm={getForm}
            updateForm={updateForm}
            editingCueId={editingCueId}
            cueDraft={cueDraft}
            savingCue={savingCue}
            cueError={cueError}
            adjusting={adjusting}
            canRemove={isActive && (me?.role === "COACH" || (me?.role === "ATHLETE" && focusedExercise.origin === "ATHLETE_ADDED" && focusedExercise.addedByUserId === me.id))}
            hasPrev={focusedIndex > 0}
            hasNext={focusedIndex >= 0 && focusedIndex < activeExercises.length - 1}
            index={focusedIndex}
            total={activeExercises.length}
            onBack={() => setFocusedExerciseId(null)}
            onPrev={() => { if (focusedIndex > 0) setFocusedExerciseId(activeExercises[focusedIndex - 1].scheduledWorkoutExerciseId); }}
            onNext={() => { if (focusedIndex >= 0 && focusedIndex < activeExercises.length - 1) setFocusedExerciseId(activeExercises[focusedIndex + 1].scheduledWorkoutExerciseId); }}
            onLog={handleLogSet}
            onBeginEdit={beginEdit}
            onCancelEdit={cancelEdit}
            onSaveEdit={handleEdit}
            onSkipAhead={(targetId) => setSelectedTargets((previous) => ({ ...previous, [focusedExercise.scheduledWorkoutExerciseId]: targetId }))}
            onToggleExtra={(open) => setExtraOpen((previous) => ({ ...previous, [focusedExercise.scheduledWorkoutExerciseId]: open }))}
            onRemove={() => void handleRemoveExercise(focusedExercise)}
            onCueDraft={setCueDraft}
            onBeginCue={() => beginEditCue(focusedExercise)}
            onCancelCue={cancelEditCue}
            onSaveCue={() => void handleSaveCue(focusedExercise)}
          />
        ) : (
          <>
            <SessionOverview exercises={activeExercises} me={me} onOpen={setFocusedExerciseId} onAddExercise={canManageExercises ? () => { setAdjustOpen(true); setAdjustError(null); setReplaceExerciseId(""); } : undefined} />
            {removedExercises.length > 0 && <details className="rounded-3xl bg-slate-100 p-4 text-slate-700"><summary className="cursor-pointer font-bold">課表調整紀錄（{removedExercises.length}）</summary><div className="mt-3 grid gap-2">{removedExercises.map((exercise) => <article key={exercise.scheduledWorkoutExerciseId} className="rounded-2xl bg-white px-4 py-3"><p className="font-bold line-through">{localizeExerciseName(exercise.name, locale)}</p><p className="mt-1 text-sm text-slate-500">已由教練/學生從目前流程移除；原始紀錄保留。</p></article>)}</div></details>}
          </>
        )}
      </div>
    </main>
  );
}

const fieldClass = "min-h-11 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3";

function AddExerciseDialog({
  title, closeLabel, exerciseLabel, replaceLabel, addWithoutReplacing, setsLabel, repsLabel, loadLabel, rpeLabel, submitLabel,
  canReplace, adjusting, error, exerciseOptions, activeExercises, selectedExerciseId, replaceExerciseId, addedSets, addedReps, addedLoad, addedRpe, locale,
  onClose, onSelectExercise, onSelectReplace, onSets, onReps, onLoad, onRpe, onSubmit,
}: {
  title: string;
  closeLabel: string;
  exerciseLabel: string;
  replaceLabel: string;
  addWithoutReplacing: string;
  setsLabel: string;
  repsLabel: string;
  loadLabel: string;
  rpeLabel: string;
  submitLabel: string;
  canReplace: boolean;
  adjusting: boolean;
  error: string | null;
  exerciseOptions: ExerciseOption[];
  activeExercises: SessionExercise[];
  selectedExerciseId: string;
  replaceExerciseId: string;
  addedSets: string;
  addedReps: string;
  addedLoad: string;
  addedRpe: string;
  locale: "en" | "zh-TW";
  onClose: () => void;
  onSelectExercise: (id: string) => void;
  onSelectReplace: (id: string) => void;
  onSets: (value: string) => void;
  onReps: (value: string) => void;
  onLoad: (value: string) => void;
  onRpe: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="presentation" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()} className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} disabled={adjusting} className="min-h-11 px-2 font-bold text-slate-600">{closeLabel}</button>
        </div>
        <div className="mt-4 grid gap-3">
          <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-700">
            {exerciseLabel}
            <select value={selectedExerciseId} onChange={(event) => onSelectExercise(event.target.value)} className={`${fieldClass} font-semibold`}>
              {exerciseOptions.map((option) => <option key={option.id} value={option.id}>{localizeExerciseName(option.name, locale)}</option>)}
            </select>
          </label>
          {canReplace && (
            <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-700">
              {replaceLabel}
              <select value={replaceExerciseId} onChange={(event) => onSelectReplace(event.target.value)} className={`${fieldClass} font-semibold`}>
                <option value="">{addWithoutReplacing}</option>
                {activeExercises.map((exercise) => <option key={exercise.scheduledWorkoutExerciseId} value={exercise.scheduledWorkoutExerciseId}>{localizeExerciseName(exercise.name, locale)}</option>)}
              </select>
            </label>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-700">{setsLabel}<input type="number" min="1" value={addedSets} onChange={(event) => onSets(event.target.value)} className={fieldClass} /></label>
            <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-700">{repsLabel}<input type="number" min="1" value={addedReps} onChange={(event) => onReps(event.target.value)} className={fieldClass} /></label>
            <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-700">{loadLabel}<input type="number" min="0" value={addedLoad} onChange={(event) => onLoad(event.target.value)} className={fieldClass} /></label>
            <label className="grid min-w-0 gap-1 text-sm font-bold text-slate-700">{rpeLabel}<input type="number" min="1" max="10" step="0.5" value={addedRpe} onChange={(event) => onRpe(event.target.value)} className={fieldClass} /></label>
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
          <button type="button" onClick={onSubmit} disabled={adjusting || !selectedExerciseId} className="min-h-12 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white disabled:opacity-50">{submitLabel}</button>
        </div>
      </div>
    </div>
  );
}
