"use client";

import { useT } from "@/lib/i18n";
import type { MessageKey } from "@/lib/i18n";
import type { CalendarView } from "./calendar-date";

// Six keys rather than one "Previous {view}" template: the view noun sits in
// a different place in Chinese, so a shared template would force English word
// order onto it. The maps keep the call sites a single lookup.
const PREVIOUS_LABEL_KEYS: Record<CalendarView, MessageKey> = {
  day: "calendar.toolbar.previousDay",
  week: "calendar.toolbar.previousWeek",
  month: "calendar.toolbar.previousMonth",
};

const NEXT_LABEL_KEYS: Record<CalendarView, MessageKey> = {
  day: "calendar.toolbar.nextDay",
  week: "calendar.toolbar.nextWeek",
  month: "calendar.toolbar.nextMonth",
};

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
  const t = useT();

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label={t(PREVIOUS_LABEL_KEYS[view])}
          onClick={onPrevious}
          disabled={disabled}
          className="grid h-11 w-11 place-items-center rounded-xl text-xl font-bold text-slate-600 transition hover:bg-slate-200/60 disabled:opacity-50"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label={t(NEXT_LABEL_KEYS[view])}
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
          {t("calendar.toolbar.today")}
        </button>
        <label className="block">
          <span className="sr-only">{t("calendar.toolbar.viewLabel")}</span>
          <select
            value={view}
            onChange={(event) => onViewChange(event.target.value as CalendarView)}
            disabled={disabled}
            className="min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-600/15 disabled:opacity-50"
          >
            <option value="day">{t("calendar.view.day")}</option>
            <option value="week">{t("calendar.view.week")}</option>
            <option value="month">{t("calendar.view.month")}</option>
          </select>
        </label>
      </div>
    </div>
  );
}
