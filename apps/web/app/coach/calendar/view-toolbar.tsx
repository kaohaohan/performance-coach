"use client";

import type { CalendarView } from "./calendar-date";

// Controlled toolbar: previous/next, Today, and the Day/Week/Month select,
// with the current range as the heading. Owns no state of its own.
export default function ViewToolbar({
  view,
  rangeLabel,
  disabled,
  onPrevious,
  onNext,
  onToday,
  onViewChange,
}: {
  view: CalendarView;
  rangeLabel: string;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`Previous ${view}`}
          onClick={onPrevious}
          disabled={disabled}
          className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-slate-600 transition hover:bg-slate-200/60 disabled:opacity-50"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label={`Next ${view}`}
          onClick={onNext}
          disabled={disabled}
          className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-slate-600 transition hover:bg-slate-200/60 disabled:opacity-50"
        >
          ›
        </button>
        <h2 className="ml-2 text-lg font-bold tracking-tight">{rangeLabel}</h2>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onToday}
          disabled={disabled}
          className="min-h-11 rounded-full border border-slate-200 bg-white px-5 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
        >
          Today
        </button>
        <label className="block">
          <span className="sr-only">Calendar view</span>
          <select
            value={view}
            onChange={(event) => onViewChange(event.target.value as CalendarView)}
            disabled={disabled}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:opacity-50"
          >
            <option value="day">Day</option>
            <option value="week">Week</option>
            <option value="month">Month</option>
          </select>
        </label>
      </div>
    </div>
  );
}
