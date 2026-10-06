# Task: Exercise Progress comparison v2 (descriptive comparison, quieter chart, drop Sets tab)

- Date opened: 2026-10-06
- Related contract sections: none changed (frontend only; reads `GET /training-log` as-is). Follows `docs/tasks/2026-10-06-exercise-progress-metric-redesign.md`.
- Size (S/M/L/XL, per AGENTS.md §7): M (5 web code files; docs handled separately)

## 1. Feasibility Analysis

- Problem / trigger: After the staging release of the metric redesign, four issues remained: (1) the "vs. last time" block only shows `from → to`, with no sentence saying what happened; (2) the selected card repeats the same fact as chips (MATCHED, REPS_DOWN, ±kg) and as the comparison block; (3) the chart has too many labels and a dashed guide at every load change (noisy, and easy to mistake for the other-Coach marker); (4) the "Sets completed" tab is almost always a flat 3 → 3 → 3.
- Options considered:
  1. Representative set: (a) heaviest set (current), (b) first working set, (c) highest e1RM set.
  2. Sets tab: (A) keep, (B) remove the tab and keep "N sets · volume" in the card, (C) real dosage metric (weekly sets, planned vs done).
  3. Previous exposure: (a) `exposures[index-1]` in the same unit, (b) previous in any unit.
  4. Where to build the sentence: (a) i18n fragments assembled by a pure, tested function, (b) one whole-sentence key per case.
- Trade-offs:
  - 1a is transparent, uses the same set as the server PR engine so chips and comparison never contradict, and is usually the first working set in straight-set programs. 1b needs a warm-up flag that does not exist (the first set is often a warm-up). 1c is an opaque score and needs RIR.
  - 2B is cheap and loses nothing real. 2C needs planned-set or muscle-group data from the backend (out of scope). 2A keeps a flat, misleading chart; working-set count also includes EXTRA sets and cannot exclude warm-ups.
  - 3a keeps kg and lb separate (never converted). 3b would need unit conversion, which is forbidden.
  - 4a is testable and composes the many load/reps/RIR combinations; 4b explodes combinatorially.
- Selected option and why: 1a (state "Compared on the heaviest set" in the UI), 2B, 3a, 4a. Smallest change that completes the review loop with no backend or API change.
- Risks & unknowns:
  - A back-off set can out-rep the top set; the comparison ignores it. Mitigation: the note plus the full set list on the card.
  - Timeline pairing by order and date can mismatch on a same-day double session (pre-existing; backend key is a follow-up).
  - i18n test requires every zh-TW value to differ from its en value.
- Dependencies / blockers: none.

## 2. Technical Design

- Affected files:
  - `apps/web/lib/exercise-progress.ts`
  - `apps/web/components/exercise-progress-view.tsx`
  - `apps/web/lib/i18n/messages/en/progress.ts`, `apps/web/lib/i18n/messages/zh-TW/progress.ts`
  - `apps/web/lib/exercise-progress.test.ts`
  - `docs/frontend-ui-spec.md` (Exercise Progress row only)
- Data flow: unchanged. `compareToPrevious(current, exposures[i-1])` yields a `Comparison`; `comparisonRows` renders the table; `describeComparison` renders the sentence.
- API / schema changes: none.
- Frontend design:
  - `Metric = "performance" | "estimated1rm"`; workingSets removed everywhere (metricValue, pointLabel, pointText, i18n key). `setsText` stays for the card.
  - Chart: `loadChange` dropped from `ChartPoint`/`layoutChart`; dashed lines removed. `visibleLabels(points, selectedIndex)` returns only the selected and latest points. Selected label bold slate-900; latest label normal weight slate-400; `<title>` and aria-labels stay on every point; hollow other-Coach points and teal series unchanged.
  - `Comparison` gains `sameDay` (previous.date === current.date) and `previousSource`. `comparisonRows` returns `{ key, previous, current, change }` for a Last | This | Change table. Change cell: "—" when equal; "↑ +5 kg" / "↓ −1" for load and reps; effort wording for RIR; "Not logged" when missing.
  - `describeComparison(t, comparison, unit)`: pure, descriptive only. If load is unchanged: unchanged fragments (same load, same reps, same RIR) joined with the list separator, then changed fragments joined with the clause separator. If load changed: load change first, then reps and RIR fragments, collapsing to "reps and RIR unchanged" when both are unchanged. RIR up = lower effort, RIR down = higher effort. Missing RIR on either side yields "RIR not logged, effort cannot be compared". All equal yields "Same as last time". Singular "rep" for 1, "reps" otherwise (separate i18n keys per count form).
  - `ComparisonBlock`: heading with previous date; "Earlier the same day" tag when `sameDay`; "Other coach" tag when `previousSource` is OTHER_COACH; 3-column table; sentence; small note "Compared on the heaviest set". Neutral slate only, no red/green.
  - Selected card shows only LOAD_PR and REP_PR chips; timeline entries keep all chips.
- Backward compatibility: none needed; no persisted state.

## 3. Estimate

- Size: M
- Sub-task breakdown: none required (below L).

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc | Done | |
| Pure logic (`describeComparison`, `comparisonRows`, `Comparison`, `visibleLabels`, metric removal) | Done | |
| i18n (en, zh-TW) | Done | workingSets, effortLower, effortHigher keys removed; 6 compare + 16 describe keys added |
| UI (ComparisonBlock, chip filter, chart labels, no dashes) | Done | |
| Tests | Done | every plan section 7 row covered |
| `docs/frontend-ui-spec.md` row | Done | |
| `npm test` and `npm run lint` | Done | 225/225 pass; lint 0 errors (1 pre-existing warning in repeat-week.test.ts); `tsc --noEmit` clean |

## 5. Outcome (filled at completion)

- Final status: Done (not committed; staging check pending)
- Deviations from plan: `visibleLabels` signature widened to `points: unknown[]` (x positions no longer needed). English describe fragments are lowercase and `describeComparison` capitalizes the first character. Separators are i18n keys (zh-TW 、 and ，). Bodyweight (null load both sides) omits the "same load" fragment.
- Follow-ups: (nice to have) exposure pairing key from the API; offset same-day points on the chart; cross-unit hint; later, dosage metrics and warm-up flag.
