"use client";

import { useMemo, useState } from "react";
import { displayDate, isValidISODate, monthDays, monthLabel, shiftMonth, todayLocalISODate } from "./calendar-date";
import type { Athlete, ScheduledWorkoutSummary } from "./types";

type Step = 1 | 2 | 3;

const STEPS: Array<{ step: Step; label: string }> = [
  { step: 1, label: "Select Copy Date" },
  { step: 2, label: "Calendar Selection" },
  { step: 3, label: "Select Target Date" },
];

function StepRail({ current }: { current: Step }) {
  return (
    <ol className="flex items-center gap-2 border-b border-slate-200 pb-4">
      {STEPS.map(({ step, label }, index) => {
        const done = step < current;
        const active = step === current;
        return (
          <li key={step} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              aria-hidden="true"
              className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${
                done ? "bg-emerald-500 text-white" : active ? "border-2 border-emerald-500 text-emerald-600" : "border-2 border-slate-300 text-slate-400"
              }`}
            >
              {done ? "✓" : step}
            </span>
            <span className={`truncate text-sm font-semibold ${active || done ? "text-slate-800" : "text-slate-400"}`}>{label}</span>
            {index < STEPS.length - 1 && <span aria-hidden="true" className="hidden shrink-0 text-slate-300 sm:inline">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

// A text field showing the chosen date with a month grid that expands beneath
// it. Reuses the calendar's own month helpers rather than a date library.
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
          <input
            type="date"
            value={value}
            disabled={disabled}
            onChange={(event) => { if (isValidISODate(event.target.value)) choose(event.target.value); }}
            className="min-h-12 w-full bg-transparent text-base font-medium outline-none disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => { setMonthAnchor(value); setOpen((previous) => !previous); }}
            disabled={disabled}
            aria-expanded={open}
            aria-label={open ? "Hide calendar" : "Show calendar"}
            className="shrink-0 rounded-lg px-2 py-1 text-sm font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50"
          >
            ▤
          </button>
        </div>
      </label>

      {open && (
        <div className="mt-2 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between gap-2">
            <button type="button" aria-label="Previous month" onClick={() => setMonthAnchor(shiftMonth(monthAnchor, -1))} className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-slate-600 hover:bg-slate-100">‹</button>
            <span className="text-sm font-bold">{monthLabel(monthAnchor)}</span>
            <button type="button" aria-label="Next month" onClick={() => setMonthAnchor(shiftMonth(monthAnchor, 1))} className="grid h-9 w-9 place-items-center rounded-lg text-lg font-bold text-slate-600 hover:bg-slate-100">›</button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-bold uppercase text-slate-400" aria-hidden="true">
            {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((weekday) => <span key={weekday}>{weekday}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-y-1">
            {monthDays(monthAnchor).map((day, index) => day === null ? <span key={`blank-${index}`} className="aspect-square" /> : (
              <button
                key={day}
                type="button"
                onClick={() => choose(day)}
                aria-label={displayDate(day)}
                className={`mx-auto grid aspect-square w-full max-w-10 place-items-center rounded-lg text-sm font-semibold transition ${
                  day === value ? "bg-amber-500 text-white" : day === todayLocalISODate() ? "text-slate-900 ring-1 ring-inset ring-slate-300" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {Number(day.slice(-2))}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function CopyWorkoutWizard({
  athletes,
  sourceDate,
  sourceAssignments,
  sourceError,
  submitting,
  submitError,
  onSourceDateChange,
  onClose,
  onPaste,
}: {
  athletes: Athlete[];
  sourceDate: string;
  sourceAssignments: ScheduledWorkoutSummary[] | null;
  sourceError: string | null;
  submitting: boolean;
  submitError: string | null;
  onSourceDateChange: (date: string) => void;
  onClose: () => void;
  onPaste: (athleteIds: string[], targetDate: string) => void;
}) {
  const [step, setStep] = useState<Step>(1);
  const [selectedAthleteIds, setSelectedAthleteIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [targetDate, setTargetDate] = useState(sourceDate);
  const [showAthleteError, setShowAthleteError] = useState(false);

  const visibleAthletes = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle === "" ? athletes : athletes.filter((athlete) => athlete.name.toLowerCase().includes(needle));
  }, [athletes, query]);

  const sourceWorkouts = sourceAssignments ?? [];
  const canLeaveStepOne = sourceAssignments !== null && sourceWorkouts.length > 0;

  function toggleAthlete(id: string) {
    setSelectedAthleteIds((previous) => previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]);
    setShowAthleteError(false);
  }

  function goToTargetStep() {
    if (selectedAthleteIds.length === 0) {
      setShowAthleteError(true);
      return;
    }
    setStep(3);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4" role="dialog" aria-modal="true" aria-label="Copy Workout">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-3xl bg-white p-5 shadow-xl sm:p-6">
        <div className="flex items-start justify-between gap-3 pb-4">
          <h2 className="text-lg font-bold tracking-tight">Copy Workout</h2>
          <button type="button" onClick={onClose} disabled={submitting} className="min-h-10 rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-50">Close</button>
        </div>

        <StepRail current={step} />

        {step === 1 && (
          <div className="mt-5 grid gap-4">
            <DatePickerField label="Copy training from" value={sourceDate} disabled={submitting} onChange={onSourceDateChange} />
            <div className="rounded-xl bg-stone-50 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Will be copied</p>
              {sourceError !== null ? (
                <p role="alert" className="mt-2 text-sm font-medium text-red-700">{sourceError}</p>
              ) : sourceAssignments === null ? (
                <p className="mt-2 text-sm font-medium text-slate-500">Loading training…</p>
              ) : sourceWorkouts.length === 0 ? (
                <p className="mt-2 text-sm font-medium text-slate-500">No training scheduled on this date.</p>
              ) : (
                <ul className="mt-2 grid gap-1">
                  {sourceWorkouts.map((assignment) => (
                    <li key={assignment.id} className="text-sm font-semibold text-slate-700">{assignment.workout.name}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-5 grid gap-4">
            <label className="block">
              <span className="sr-only">Search athletes</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search Athletes"
                className="min-h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-base font-medium outline-none placeholder:text-slate-400 focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15"
              />
            </label>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-semibold text-slate-500">Selected ({selectedAthleteIds.length} athlete{selectedAthleteIds.length === 1 ? "" : "s"})</span>
              {showAthleteError && <span role="alert" className="text-sm font-semibold text-red-600">Please select at least one athlete calendar</span>}
            </div>

            <ul className="grid gap-1">
              {visibleAthletes.length === 0 ? (
                <li className="text-sm font-medium text-slate-500">No athletes match that search.</li>
              ) : visibleAthletes.map((athlete) => (
                <li key={athlete.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    <input type="checkbox" checked={selectedAthleteIds.includes(athlete.id)} onChange={() => toggleAthlete(athlete.id)} className="h-4 w-4 accent-teal-600" />
                    {athlete.name}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 3 && (
          <div className="mt-5 grid gap-4">
            <DatePickerField label="Paste training to" value={targetDate} disabled={submitting} onChange={setTargetDate} />
            <p className="text-sm text-slate-500">
              {sourceWorkouts.length} workout{sourceWorkouts.length === 1 ? "" : "s"} from {displayDate(sourceDate)} → {selectedAthleteIds.length} athlete{selectedAthleteIds.length === 1 ? "" : "s"} on {displayDate(targetDate)}.
            </p>
            {submitError !== null && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{submitError}</p>}
          </div>
        )}

        <div className="mt-6 grid gap-2">
          {step === 3 ? (
            <button type="button" onClick={() => onPaste(selectedAthleteIds, targetDate)} disabled={submitting || !isValidISODate(targetDate)} className="min-h-13 w-full rounded-xl bg-slate-800 px-5 py-3 text-base font-bold text-white transition hover:bg-slate-900 disabled:bg-slate-300">
              {submitting ? "Pasting…" : "PASTE"}
            </button>
          ) : (
            <button type="button" onClick={() => (step === 1 ? setStep(2) : goToTargetStep())} disabled={step === 1 && !canLeaveStepOne} className="min-h-13 w-full rounded-xl bg-slate-800 px-5 py-3 text-base font-bold text-white transition hover:bg-slate-900 disabled:bg-slate-300">
              NEXT
            </button>
          )}
          <button type="button" onClick={() => (step === 1 ? onClose() : setStep(step === 3 ? 2 : 1))} disabled={submitting} className="min-h-13 w-full rounded-xl border border-slate-300 px-5 py-3 text-base font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50">
            BACK
          </button>
        </div>
      </div>
    </div>
  );
}
