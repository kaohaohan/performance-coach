"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { apiFetch } from "@/lib/api";
import { useLocale, useT, type Translate } from "@/lib/i18n";
import { localizeExerciseName } from "@/lib/i18n/exercise-names";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";
import { editPayload, editValuesForLog } from "./set-log-edit";

type PlannedSet = { scheduledWorkoutPlannedSetId: string; position: number; reps?: number; prescriptionNote?: string; load?: number; unit?: "kg" | "lb"; rpe?: number };
type Plan = { sets: PlannedSet[] };
type SetLog = { id: string; kind: "PLANNED" | "EXTRA"; scheduledWorkoutPlannedSetId?: string; plannedPosition?: number; setNumber: number; load?: number; unit?: "kg" | "lb"; reps: number; rpe?: number; loggedByUserId: string };
type SessionExercise = { scheduledWorkoutExerciseId: string; exerciseId: string; name: string; plan: Plan; coachCue?: string; setLogs: SetLog[]; origin: "ASSIGNED" | "COACH_ADDED" | "ATHLETE_ADDED"; addedByUserId?: string; removedAt?: string; removedByUserId?: string; replacesScheduledWorkoutExerciseId?: string };
type ExerciseOption = { id: string; name: string; scope: "SYSTEM" | "PRIVATE" };
type Me = { id: string; role: "COACH" | "ATHLETE" };
type SessionDetail = { id: string; status: "ACTIVE" | "COMPLETED"; athlete: { id: string; name: string }; exercises: SessionExercise[] };
type SetLogFormState = { load: string; unit: "kg" | "lb"; reps: string; rpe: string; submitting: boolean; error: string | null };
type SetLogKind = "PLANNED" | "EXTRA";
type EditFormState = SetLogFormState;

// Loading the session, logging a set and completing the workout all fail
// through the Go API, which explains its own refusals (a set logged against a
// completed session, a session that is not yours). serverMessage keeps that
// explanation; everything else falls back to errors.unexpected, exactly as
// the page's old local errorMessage() did.
const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

function emptyForm(): SetLogFormState {
  return { load: "", unit: "kg", reps: "", rpe: "", submitting: false, error: null };
}

function formForPlannedSet(target: PlannedSet): SetLogFormState {
  return { load: target.load === undefined ? "" : String(target.load), unit: target.unit ?? "kg", reps: target.reps === undefined ? "" : String(target.reps), rpe: "", submitting: false, error: null };
}

function orderedTargets(exercise: SessionExercise): PlannedSet[] {
  return [...exercise.plan.sets].sort((left, right) => left.position - right.position);
}

function actualForTarget(exercise: SessionExercise, target: PlannedSet): SetLog | undefined {
  return exercise.setLogs.find((log) => log.kind === "PLANNED" && log.scheduledWorkoutPlannedSetId === target.scheduledWorkoutPlannedSetId);
}

function firstIncompleteTarget(exercise: SessionExercise): PlannedSet | undefined {
  const completedPlannedSetIds = new Set(
    exercise.setLogs
      .filter((log) => log.kind === "PLANNED" && log.scheduledWorkoutPlannedSetId !== undefined)
      .map((log) => log.scheduledWorkoutPlannedSetId),
  );
  return orderedTargets(exercise).find((target) => !completedPlannedSetIds.has(target.scheduledWorkoutPlannedSetId));
}

// The two summary lines are the densest domain copy on the screen, and both
// take `t` rather than reading a hook so they stay callable from inside the
// render map. "RPE" and kg/lb are left as literals on purpose: Taiwan coaches
// write both exactly as they appear in English, so there is nothing to
// translate and a catalog key would only invite someone to invent a form.
function targetSummary(t: Translate, target: PlannedSet): string {
  const prescription = target.reps === undefined ? target.prescriptionNote ?? "" : t("athlete.set.reps", { count: target.reps });
  return [prescription, target.load === undefined ? "" : `${target.load} ${target.unit}`, target.rpe === undefined ? "" : `RPE ${target.rpe}`].filter(Boolean).join(" · ");
}

function actualSummary(t: Translate, log: SetLog): string {
  return [log.load === undefined ? t("athlete.set.bodyweight") : `${log.load} ${log.unit}`, t("athlete.set.reps", { count: log.reps }), log.rpe === undefined ? "" : `RPE ${log.rpe}`].filter(Boolean).join(" · ");
}

function plannedFormKey(target: PlannedSet): string {
  return `planned:${target.scheduledWorkoutPlannedSetId}`;
}

function extraFormKey(exercise: SessionExercise): string {
  return `extra:${exercise.scheduledWorkoutExerciseId}`;
}

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
  const [expandedExerciseId, setExpandedExerciseId] = useState<string | null>(null);
  const initiallyExpanded = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  // Firebase identifies the browser user, but the API owns application role
  // and database user identity. Until this succeeds, structural controls stay
  // absent rather than guessing from the route or Firebase claims.
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
    if (!initiallyExpanded.current && next.status === "ACTIVE") {
      initiallyExpanded.current = true;
      setExpandedExerciseId(next.exercises.filter((exercise) => exercise.removedAt === undefined).find((exercise) => firstIncompleteTarget(exercise) !== undefined)?.scheduledWorkoutExerciseId ?? null);
    }
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

  function editKey(log: SetLog) { return `edit:${log.id}`; }
  function beginEdit(log: SetLog) {
    const key = editKey(log);
    const values = editValuesForLog(log);
    setEditingLogId(log.id);
    setForms((previous) => ({ ...previous, [key]: { ...values, submitting: false, error: null } }));
  }
  function cancelEdit(log: SetLog) { setEditingLogId((current) => current === log.id ? null : current); clearForm(editKey(log)); }
  async function handleEdit(log: SetLog, exerciseId: string) {
    if (!idToken) return;
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
    if (!idToken) return;
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
      } else {
        setExtraOpen((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: false }));
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
      ? "確定要完成這次訓練嗎？完成後將無法再新增、移除或取代動作，只能更正已記錄的數據。"
      : "Complete this workout? After completion, you cannot add, remove, or replace exercises. You can only edit recorded results.");
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
      setExpandedExerciseId(added.scheduledWorkoutExerciseId);
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
  return (
    <main className="min-h-screen bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <header className="bg-slate-950 px-5 pb-8 pt-[max(1.5rem,env(safe-area-inset-top))] text-white">
        <div className="mx-auto max-w-lg">
          <button type="button" onClick={() => router.back()} aria-label={t("common.back")} className="mb-2 -ml-2 flex h-9 w-9 items-center justify-center rounded-full text-white/80 hover:bg-white/10">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5"><path fillRule="evenodd" d="M12.79 4.22a.75.75 0 0 1 0 1.06L8.06 10l4.73 4.72a.75.75 0 1 1-1.06 1.06l-5.25-5.25a.75.75 0 0 1 0-1.06l5.25-5.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" /></svg>
          </button>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">{t("athlete.session.eyebrow")}</p>
          <div className="mt-4 flex items-start justify-between gap-4">
            <div><h1 className="text-3xl font-semibold tracking-tight">{session.athlete.name}</h1><p className="mt-2 text-sm text-slate-300">{isActive ? t("athlete.session.live") : t("athlete.session.finished")}</p></div>
            <span className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold tracking-wide ${isActive ? "bg-teal-400 text-slate-950" : "bg-emerald-400 text-emerald-950"}`}>{t(isActive ? "athlete.status.active" : "athlete.status.completed")}</span>
          </div>
        </div>
      </header>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        {canManageExercises && <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-950/5">
          <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-bold text-slate-900">{t("athlete.session.adjustHeading")}</p><p className="mt-1 text-sm text-slate-500">{t("athlete.session.adjustHint")}</p></div><button type="button" onClick={() => { setAdjustOpen(true); setAdjustError(null); setReplaceExerciseId(""); }} className="min-h-11 rounded-xl bg-teal-600 px-3 text-sm font-bold text-white">{t(me.role === "ATHLETE" ? "athlete.session.addOwnExercise" : "athlete.session.addExercise")}</button></div>
          {adjustOpen && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-4 sm:items-center" role="presentation" onClick={() => !adjusting && setAdjustOpen(false)}><div role="dialog" aria-modal="true" aria-label={t("athlete.session.addExercise")} onClick={(event) => event.stopPropagation()} className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold">{t(me.role === "ATHLETE" ? "athlete.session.addOwnExercise" : "athlete.session.addExercise")}</h2><button type="button" onClick={() => setAdjustOpen(false)} disabled={adjusting} className="min-h-11 px-2 font-bold text-slate-600">{t("common.close")}</button></div><div className="mt-4 grid gap-3"><label className="grid gap-1 text-sm font-bold text-slate-700">{t("athlete.session.adjustExercise")}<select value={selectedExerciseId} onChange={(event) => setSelectedExerciseId(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 font-semibold">{exerciseOptions.map((option) => <option key={option.id} value={option.id}>{localizeExerciseName(option.name, locale)}</option>)}</select></label>{canReplace && <label className="grid gap-1 text-sm font-bold text-slate-700">{t("athlete.session.replaceOptional")}<select value={replaceExerciseId} onChange={(event) => setReplaceExerciseId(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 font-semibold"><option value="">{t("athlete.session.addWithoutReplacing")}</option>{activeExercises.map((exercise) => <option key={exercise.scheduledWorkoutExerciseId} value={exercise.scheduledWorkoutExerciseId}>{localizeExerciseName(exercise.name, locale)}</option>)}</select></label>}<div className="grid grid-cols-2 gap-3"><label className="grid gap-1 text-sm font-bold text-slate-700">{t("athlete.session.adjustSets")}<input type="number" min="1" value={addedSets} onChange={(event) => setAddedSets(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3" /></label><label className="grid gap-1 text-sm font-bold text-slate-700">{t("athlete.session.adjustReps")}<input type="number" min="1" value={addedReps} onChange={(event) => setAddedReps(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3" /></label><label className="grid gap-1 text-sm font-bold text-slate-700">{t("athlete.session.adjustLoad")}<input type="number" min="0" value={addedLoad} onChange={(event) => setAddedLoad(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3" /></label><label className="grid gap-1 text-sm font-bold text-slate-700">{t("athlete.session.adjustRpe")}<input type="number" min="1" max="10" step="0.5" value={addedRpe} onChange={(event) => setAddedRpe(event.target.value)} className="min-h-11 rounded-xl border border-slate-200 bg-white px-3" /></label></div>{adjustError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{adjustError}</p>}<button type="button" onClick={handleAddExercise} disabled={adjusting || !selectedExerciseId} className="min-h-12 rounded-xl bg-teal-600 px-4 text-sm font-bold text-white disabled:opacity-50">{adjusting ? t("common.saving") : replaceExerciseId ? t("athlete.session.replaceAndAdd") : t("athlete.session.addToWorkout")}</button></div></div></div>}
        </section>}
        {activeExercises.map((exercise, exerciseIndex) => {
          const targets = orderedTargets(exercise);
          const currentTarget = isActive ? activeTarget(exercise) : undefined;
          const extras = exercise.setLogs.filter((log) => log.kind === "EXTRA").sort((left, right) => left.setNumber - right.setNumber);
          const showExtraForm = extraOpen[exercise.scheduledWorkoutExerciseId] === true;
          const extraKey = extraFormKey(exercise);
          const extraInitial = emptyForm();
          const extraForm = getForm(extraKey, extraInitial);
          const expanded = expandedExerciseId === exercise.scheduledWorkoutExerciseId;
          const nextExercise = activeExercises.slice(exerciseIndex + 1).find((candidate) => firstIncompleteTarget(candidate) !== undefined);

          // The API remains the authority. This is only an affordance gate
          // derived from the application /me response, never Firebase claims.
          const canRemove = isActive && (me?.role === "COACH" || (me?.role === "ATHLETE" && exercise.origin === "ATHLETE_ADDED" && exercise.addedByUserId === me.id));
          const canEditCoachCue = isActive && me?.role === "COACH";
          return <section key={exercise.scheduledWorkoutExerciseId} className={`overflow-hidden rounded-2xl shadow-sm ring-1 ${exercise.origin === "ATHLETE_ADDED" ? "border-l-4 border-amber-700 bg-amber-50 ring-amber-200" : "bg-white ring-slate-950/5"}`}>
            <button type="button" aria-expanded={expanded} onClick={() => setExpandedExerciseId((current) => current === exercise.scheduledWorkoutExerciseId ? null : exercise.scheduledWorkoutExerciseId)} className="block min-h-12 w-full px-4 py-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="break-words text-lg font-semibold tracking-tight">{localizeExerciseName(exercise.name, locale)}</h2>{exercise.origin === "ATHLETE_ADDED" ? <span className="rounded-full bg-amber-700 px-2 py-0.5 text-[11px] font-bold text-white">{t("athlete.session.athleteAdded")}</span> : <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{exercise.origin === "COACH_ADDED" ? t("athlete.session.coachAdded") : t("athlete.session.exerciseEyebrow")}</span>}</div><p className="mt-1 text-sm text-slate-600">{t("athlete.session.progressSummary", { completed: targets.filter((target) => actualForTarget(exercise, target) !== undefined).length, total: targets.length })}</p></div><span className="mt-0.5 shrink-0 text-sm font-bold text-teal-700">{t(expanded ? "athlete.session.collapseExercise" : "athlete.session.expandExercise")} <span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></span></div>
            </button>
            {expanded && <>
            {(exercise.coachCue || canEditCoachCue) && <div className="mx-4 border-t border-teal-100 pt-3">
              {editingCueId === exercise.scheduledWorkoutExerciseId ? <div className="grid gap-2">
                <label className="grid gap-1 text-sm font-bold text-teal-900" htmlFor={`coach-cue-${exercise.scheduledWorkoutExerciseId}`}>{t("athlete.session.coachCueLabel")}
                  <textarea id={`coach-cue-${exercise.scheduledWorkoutExerciseId}`} value={cueDraft} onChange={(event) => setCueDraft(event.target.value)} maxLength={500} rows={3} placeholder={t("athlete.session.coachCuePlaceholder")} className="w-full resize-y rounded-xl border border-teal-200 bg-white px-3 py-2 text-sm font-normal leading-5 text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" />
                </label>
                <div className="flex items-center justify-between gap-3"><span className="text-xs text-slate-500">{cueDraft.length}/500</span><div className="flex gap-2"><button type="button" onClick={cancelEditCue} disabled={savingCue} className="min-h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-50">{t("athlete.session.cancelCoachCue")}</button><button type="button" onClick={() => handleSaveCue(exercise)} disabled={savingCue} className="min-h-10 rounded-lg bg-teal-600 px-3 text-sm font-bold text-white disabled:opacity-50">{savingCue ? t("common.saving") : t("athlete.session.saveCoachCue")}</button></div></div>
                {cueError && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{cueError}</p>}
              </div> : <div className="flex items-start justify-between gap-3 text-sm leading-5 text-teal-900"><p className="min-w-0">{exercise.coachCue ? <><span className="font-bold">{t("athlete.coachCue")}</span> {exercise.coachCue}</> : <span className="text-slate-500">{t("athlete.session.noCoachCue")}</span>}</p>{canEditCoachCue && <button type="button" onClick={() => beginEditCue(exercise)} className="min-h-10 shrink-0 rounded-lg border border-teal-200 bg-white px-3 text-sm font-bold text-teal-700 hover:bg-teal-50">{exercise.coachCue ? t("athlete.session.editCoachCue") : t("athlete.session.addCoachCue")}</button>}</div>}
            </div>}
            <div className="px-4 pb-3 pt-2">
              {targets.map((target) => {
                const actual = actualForTarget(exercise, target);
                const isCurrent = currentTarget?.scheduledWorkoutPlannedSetId === target.scheduledWorkoutPlannedSetId;
                const key = plannedFormKey(target);
                const initial = formForPlannedSet(target);
                const form = getForm(key, initial);

                if (actual !== undefined) return <article key={target.scheduledWorkoutPlannedSetId} className="border-b border-emerald-100 py-3 last:border-b-0">
                  <div className="flex items-start justify-between gap-3"><CardHeading position={target.position} total={targets.length} status={t("athlete.session.setCompleted")} statusClass="bg-emerald-100 text-emerald-800" /><span className="shrink-0 text-xs font-bold text-emerald-800">{t("athlete.session.loggedNumber", { number: actual.setNumber })}</span></div>
                  <p className="mt-1 text-sm font-medium text-slate-600"><span className="font-semibold text-slate-800">{t("athlete.session.target")}：</span>{targetSummary(t, target)}</p>
                  {editingLogId === actual.id ? <div className="mt-3"><EditLog form={getForm(editKey(actual), emptyForm())} onChange={(patch) => updateForm(editKey(actual), getForm(editKey(actual), emptyForm()), patch)} onSave={() => handleEdit(actual, exercise.scheduledWorkoutExerciseId)} onCancel={() => cancelEdit(actual)} /></div> : <button type="button" className="mt-1 flex w-full items-center justify-between gap-3 text-left" onClick={() => beginEdit(actual)}><span className="text-sm font-semibold text-slate-800">{actualSummary(t, actual)}</span><span className="shrink-0 text-sm font-bold text-teal-700">{t("athlete.session.editSet")}</span></button>}
                </article>;

                if (isCurrent) return <article key={target.scheduledWorkoutPlannedSetId} className="my-2 rounded-xl border-2 border-teal-600 bg-teal-50/60 px-3 py-3">
                  <CardHeading position={target.position} total={targets.length} status={t("athlete.session.setNext")} statusClass="bg-teal-600 text-white" />
                  <p className="mt-2 text-sm font-medium text-slate-700"><span className="font-semibold text-slate-900">{t("athlete.session.target")}：</span>{targetSummary(t, target)}</p>
                  <SetLogFields form={form} onChange={(patch) => updateForm(key, initial, patch)} textPrescription={target.prescriptionNote !== undefined} />
                  {form.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{form.error}</p>}
                  <button type="button" onClick={() => handleLogSet(exercise, "PLANNED", target)} disabled={form.submitting} className="mt-4 min-h-14 w-full rounded-2xl bg-teal-600 px-5 text-base font-bold text-white shadow-sm hover:bg-teal-700 disabled:opacity-50">{form.submitting ? t("athlete.session.loggingSet") : t("athlete.session.logSet")}</button>
                </article>;

                return <article key={target.scheduledWorkoutPlannedSetId} className="flex items-center justify-between gap-3 border-b border-slate-200 py-3 last:border-b-0">
                  <div className="min-w-0"><CardHeading position={target.position} total={targets.length} status={t("athlete.session.setNotLogged")} statusClass="bg-slate-100 text-slate-600" /><p className="mt-1 truncate text-sm font-medium text-slate-600">{targetSummary(t, target)}</p></div>
                  {isActive && <button type="button" onClick={() => setSelectedTargets((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: target.scheduledWorkoutPlannedSetId }))} className="min-h-11 shrink-0 rounded-lg px-2 text-sm font-bold text-teal-700 hover:bg-teal-50">{t("athlete.session.logThisSetInstead")}</button>}
                </article>;
              })}
            </div>

            {isActive && currentTarget === undefined && nextExercise && <div className="px-4 pb-4"><button type="button" onClick={() => setExpandedExerciseId(nextExercise.scheduledWorkoutExerciseId)} className="min-h-12 w-full rounded-2xl bg-slate-950 px-4 text-sm font-bold text-white">{t("athlete.session.nextExercise")}</button></div>}

            <div className="border-t border-slate-200 px-4 py-4">
              <div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("athlete.session.extraSetsHeading")}</p><span className="text-sm font-semibold text-slate-500">{extras.length}</span></div>
              {extras.length > 0 && <ul className="mt-3 space-y-2">{extras.map((log) => <li key={log.id} className="rounded-2xl bg-stone-50 px-4 py-3">{editingLogId === log.id ? <EditLog form={getForm(editKey(log), emptyForm())} onChange={(patch) => updateForm(editKey(log), getForm(editKey(log), emptyForm()), patch)} onSave={() => handleEdit(log, exercise.scheduledWorkoutExerciseId)} onCancel={() => cancelEdit(log)} /> : <button type="button" className="block w-full text-left" onClick={() => beginEdit(log)}><p className="text-xs font-bold uppercase tracking-wide text-slate-500">{t("athlete.session.extraLoggedNumber", { number: log.setNumber })}</p><p className="mt-1 text-sm font-semibold text-slate-800">{actualSummary(t, log)}</p></button>}</li>)}</ul>}
              {isActive && <div className="mt-4">
                {!showExtraForm ? <button type="button" onClick={() => setExtraOpen((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: true }))} className={`min-h-12 w-full rounded-2xl px-4 text-sm font-bold ${currentTarget === undefined ? "bg-slate-950 text-white hover:bg-slate-800" : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"}`}>{t("athlete.session.addExtraSet")}</button> :
                  <div className="rounded-2xl border border-slate-200 bg-stone-50 p-4">
                    <div className="flex items-center justify-between gap-3"><p className="text-sm font-bold text-slate-900">{t("athlete.session.addExtraSet")}</p><button type="button" onClick={() => setExtraOpen((previous) => ({ ...previous, [exercise.scheduledWorkoutExerciseId]: false }))} className="min-h-11 px-2 text-sm font-bold text-slate-600">{t("common.close")}</button></div>
                    <SetLogFields form={extraForm} onChange={(patch) => updateForm(extraKey, extraInitial, patch)} />
                    {extraForm.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{extraForm.error}</p>}
                    <button type="button" onClick={() => handleLogSet(exercise, "EXTRA")} disabled={extraForm.submitting} className="mt-4 min-h-14 w-full rounded-2xl bg-slate-950 px-5 text-base font-bold text-white shadow-sm hover:bg-slate-800 disabled:opacity-50">{extraForm.submitting ? t("athlete.session.loggingSet") : t("athlete.session.logExtraSet")}</button>
                  </div>}
              </div>}
              {canRemove && <button type="button" onClick={() => handleRemoveExercise(exercise)} disabled={adjusting} className="mt-4 min-h-11 w-full rounded-xl border border-red-200 bg-white px-3 text-sm font-bold text-red-700 disabled:opacity-50">{t("common.remove")}</button>}
            </div>
            </>}
          </section>;
        })}
        {removedExercises.length > 0 && <details className="rounded-3xl bg-slate-100 p-4 text-slate-700"><summary className="cursor-pointer font-bold">課表調整紀錄（{removedExercises.length}）</summary><div className="mt-3 grid gap-2">{removedExercises.map((exercise) => <article key={exercise.scheduledWorkoutExerciseId} className="rounded-2xl bg-white px-4 py-3"><p className="font-bold line-through">{localizeExerciseName(exercise.name, locale)}</p><p className="mt-1 text-sm text-slate-500">已由教練/學生從目前流程移除；原始紀錄保留。</p></article>)}</div></details>}

        {isActive && <section className="pt-2"><p className="mb-3 px-1 text-sm leading-6 text-slate-500">{t("athlete.session.completeHint")}</p>{completeError && <p role="alert" className="mb-3 rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{completeError}</p>}<button type="button" onClick={handleComplete} disabled={completing} className="min-h-14 w-full rounded-2xl border border-slate-300 bg-white px-5 text-base font-bold text-slate-900 shadow-sm hover:bg-slate-50 disabled:opacity-50">{completing ? t("athlete.session.completingWorkout") : t("athlete.session.completeWorkout")}</button></section>}
      </div>
    </main>
  );
}

// `status` arrives already translated: the three call sites each pick a
// different key, so resolving it here would mean passing the key instead and
// re-deriving which one — the same decision, one level further from where it
// is made.
function CardHeading({ position, total, status, statusClass }: { position: number; total: number; status: string; statusClass: string }) {
  const t = useT();
  return <div className="flex items-center justify-between gap-3"><p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-600">{t("athlete.set.labelOfTotal", { position, total })}</p><span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-wide ${statusClass}`}>{status}</span></div>;
}

function EditLog({ form, onChange, onSave, onCancel }: { form: EditFormState; onChange: (patch: Partial<EditFormState>) => void; onSave: () => void; onCancel: () => void }) {
  const t = useT();
  return <div><p className="text-sm font-bold text-slate-900">{t("athlete.session.editSet")}</p><SetLogFields form={form} onChange={onChange} /><div className="mt-3 grid grid-cols-2 gap-3"><button type="button" onClick={onCancel} disabled={form.submitting} className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 disabled:opacity-50">{t("athlete.session.cancelEdit")}</button><button type="button" onClick={onSave} disabled={form.submitting} className="min-h-12 rounded-xl bg-teal-600 px-3 text-sm font-bold text-white disabled:opacity-50">{form.submitting ? t("athlete.session.savingEdit") : t("athlete.session.saveEdit")}</button></div>{form.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{form.error}</p>}</div>;
}

function SetLogFields({ form, onChange, textPrescription = false }: { form: SetLogFormState; onChange: (patch: Partial<SetLogFormState>) => void; textPrescription?: boolean }) {
  const t = useT();
  return <div className="mt-4">
    <div className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-3">
      <Field label={t("athlete.session.fieldLoad")} optional><input type="number" inputMode="decimal" value={form.load} onChange={(event) => onChange({ load: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
      {/* kg / lb are the written symbols in both languages — not translated. */}
      <Field label={t("athlete.session.fieldUnit")}><select value={form.unit} onChange={(event) => onChange({ unit: event.target.value as "kg" | "lb" })} disabled={form.load.trim() === ""} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"><option value="kg">kg</option><option value="lb">lb</option></select></Field>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-3">
      <Field label={t("athlete.session.fieldReps")}><input type="number" inputMode="numeric" value={form.reps} onChange={(event) => onChange({ reps: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
      <Field label={t("athlete.session.fieldActualRpe")} optional><input type="number" inputMode="decimal" value={form.rpe} onChange={(event) => onChange({ rpe: event.target.value })} className="min-h-14 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-semibold outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15" /></Field>
    </div>
    {textPrescription && <p className="mt-3 text-sm leading-5 text-slate-600">{t("athlete.session.textPrescriptionHint")}</p>}
  </div>;
}

function Field({ children, label, optional = false }: { children: ReactNode; label: string; optional?: boolean }) {
  const t = useT();
  return <label className="min-w-0"><span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}{optional && <span className="ml-1 font-normal text-slate-400">{t("athlete.session.fieldOptional")}</span>}</span>{children}</label>;
}
