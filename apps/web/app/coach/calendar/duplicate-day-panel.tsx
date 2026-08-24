"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { displayDate, isValidISODate, monthDays, monthLabel, shiftMonth, todayLocalISODate } from "./calendar-date";
import type { Athlete, ScheduledWorkoutSummary, Workout } from "./types";

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(year, month - 1, day + amount);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function DatePickerField({ label, value, disabled, onChange }: { label: string; value: string; disabled: boolean; onChange: (date: string) => void }) {
  const [open, setOpen] = useState(false);
  const [monthAnchor, setMonthAnchor] = useState(value);

  function choose(date: string) {
    onChange(date);
    setMonthAnchor(date);
    setOpen(false);
  }

  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold text-slate-700">{label}</span>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 focus-within:border-teal-600 focus-within:ring-2 focus-within:ring-teal-600/15">
          <input type="date" value={value} disabled={disabled} onChange={(event) => { if (isValidISODate(event.target.value)) choose(event.target.value); }} className="min-h-12 w-full bg-transparent text-base font-medium outline-none disabled:opacity-50" />
          <button type="button" onClick={() => { setMonthAnchor(value); setOpen((previous) => !previous); }} disabled={disabled} aria-expanded={open} aria-label={open ? "Hide calendar" : "Show calendar"} className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50">▤</button>
        </div>
      </label>
      {open && <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex items-center justify-between gap-2">
          <button type="button" aria-label="Previous month" onClick={() => setMonthAnchor(shiftMonth(monthAnchor, -1))} className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-slate-600 hover:bg-slate-100">‹</button>
          <span className="text-sm font-bold">{monthLabel(monthAnchor)}</span>
          <button type="button" aria-label="Next month" onClick={() => setMonthAnchor(shiftMonth(monthAnchor, 1))} className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-slate-600 hover:bg-slate-100">›</button>
        </div>
        <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-bold uppercase text-slate-400" aria-hidden="true">{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((weekday) => <span key={weekday}>{weekday}</span>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-y-1">
          {monthDays(monthAnchor).map((day, index) => day === null ? <span key={`blank-${index}`} className="aspect-square" /> : <button key={day} type="button" onClick={() => choose(day)} aria-label={displayDate(day)} className={`mx-auto grid aspect-square w-full max-w-10 place-items-center rounded-lg text-sm font-semibold transition ${day === value ? "bg-amber-500 text-white" : day === todayLocalISODate() ? "text-slate-900 ring-1 ring-inset ring-slate-300" : "text-slate-700 hover:bg-slate-100"}`}>{Number(day.slice(-2))}</button>)}
        </div>
      </div>}
    </div>
  );
}

type SourceWorkout = {
  id: string;
  name: string;
  exerciseSummary: string;
};

export function sourceWorkoutIds(assignments: ScheduledWorkoutSummary[]): string[] {
  return [...new Set(assignments.map((assignment) => assignment.workout.id))];
}

export function sourceWorkoutsFrom(assignments: ScheduledWorkoutSummary[], workoutsById: ReadonlyMap<string, Workout>): SourceWorkout[] {
  return sourceWorkoutIds(assignments).map((id) => {
    const assignment = assignments.find((item) => item.workout.id === id)!;
    const exercises = workoutsById.get(id)?.exercises ?? [];
    const exerciseNames = exercises.slice(0, 2).map((exercise) => exercise.name).join(" · ");
    const remaining = exercises.length - 2;
    const names = remaining > 0 ? `${exerciseNames} · +${remaining} more` : exerciseNames;
    const count = `${exercises.length} exercise${exercises.length === 1 ? "" : "s"}`;
    return {
      id,
      name: assignment.workout.name,
      exerciseSummary: names === "" ? "Exercise details unavailable" : `${names} · ${count}`,
    };
  });
}

export function canDuplicateSelectedWorkouts({
  sourceAssignments,
  selectedWorkoutIds,
  selectedAthleteIds,
  targetDate,
}: {
  sourceAssignments: ScheduledWorkoutSummary[] | null;
  selectedWorkoutIds: string[];
  selectedAthleteIds: string[];
  targetDate: string;
}): boolean {
  return sourceAssignments !== null && selectedWorkoutIds.length > 0 && selectedAthleteIds.length > 0 && isValidISODate(targetDate);
}

export default function DuplicateDayPanel({
  athletes,
  sourceDate,
  sourceAssignments,
  workoutsById,
  sourceError,
  submitting,
  submitError,
  initialAthleteId,
  onClose,
  onDuplicate,
}: {
  athletes: Athlete[];
  sourceDate: string;
  sourceAssignments: ScheduledWorkoutSummary[] | null;
  workoutsById: ReadonlyMap<string, Workout>;
  sourceError: string | null;
  submitting: boolean;
  submitError: string | null;
  initialAthleteId: string;
  onClose: () => void;
  onDuplicate: (workoutIds: string[], athleteIds: string[], targetDate: string) => Promise<string[] | undefined>;
}) {
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>(() => initialAthleteId === "" ? [] : [initialAthleteId]);
  const [selectedWorkoutIds, setSelectedWorkoutIds] = useState<string[]>(() => sourceAssignments === null ? [] : sourceWorkoutIds(sourceAssignments));
  const [query, setQuery] = useState("");
  const [targetDate, setTargetDate] = useState(() => addDays(sourceDate, 7));
  const [showAthleteError, setShowAthleteError] = useState(false);
  const sourceSelectionInitialized = useRef(sourceAssignments !== null);
  const visibleAthletes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === "" ? athletes : athletes.filter((athlete) => athlete.name.toLowerCase().includes(needle));
  }, [athletes, query]);
  const sourceWorkouts = useMemo(
    () => sourceAssignments === null ? [] : sourceWorkoutsFrom(sourceAssignments, workoutsById),
    [sourceAssignments, workoutsById],
  );
  const canDuplicate = canDuplicateSelectedWorkouts({ sourceAssignments, selectedWorkoutIds, selectedAthleteIds, targetDate });

  useEffect(() => {
    if (sourceAssignments === null || sourceSelectionInitialized.current) return;
    setSelectedWorkoutIds(sourceWorkoutIds(sourceAssignments));
    sourceSelectionInitialized.current = true;
  }, [sourceAssignments]);

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
    setShowAthleteError(false);
  }

  function toggleWorkout(id: string) {
    setSelectedWorkoutIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
  }

  async function submit() {
    if (selectedAthleteIds.length === 0) {
      setShowAthleteError(true);
      return;
    }
    const outstanding = await onDuplicate(selectedWorkoutIds, selectedAthleteIds, targetDate);
    if (outstanding !== undefined) setSelectedWorkoutIds(outstanding);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Duplicate workouts">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div><h2 className="text-lg font-bold tracking-tight">Duplicate workouts</h2><p className="mt-1 text-sm text-slate-500">From {displayDate(sourceDate)}</p></div>
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-10 rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Cancel</button>
        </div>

        <div className="mt-5 grid gap-5">
          <section className="rounded-xl bg-stone-50 p-4">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Source workouts</p>
            {sourceError !== null ? <p role="alert" className="mt-2 text-sm font-medium text-red-700">{sourceError}</p> : sourceAssignments === null ? <p className="mt-2 text-sm font-medium text-slate-500">Loading workouts…</p> : sourceWorkouts.length === 0 ? <p className="mt-2 text-sm font-medium text-slate-500">No workouts scheduled on this date.</p> : <ul className="mt-2 grid gap-2">{sourceWorkouts.map((workout) => <li key={workout.id}><label className="flex min-h-12 cursor-pointer items-start gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-white"><input type="checkbox" checked={selectedWorkoutIds.includes(workout.id)} onChange={() => toggleWorkout(workout.id)} disabled={submitting} className="mt-0.5 h-4 w-4 accent-teal-600" /><span className="grid gap-0.5"><span className="font-semibold text-slate-800">{workout.name}</span><span className="text-xs font-medium text-slate-500">{workout.exerciseSummary}</span></span></label></li>)}</ul>}
          </section>

          <section>
            <label className="block"><span className="mb-1.5 block text-sm font-semibold text-slate-700">Clients</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} disabled={submitting} placeholder="Search clients" className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:bg-slate-100" /></label>
            <div className="mt-3 flex flex-wrap items-center gap-3"><span className="text-sm font-semibold text-slate-500">Selected ({selectedAthleteIds.length} client{selectedAthleteIds.length === 1 ? "" : "s"})</span>{showAthleteError && <span role="alert" className="text-sm font-semibold text-red-600">Select at least one client.</span>}</div>
            <ul className="mt-2 grid gap-1">{visibleAthletes.length === 0 ? <li className="text-sm font-medium text-slate-500">No clients match that search.</li> : visibleAthletes.map((athlete) => <li key={athlete.id}><label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><input type="checkbox" checked={selectedAthleteIds.includes(athlete.id)} onChange={() => toggleAthlete(athlete.id)} disabled={submitting} className="h-4 w-4 accent-teal-600" />{athlete.name}</label></li>)}</ul>
          </section>

          <DatePickerField label="Target date" value={targetDate} disabled={submitting} onChange={setTargetDate} />
          <p className="text-sm text-slate-500">{selectedWorkoutIds.length} workout{selectedWorkoutIds.length === 1 ? "" : "s"} will be duplicated to {selectedAthleteIds.length} client{selectedAthleteIds.length === 1 ? "" : "s"} on {displayDate(targetDate)}.</p>
          {submitError !== null && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{submitError}</p>}
        </div>

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-12 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">Cancel</button>
          <button type="button" onClick={submit} disabled={submitting || !canDuplicate} className="min-h-12 rounded-xl bg-slate-800 px-5 text-sm font-bold text-white transition hover:bg-slate-900 disabled:bg-slate-300">{submitting ? "Duplicating…" : "Duplicate"}</button>
        </div>
      </div>
    </div>
  );
}
