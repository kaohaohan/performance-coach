# Task: Exercise Progress metric redesign (Performance · Estimated strength · Working sets)

- Date opened: 2026-10-06
- Related contract sections: AGENTS.md §§2, 6, 7, 9, 19; `docs/go-backend-api-contract-v0.1.md` §3.10 (`/training-log`) and §3.11 (`/progress-overview`), both read-only and unchanged; `docs/frontend-ui-spec.md` (Exercise Progress and Progress Overview rows)
- Size (S/M/L/XL, per AGENTS.md §7): M (two sub-tasks, because more than 5 files are touched)
- Depends on: `docs/tasks/2026-10-04-training-history.md` (Exercise Progress page, comparison engine) and `docs/tasks/2026-10-05-coach-progress-overview.md` (overview rows)

## 1. Feasibility Analysis

- Problem / trigger:
  - Exercise Progress has five metric tabs: Top set · Estimated 1RM · Load · Reps · Volume.
  - **Top set and Load always draw the same chart.** The server defines `topSet` as the heaviest set and `maxLoad` as the heaviest load (`apps/api/internal/progress/progress.go`), so `topSet.load == maxLoad` by definition. One tab adds nothing.
  - Splitting Load and Reps into separate charts misleads. For example, 100 kg × 12 @1 → 105 kg × 10 @1 reads as "load improved, reps regressed", although it is one trade-off.
  - RIR is the effort context that makes load and reps comparable, but today it only appears as small `12@2` text.
  - The page should answer one question for the Coach: **"At a similar effort (RIR), did performance on this exercise move forward?"** The flow is raw data → trend → comparison → Coach interpretation. No formula-to-grade step.
- Options considered:
  1. Rename the tabs only.
  2. Collapse to three tabs (Performance · Estimated strength · Working sets), make each chart point one full observation (`load × reps @ RIR`), and add a field-by-field "vs. last time" comparison in the selected-training card.
  3. Option 2 plus a server-side comparison payload (new fields in `/training-log`).
  4. A single composite score (load + reps + RIR → grade).
- Trade-offs:
  - Option 1 does not fix the duplicated chart or RIR visibility.
  - Option 2 is frontend only. Each exposure already carries `topSet {load, reps, rir}`, `setCount`, `volumeLoad`, `estimated1rm` and `events`, and exposures within a unit arrive oldest first. So "previous" is `exposures[index - 1]`, and no API change is needed.
  - Option 3 changes an API contract (AGENTS.md §6) for a calculation that is pure presentation: a three-field diff of two objects the client already has. The PR/event engine, which is business logic, stays on the server either way.
  - Option 4 is explicitly rejected by product (`docs/mvp-specification.md`: no grades or scores).
- Selected option and why: **Option 2.** It is the smallest change that fixes the semantics and keeps the API contract stable.
- Risks & unknowns:
  - **"Working sets" is really "logged sets".** `setCount = len(sets)` and includes EXTRA sets. The data model has no warm-up flag, so warm-ups cannot be excluded. The UI copy says "完成組數 / Sets completed" rather than claiming "working". A true working-set definition belongs with the future muscle-level weekly dosage work.
  - **Missing RIR.** RIR is optional per set. When either side of a comparison lacks RIR, the RIR row reads "未記錄 / Not logged" and no effort sentence is shown. Nothing is inferred.
  - **Bodyweight exposures** (`topSet.load == null`) have no y-value on the Performance chart. As today, they are skipped on the chart but stay in the timeline and in comparisons (load shown as "徒手 / Bodyweight").
  - **Hover does not exist on touch.** Desktop gets a native SVG `<title>` tooltip; on touch, tapping selects the point and the card below shows the full detail.
  - **"Rep increased" event.** The engine only emits `REP_PR` (best-ever reps at a load). "Reps went up vs. last time" is shown only inside the comparison block, derived from the diff. No new engine event type.
- Dependencies / blockers: none. No migration, API change, or auth change.

## 2. Technical Design

### Affected files

Sub-task A (Exercise Progress page):

- `apps/web/lib/exercise-progress.ts`: metric definitions, chart layout, label visibility, comparison helper, point text helpers
- `apps/web/lib/exercise-progress.test.ts`: tests for the above
- `apps/web/components/exercise-progress-view.tsx`: tabs, chart rendering, selected card, comparison block
- `apps/web/lib/i18n/messages/en/progress.ts`, `.../zh-TW/progress.ts`: copy

Sub-task B (overview + docs):

- `apps/web/lib/progress-overview.ts` and `progress-overview.test.ts`: load-up chip shows the delta
- `docs/frontend-ui-spec.md`: Exercise Progress and Progress Overview rows

The overview page component (`app/coach/clients/[athleteId]/page.tsx`) should not need changes, because it renders `chip.label` as-is.

### Metric definitions

```ts
export type Metric = "performance" | "estimated1rm" | "workingSets";
export const METRICS: Metric[] = ["performance", "estimated1rm", "workingSets"];
```

| Tab (zh-TW / en) | y value | Point label | Full text (tooltip / aria) |
| --- | --- | --- | --- |
| 表現 / Performance (default) | `topSet.load` | `12 @2` (reps @ RIR; reps only if RIR missing) | `350 lb × 12 @2` |
| 預估強度 / Estimated strength | `estimated1rm` | `12 @2` | `Estimated 1RM 412 lb · from 350 lb × 12 @2` |
| 完成組數 / Sets completed | `setCount` | `3` | `3 sets · 12,600 lb volume` (volume only when non-null) |

- Removed tabs: Top set (now Performance), Load (identical to Top set), Reps, Volume. `maxLoad`, `totalReps` and `volumeLoad` stay in the `Exposure` type because the API still returns them. `volumeLoad` appears only as detail text (Sets tooltip and the selected card).
- `metricValue()` maps each metric to its value. Only `metricValue` and the text helpers know the field names, so a future dosage metric changes these helpers, not the components.
- Estimated strength: the tab label is "預估強度", with "Estimated 1RM" as a subtitle and an ⓘ note: "根據重量、次數與 RIR 估算，用於觀察長期趨勢，不代表實際測得的 1RM。" The formula lives in Go (`estimated1RM` in `internal/progress`), and the UI only displays the value, so formula and UI are already decoupled. Swapping the formula is a server change with no UI impact.
- Sets chart: y ticks are integers only (`niceTicks` with a minimum step of 1); there are no load-change guides on this tab.

### Chart

- Points keep the other-Coach hollow style, the dashed load-change guides (Performance and Estimated only), and a single teal series. **No green/red**, and no colour encodes good or bad.
- Every point gets `<title>` with the full text. `aria-label` = date + full text.
- **Label visibility** is a new pure function `visibleLabels(points, selectedIndex, minGap = 30): Set<number>`:
  1. The selected point is always labelled, in a stronger style (`fill-slate-900`, weight 700).
  2. Other points are placed greedily from newest to oldest; a label is kept only if its x is at least `minGap` px (viewBox units) from every kept label. Kept labels render lighter (`fill-slate-400`, weight 500).
  - This replaces the current rule ("all labels if ≤ 14 points, else only the selected").
- The selected label stays short (`12 @2`) so it does not overflow the 320-wide viewBox. The full text is in the card directly below.

### Selected training card

Layout (zh-TW example):

```
2026年10月2日 · 第 3 個動作
1. 350 lb × 12 · RIR 2
2. 350 lb × 11 · RIR 1
3. 350 lb × 10 · RIR 1
[重量 PR] [+20 lb]
開啟訓練

與上次相比 · 9月25日
重量   330 → 350 lb   ↑ +20 lb
次數   12 → 12        —
RIR    2 → 2          —
```

- `setSummary` changes from `350 lb · 12 次 · RIR 2` to `350 lb × 12 · RIR 2` (bodyweight: `徒手 × 12 · RIR 2`). This affects both the timeline and the card, which is intended.
- The comparison block **replaces** the current "上一次訓練" card. It names the previous date, and that exposure stays visible in the timeline. When there is no previous exposure in this unit, it shows the existing "以 {unit} 記錄的第一筆。" line.
- RIR is a first-class row. Its direction text is effort-based, not good/bad: RIR up → `↓ effort`, RIR down → `↑ effort`. Neutral slate text for every row, with arrows and signs only.
- Effort sentence (deterministic, shown only when it applies):
  - same load, same reps, RIR higher → "同重量與次數，較低 effort 完成"
  - same load, same reps, RIR lower → "同重量與次數，較高 effort 完成"
  - otherwise none (no sentence when RIR is missing on either side)

### Comparison logic

New pure helper in `lib/exercise-progress.ts`:

```ts
export type FieldDiff = { from: number | null; to: number | null; delta: number | null }; // null = not comparable
export type Comparison = {
  previousDate: string;
  load: FieldDiff;   // null load = bodyweight
  reps: FieldDiff;
  rir: FieldDiff;    // null = not logged
  effort: "lower" | "higher" | null; // set only when load and reps are equal and both RIRs are logged
};
export function compareToPrevious(current: Exposure, previous: Exposure | undefined): Comparison | null;
```

- **Which exposure counts as previous:** the immediately preceding exposure of the same exercise in the **same unit** (kg and lb are never compared), from the full loaded list (`exposures[index - 1]`), even when it falls outside the selected range. Other-Coach exposures count, because they are real training.
- **Which set represents an exposure:** the server's `topSet` (heaviest set; ties → most reps → lowest set number), the same representative the PR engine uses. That keeps the comparison and the event chips consistent.
- `delta` is `to - from` when both sides are numbers, otherwise null. Floating values go through `formatNumber`.

### Overview row (sub-task B)

- Rows already show `350 lb × 12 @2`, PR chips and the estimated-1RM sparkline, with no grades, so they stay as they are.
- `eventChips` keeps keys `loadPr`, `repPr`, `loadUp`, but the `loadUp` label becomes the newest positive `LOAD_CHANGE` delta (`+20 lb`) instead of "↑ 重量". The translation key `progress.overview.chip.loadUp` is dropped.
- No Progressing / Stable / Review labels.

### Frontend state / backward compatibility

- `metric` state defaults to `"performance"`. The metric is not persisted or put in the URL, so there is no migration of saved values.
- No API, schema, or auth change, and existing routes and navigation stay as they are.

## 3. Estimate

- Size: M (about 3–4 h)
- Sub-task breakdown (more than 5 files, so split per AGENTS.md §7):
  1. **A — Exercise Progress page**: metric set, `visibleLabels`, `compareToPrevious`, text helpers, tests; tabs, chart, selected card, comparison block; en + zh-TW copy. Verify with `npm test`, `npm run lint`, and a browser check of a Leg Press page in both units if data allows.
  2. **B — Overview chip + docs**: `+N unit` load-up chip with test; update `docs/frontend-ui-spec.md`. Verify with `npm test` and `npm run lint`.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 inspection | Done | Root cause of duplicate chart: `topSet.load == maxLoad` by definition |
| Task Doc | Done | This file |
| A — Exercise Progress page | Done | `npm test` (19 pass), eslint clean; tsc only reports pre-existing `LayoutProps` in app/layout.tsx (needs generated Next types). Selected card also shows a small `3 sets · volume` line. Browser check not run. |
| B — Overview chip + docs | Done | |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## 5. Outcome (filled at completion)

- Final status: A and B implemented. Full web suite `npm test` 223/223 pass and `eslint` is clean. Browser check of a Leg Press page not yet done.
- Deviations from plan:
  - Sub-tasks A and B ran in parallel implementation sessions. The now-unused `progress.overview.chip.loadUp` key was removed during integration.
  - The selected card also shows `N sets · volume` under the set list.
  - English copy differs from zh-TW where zh-TW keeps English terms (`Estimated 1RM (e1RM)`, `Reps in reserve`, `↓ lower effort` / `↑ higher effort`), because the i18n test rejects zh-TW values identical to en.
- Follow-ups:
  - Timeline fallback for an exposure with no matched session sets still prints the top set without a unit (pre-existing).
  - True working-set definition (exclude warm-ups) together with muscle-level weekly dosage.
  - Optional Progressing / Stable / Review labels, only after "progress" is defined (see `docs/mvp-specification.md`).
