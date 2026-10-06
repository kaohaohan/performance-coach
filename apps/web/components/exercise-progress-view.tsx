"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { useLocale, useT, type MessageKey } from "@/lib/i18n";
import { monthDay, monthDayYear } from "@/lib/i18n/dates";
import { errorMessage, type ErrorPolicy } from "@/lib/i18n/errors";
import { localizeExerciseName } from "@/lib/i18n/exercise-names";
import { AppHeader } from "@/components/app-header";
import {
  MAX_WINDOWS, METRICS, RANGES, buildTimeline, compareToPrevious, comparisonRows, describeComparison, eventLabel, exerciseNameFrom, filterSince, initialWindows, layoutChart, mergeWindows,
  localToday, pointText, rangeCutoff, setSummary, setsText, visibleLabels, windowBounds,
  type Chart, type Comparison, type Exposure, type LogSession, type Metric, type ProgressEvent, type RangeKey, type TimelineEntry, type TrainingLog,
} from "@/lib/exercise-progress";

type Role = "COACH" | "ATHLETE";

// The Go API is the authority on why it rejected a call, so its own copy is
// passed through; anything else falls back to errors.unexpected.
const API_ERROR_POLICY: ErrorPolicy = { serverMessage: true };

// Exercise Progress: the same read-only view for the Coach
// (/coach/clients/[athleteId]/exercises/[exerciseId]) and the Athlete
// (/history/exercises/[exerciseId]). One request per 184-day window; kg and lb
// are never converted, so each unit gets its own chart and timeline.
export function ExerciseProgressView({ mode, exerciseId, athleteId }: { mode: "coach" | "athlete"; exerciseId: string; athleteId?: string }) {
  const router = useRouter();
  const { user, idToken, loading: authLoading } = useAuth();
  const t = useT();
  const { locale } = useLocale();
  const [role, setRole] = useState<Role | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windows, setWindows] = useState<TrainingLog[]>([]);
  const [exhausted, setExhausted] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [target, setTarget] = useState(initialWindows("3m"));
  const [range, setRange] = useState<RangeKey>("3m");
  const [metric, setMetric] = useState<Metric>("performance");
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [today] = useState(localToday);
  const requestId = useRef(0);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!idToken) return;
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<{ role: Role }>(idToken, "/api/v1/me");
        if (cancelled) return;
        if (mode === "coach" && me.role === "ATHLETE") router.replace(`/history/exercises/${exerciseId}`);
        else if (mode === "athlete" && me.role === "COACH") router.replace("/coach/calendar");
        else setRole(me.role);
      } catch (e) {
        if (!cancelled) setError(errorMessage(t, e, API_ERROR_POLICY));
      }
    })();
    return () => { cancelled = true; };
  }, [idToken, mode, exerciseId, router, t]);

  // Fetch the next older window until `target` windows are loaded.
  useEffect(() => {
    if (!idToken || role === null || fetching || exhausted || error || windows.length >= target) return;
    const index = windows.length;
    const { from, to } = windowBounds(today, index);
    const query = new URLSearchParams({ from, to, exerciseId, status: "COMPLETED" });
    if (mode === "coach" && athleteId) query.set("athleteId", athleteId);
    const id = ++requestId.current;
    (async () => {
      setFetching(true);
      try {
        const result = await apiFetch<TrainingLog>(idToken, `/api/v1/training-log?${query.toString()}`);
        if (id !== requestId.current) return;
        setWindows((current) => [...current, result]);
        const anyNewer = windows.some((w) => w.sessions.length > 0);
        if (index + 1 >= MAX_WINDOWS || (result.sessions.length === 0 && anyNewer)) setExhausted(true);
      } catch (e) {
        if (id === requestId.current) setError(errorMessage(t, e, API_ERROR_POLICY));
      } finally {
        if (id === requestId.current) setFetching(false);
      }
    })();
  }, [idToken, role, fetching, exhausted, error, windows, target, today, exerciseId, athleteId, mode, t]);

  const merged = useMemo(() => mergeWindows(windows), [windows]);
  const cutoff = rangeCutoff(range, today);
  const exerciseName = exerciseNameFrom(merged.sessions, exerciseId);
  const athleteName = merged.sessions[0]?.athlete.name ?? null;
  const backHref = mode === "coach" ? `/coach/clients/${athleteId}` : "/today";

  if (authLoading || (user && !idToken) || (user && role === null && !error)) {
    return <main className="min-h-screen bg-stone-100 p-6 text-slate-700">{t("common.loading")}</main>;
  }
  if (!user) return null;
  if (error) return <main className="min-h-screen bg-stone-100 p-6"><p role="alert" className="mx-auto max-w-lg rounded-2xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700 ring-1 ring-red-600/10">{error}</p></main>;

  const loadedFirst = windows.length > 0;
  const units = Object.keys(merged.exposures ?? {}).sort((a, b) => (a === b ? 0 : a === "kg" ? -1 : b === "kg" ? 1 : a.localeCompare(b)));
  const hasData = units.some((unit) => filterSince(merged.exposures?.[unit] ?? [], cutoff).length > 0);

  function chooseRange(next: RangeKey) {
    setRange(next);
    setTarget((current) => Math.max(current, initialWindows(next)));
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-stone-100 pb-[max(2rem,env(safe-area-inset-bottom))] text-slate-900">
      <AppHeader>
        <h1 className="mt-3 break-words text-3xl font-semibold tracking-tight">{exerciseName ? localizeExerciseName(exerciseName, locale) : t("progress.unknownExercise")}</h1>
        <p className="mt-2 text-sm text-slate-300">{[t("progress.title"), mode === "coach" ? athleteName : null].filter(Boolean).join(" · ")}</p>
        <Link href={backHref} className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-slate-600 px-4 text-sm font-bold text-white transition hover:border-slate-400 hover:bg-slate-900">{t(mode === "coach" ? "progress.backToClient" : "progress.backToToday")}</Link>
      </AppHeader>

      <div className="mx-auto -mt-3 flex max-w-lg flex-col gap-4 px-4">
        <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-950/5">
          <Switch label={t("progress.metricLabel")} options={METRICS.map((m) => ({ value: m, text: t(`progress.metric.${m}` as MessageKey) }))} value={metric} onChange={setMetric} />
          <div className="mt-3"><Switch label={t("progress.rangeLabel")} options={RANGES.map((r) => ({ value: r, text: t(`progress.range.${r}` as MessageKey) }))} value={range} onChange={chooseRange} /></div>
          {metric === "estimated1rm" && (
            <div className="mt-3 text-xs leading-5 text-slate-500">
              <p className="font-semibold text-slate-700">{t("progress.metric.estimated1rmSubtitle")}</p>
              <p>ⓘ {t("progress.estimated1rmNote")}</p>
            </div>
          )}
        </section>

        {!loadedFirst || (fetching && windows.length < initialWindows(range)) ? (
          <div className="rounded-3xl bg-white p-5 text-sm font-medium text-slate-500 shadow-sm ring-1 ring-slate-950/5">{t("progress.loading")}</div>
        ) : !hasData ? (
          <div className="rounded-3xl border border-dashed border-slate-200 bg-stone-50 px-5 py-5"><p className="font-semibold">{t("progress.empty")}</p></div>
        ) : units.map((unit) => (
          <UnitSection
            key={unit}
            unit={unit}
            exposures={merged.exposures?.[unit] ?? []}
            sessions={merged.sessions}
            exerciseId={exerciseId}
            cutoff={cutoff}
            metric={metric}
            selectedIndex={selected[unit]}
            onSelect={(index) => setSelected((current) => ({ ...current, [unit]: index }))}
          />
        ))}

        {range === "all" && loadedFirst && (
          exhausted && !fetching ? <p className="px-1 text-center text-sm text-slate-500">{t("progress.noEarlier")}</p> : (
            <button type="button" disabled={fetching} onClick={() => setTarget(windows.length + 1)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-800 disabled:opacity-50">{fetching ? t("progress.loadingEarlier") : t("progress.loadEarlier")}</button>
          )
        )}
      </div>
    </main>
  );
}

function Switch<V extends string>({ label, options, value, onChange }: { label: string; options: { value: V; text: string }[]; value: V; onChange: (value: V) => void }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)} className={`min-h-11 rounded-xl px-3 text-sm font-bold transition ${option.value === value ? "bg-slate-950 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>{option.text}</button>
      ))}
    </div>
  );
}

function UnitSection({ unit, exposures, sessions, exerciseId, cutoff, metric, selectedIndex, onSelect }: {
  unit: string;
  exposures: Exposure[];
  sessions: LogSession[];
  exerciseId: string;
  cutoff: string | null;
  metric: Metric;
  selectedIndex: number | undefined;
  onSelect: (index: number) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const timeline = useMemo(() => buildTimeline(unit, sessions, exposures, exerciseId), [unit, sessions, exposures, exerciseId]);
  const visible = useMemo(() => exposures.map((exposure, index) => ({ exposure, index })).filter((v) => filterSince([v.exposure], cutoff).length > 0), [exposures, cutoff]);
  const chart = useMemo(() => layoutChart(visible.map((v) => v.exposure), metric), [visible, metric]);
  if (visible.length === 0) return null;

  const current = selectedIndex !== undefined && visible.some((v) => v.index === selectedIndex) ? selectedIndex : visible[visible.length - 1].index;
  const entry = timeline.find((e) => e.index === current);
  const comparison = compareToPrevious(exposures[current], exposures[current - 1]);
  const visibleTimeline = timeline.filter((e) => visible.some((v) => v.index === e.index));
  const anyOtherCoach = visible.some((v) => v.exposure.source === "OTHER_COACH");

  return (
    <section className="rounded-3xl bg-white p-4 shadow-sm ring-1 ring-slate-950/5">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{t("progress.unitHeading", { unit })}</p>
      <div className="mt-3">
        {chart.points.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">{t("progress.noPoints")}</p> : (
          <ProgressChart chart={chart} unit={unit} metric={metric} caption={t("progress.chartLabel", { metric: t(`progress.metric.${metric}` as MessageKey), unit })} selected={current} indexMap={visible.map((v) => v.index)} onSelect={onSelect} locale={locale} />
        )}
      </div>
      {anyOtherCoach && <p className="mt-2 flex items-center gap-2 text-xs text-slate-500"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2 border-teal-700 bg-white" />{t("progress.legend.otherCoach")}</p>}

      {entry && (
        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
          <SessionCard heading={t("progress.selected.heading")} entry={entry} locale={locale} unit={unit} />
          {comparison ? <ComparisonBlock comparison={comparison} unit={unit} locale={locale} /> : <p className="text-sm text-slate-500">{t("progress.selected.firstTime", { unit })}</p>}
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-4">
        <h2 className="text-sm font-bold">{t("progress.timeline.heading")}</h2>
        <ul className="mt-3 grid gap-3">
          {visibleTimeline.map((e) => (
            <li key={`${e.exposure.date}-${e.index}`} className={`rounded-2xl p-3 ring-1 ${e.index === current ? "bg-teal-50 ring-teal-600/20" : "bg-stone-50 ring-slate-950/5"}`}>
              <TimelineBody entry={e} locale={locale} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SessionCard({ heading, entry, locale, unit }: { heading: string; entry: TimelineEntry; locale: Parameters<typeof monthDay>[0]; unit: string }) {
  const t = useT();
  return (
    <div className="rounded-2xl bg-teal-50 p-3 ring-1 ring-teal-600/20">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{heading}</p>
      <TimelineBody entry={entry} locale={locale} prOnly />
      <p className="mt-2 text-xs text-slate-500">{setsText(t, entry.exposure, unit)}</p>
    </div>
  );
}

// "vs. last time": a Last | This | Change table plus one descriptive sentence,
// in neutral slate. RIR direction describes effort, never good or bad.
function ComparisonBlock({ comparison, unit, locale }: { comparison: Comparison; unit: string; locale: Parameters<typeof monthDay>[0] }) {
  const t = useT();
  const rows = comparisonRows(t, comparison, unit);
  return (
    <div className="rounded-2xl bg-stone-50 p-3 ring-1 ring-slate-950/5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-sm font-bold">{t("progress.compare.heading", { date: monthDay(locale, comparison.previousDate) })}</p>
        {comparison.sameDay && <span className="text-[11px] font-medium text-slate-500">{t("progress.compare.sameDay")}</span>}
        {comparison.previousSource === "OTHER_COACH" && <span className="text-[11px] font-medium text-slate-500">{t("progress.compare.otherCoach")}</span>}
      </div>
      <table className="mt-2 w-full text-sm text-slate-700">
        <thead>
          <tr className="text-left text-xs text-slate-500">
            <td className="py-1 pr-2" />
            <th scope="col" className="py-1 pr-2 font-medium">{t("progress.compare.last")}</th>
            <th scope="col" className="py-1 pr-2 font-medium">{t("progress.compare.this")}</th>
            <th scope="col" className="py-1 text-right font-medium">{t("progress.compare.change")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="py-1 pr-2 text-left font-normal text-slate-500">{t(`progress.compare.${row.key}` as MessageKey)}</th>
              <td className="py-1 pr-2 tabular-nums">{row.previous}</td>
              <td className="py-1 pr-2 tabular-nums">{row.current}</td>
              <td className="py-1 text-right tabular-nums">{row.change}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-slate-700">{describeComparison(t, comparison, unit)}</p>
      <p className="mt-1 text-[11px] text-slate-500">{t("progress.compare.basis")}</p>
    </div>
  );
}

function TimelineBody({ entry, locale, prOnly = false }: { entry: TimelineEntry; locale: Parameters<typeof monthDay>[0]; prOnly?: boolean }) {
  const t = useT();
  const { exposure, sets, sessionId } = entry;
  // The selected card is followed by the comparison block, so it only keeps PR chips.
  const events = prOnly ? exposure.events.filter((e) => e.type === "LOAD_PR" || e.type === "REP_PR") : exposure.events;
  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-bold">{monthDayYear(locale, exposure.date)}</span>
        {exposure.source === "OTHER_COACH" && <span className="text-[11px] font-medium text-slate-500">{t("progress.otherCoach")}</span>}
        <span className="text-[11px] font-medium text-slate-500">{t("progress.position", { position: exposure.position })}</span>
      </div>
      <ul className="mt-1 grid gap-0.5 text-sm text-slate-700">
        {sets.length > 0
          ? sets.map((set) => <li key={set.setNumber} className="tabular-nums">{set.setNumber}. {setSummary(t, set)}</li>)
          : <li className="tabular-nums">{setSummary(t, { load: exposure.topSet.load, unit: undefined, reps: exposure.topSet.reps, rir: exposure.topSet.rir })}</li>}
      </ul>
      {events.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {events.map((event, i) => <EventChip key={`${event.type}-${i}`} event={event} />)}
        </div>
      )}
      {sessionId && <Link href={`/session/${sessionId}`} className="mt-2 inline-block text-sm font-bold text-teal-700">{t("progress.openSession")}</Link>}
    </div>
  );
}

function EventChip({ event }: { event: ProgressEvent }) {
  const t = useT();
  const pr = event.type === "LOAD_PR" || event.type === "REP_PR";
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${pr ? "bg-teal-50 text-teal-700 ring-teal-600/20" : "bg-slate-100 text-slate-600 ring-slate-500/10"}`}>{eventLabel(t, event)}</span>;
}

// Inline SVG: no chart library. Only the selected point (bold) and the latest
// point (plain, light) are labelled; every point keeps a tooltip and aria-label.
// Other-Coach points are hollow.
function ProgressChart({ chart, unit, metric, caption, selected, indexMap, onSelect, locale }: { chart: Chart; unit: string; metric: Metric; caption: string; selected: number; indexMap: number[]; onSelect: (index: number) => void; locale: Parameters<typeof monthDay>[0] }) {
  const { points, yTicks, xTicks, width, height, plot } = chart;
  const t = useT();
  const labelled = visibleLabels(points, points.findIndex((p) => indexMap[p.index] === selected));
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label={caption} className="h-auto w-full touch-manipulation select-none">
      {yTicks.map((tick) => (
        <g key={tick.label}>
          <line x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} className="stroke-slate-200" strokeWidth={1} />
          <text x={plot.left - 6} y={tick.y + 3} textAnchor="end" className="fill-slate-500" fontSize={10}>{tick.label}</text>
        </g>
      ))}
      <polyline fill="none" className="stroke-teal-600" strokeWidth={1.5} points={points.map((p) => `${p.x},${p.y}`).join(" ")} />
      {points.map((p, pi) => {
        const fullIndex = indexMap[p.index];
        const isSelected = fullIndex === selected;
        const full = pointText(t, p.exposure, metric, unit);
        return (
          <g key={p.index}>
            {isSelected && <circle cx={p.x} cy={p.y} r={8} className="fill-none stroke-slate-900" strokeWidth={1.5} />}
            <circle cx={p.x} cy={p.y} r={4} strokeWidth={2} className={`stroke-teal-700 ${p.hollow ? "fill-white" : "fill-teal-700"}`} />
            {labelled.has(pi) && <text x={p.x} y={p.y - 11} textAnchor="middle" className={isSelected ? "fill-slate-900" : "fill-slate-400"} fontSize={9} fontWeight={isSelected ? 700 : 400}>{p.label}</text>}
            <circle
              cx={p.x} cy={p.y} r={14} fill="transparent" role="button" tabIndex={0}
              aria-pressed={isSelected} aria-label={`${monthDay(locale, p.exposure.date)} ${full}`}
              className="cursor-pointer outline-none focus-visible:stroke-slate-900"
              onClick={() => onSelect(fullIndex)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(fullIndex); } }}
            ><title>{full}</title></circle>
          </g>
        );
      })}
      {xTicks.map((tick, i) => (
        <text key={`${tick.date}-${i}`} x={tick.x} y={height - 8} textAnchor={xTicks.length === 1 ? "middle" : i === 0 ? "start" : "end"} className="fill-slate-500" fontSize={10}>{monthDay(locale, tick.date)}</text>
      ))}
    </svg>
  );
}
