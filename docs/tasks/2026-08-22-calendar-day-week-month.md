# Task: Coach Calendar — Day / Week / Month views

- Date opened: 2026-08-22
- Related contract sections: §4 Architecture Boundaries, §6 API Contract Discipline, §7 Task Sizing
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

**Problem / trigger**

`/coach/calendar` is the coach's primary programming workspace (`docs/frontend-ui-spec.md`), but it has exactly one view: a mini month picker on the left, one selected day plus the inline builder on the right. To see how training is distributed across a week or a month, the coach must click through one day at a time.

The requested addition is a Day / Week / Month view switcher with `‹ ›` navigation, a `Today` action, and compact per-day cards showing the prescribed exercises.

**Options considered**

1. **Frontend-only, joining `GET /workouts` for exercise detail.** The calendar already fetches `GET /api/v1/workouts`, which already returns each template's full `exercises[].plan`. Join `assignment.workout.id` against that list to render exercise names and `sets x reps`.
2. **Extend `ListForCoach` to expand the frozen prescription snapshot.** Add exercises to the `GET /scheduled-workouts` response so cards read the snapshot rather than the live template.
3. **Fetch per-card detail on demand.** One request per day card.

**Trade-offs**

- Option 1: zero API change, zero extra requests, all data already in memory. Reads the *live template*, not the frozen snapshot taken at scheduling time — a correctness gap if templates ever become editable.
- Option 2: semantically correct against the snapshot. But it contradicts an explicit design decision recorded in the `scheduledworkout` package comment ("exercise prescriptions and set logs stay behind `GET /sessions/{id}` — deliberately not duplicated there"), enlarges the coach list payload for every caller, and turns a frontend task into a full-stack one requiring a Phase Gate.
- Option 3: Month view renders up to 42 cards, so up to 42 requests per view change. Rejected on cost alone.

**Selected option and why**

Option 1. The API exposes **no update or delete route for workouts** (`cmd/api/main.go:110-131`) — only `POST` and `GET`. Templates are therefore immutable in the current system, which means the live template and the scheduling snapshot **cannot** diverge. The correctness gap that makes option 1 theoretically wrong does not exist yet, and option 1 costs nothing.

**Risks & unknowns**

- **Known debt:** the moment a "edit workout template" route is added, this join becomes wrong — the card would show edited numbers while the athlete's assigned session keeps the old snapshot. At that point this must be migrated to option 2. Recorded here so the decision is not silently inherited.
- An archived template would drop out of `GET /workouts` (its query filters `archived_at IS NULL`) and the card would fall back to name-only. No archive route exists today; the fallback is handled defensively.

**Dependencies / blockers**

None. No schema, API, or migration work.

## 2. Technical Design

**Affected files/components** — all under `apps/web/app/coach/calendar/`:

| File | Change |
| --- | --- |
| `calendar-date.ts` | New. Date helpers moved out of `page.tsx`, plus view-aware range/label helpers. |
| `day-card.tsx` | New. Compact day card shared by Week and Month. |
| `view-toolbar.tsx` | New. `‹ ›`, `Today`, view select, range label. Controlled; owns no state. |
| `page.tsx` | Modified. Adds `view` state, view-aware fetching, per-view layout. |

**Data flow**

`(date, view)` → `visibleRange(date, view)` → `GET /api/v1/scheduled-workouts?from&to&athleteId` → `assignments`.
`GET /api/v1/workouts` (already fetched) → `exercisesByWorkoutId` lookup → card exercise rows.

No request shape changes; `from`/`to`/`athleteId` are all already supported (`cmd/api/main.go:796-818`). The endpoint has no range-length cap, so the Month range is valid as-is.

**API changes**

None.

**Frontend state/UI impact**

- New state: `view: "day" | "week" | "month"`, default `"day"`.
- `Workout` type corrected to include `exercises` — the API already returns it, the local type simply under-declared it.
- Assignment fetching moves from `monthBounds(date)` to `visibleRange(date, view)`, and pushes the athlete filter into the query string instead of filtering client-side after fetching every athlete's assignments.
- `visibleRange` for `month` covers the **whole 6-week grid**, including leading/trailing days from adjacent months. This incidentally fixes an existing defect: `monthDays()` emits `null` for leading blanks, so training scheduled on those adjacent-month days was never visible.
- Day view renders exactly as before. Week renders 7 horizontally scrollable columns; Month renders a 7-column grid.
- **The inline builder is not duplicated.** Week/Month `+ Add Workout` selects that date and opens the *same* builder markup, relocated to a shared panel below the grid. Builder internals (`DraftExerciseCard`, `ExercisePicker`, `PickerGroup`, draft state, validation) are untouched.

**Deliberate deviation from the reference UI**

The reference screenshots show a per-day footer of `S {n} R {n} V {n}`, where R and V are *actually completed* reps and volume (they read 0 in every screenshot because nothing had been trained). The coach list endpoint carries no set logs, so actuals are unavailable here. This card shows **planned** totals instead, and omits V: planned volume needs load, and per-exercise `kg`/`lb` units cannot be summed into one number. Footer is `S {planned sets} · R {planned reps}`.

**Backward compatibility**

Day view is behavior-preserving; it is the primary regression target.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc | Done | This document |
| `calendar-date.ts` — move helpers + add view-aware range/label | Done | 22 assertions pass in a scratch harness (week boundaries, 6-week grid, month clamping, year rollover, range labels) |
| `types.ts` — shared response shapes | Done | Added: `Workout` had under-declared the `exercises` the API already returns |
| `day-card.tsx` — compact card, both densities | Done | 11 assertions pass; reproduces the reference screenshots' S 17 / S 26 / S 20 footers |
| `view-toolbar.tsx` — nav / Today / view select | Done | |
| `page.tsx` — view state, fetching, layout branches, shared builder panel | Done | Builder extracted to one `workoutEditor` value rendered by all three views |
| Verification — `npm run lint`, `npx tsc --noEmit`, `npm run build` | Done | All clean |
| Verification — SSR render assertions | Done | 29 assertions against real rendered markup: 7 week cards / 42 month cells, exercise rows, `4 x 8`, footer `S 17` / `R 152`, single inverted today pill, spill-over dimming |
| Verification — manual browser pass, first integration (plan steps 2–8) | Done | Local stack up (Postgres + Firebase Auth emulator + Go API + Next dev). Found and fixed two bugs: ViewToolbar mounted inside the dark `<header>` (white-on-white select text) and the Week scroll container clipping the selected card's ring outline. |
| **Rebase onto `origin/main`** | Done | See Outcome — required re-deriving the integration, not a mechanical merge. |
| Verification — re-run after rebase (`lint`/`tsc`/`build`) | Done | All clean |
| Verification — re-run SSR render assertions after rebase | Done | 11 assertions against the rebased `day-card.tsx`/`view-toolbar.tsx`/`copy-workout-wizard.tsx`, including a regression check for the `selectedDate`/`monthAnchor` prop split |
| Verification — manual browser pass, post-rebase | Not Started | Not yet re-run against the richer file (draft persistence + Edit Assigned Workout + guarded view switching). Recommended before this ships. |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## 5. Outcome (filled at completion)

- **Final status:** Implemented and locally verified (lint/tsc/build/render assertions). Not yet re-verified live in a browser after the rebase below, and not yet deployed anywhere.
- **Deviations from plan — the rebase.** The branch was originally cut from a local branch (`docs/reconcile-canonical-docs`) that had silently diverged from `origin/main` by 19 commits and was never pushed. `origin/main` had, in that gap, added substantial new Coach Calendar functionality to the *same file* this task touches — browser-local Build-draft persistence (autosave to localStorage, restore-on-load), Edit Assigned Workout (`GET`/`PUT /api/v1/scheduled-workouts/{id}`), and an unsaved-changes confirmation dialog (`shouldGuardNav`/`pendingNav`/`ConfirmDialog`) guarding date and athlete navigation. A plain `git rebase`/merge produced 11 conflict hunks across ~1800 lines and was abandoned as unsafe to resolve mechanically. The feature was instead re-derived by hand against the current file:
  - `PendingNav` extended with a `{ kind: "view" }` variant; switching Day/Week/Month while an unsaved draft is open now guards through the exact same dialog as switching date/athlete (owner decision, 2026-08-22).
  - Added `weekAnchor` state, kept in sync with `date` by `applyCalendarDate` exactly like the existing `viewMonth`/`date` split — Week paging (`shiftWeekAnchor`) browses without moving the selection, mirroring the established `shiftViewMonth` pattern instead of inventing a new one.
  - `day-card.tsx`'s single `anchorDate` prop was split into `selectedDate` and `monthAnchor`, since Month view can now be paged to a month that does not contain the selected day — a case that could not arise in the original (pre-rebase) design.
  - `Workout`/`WorkoutExercise` moved into `types.ts` and are imported by `page.tsx` in place of its own local shallow `{id,name}` `Workout` type — same "under-declared" fix as before, just applied to the current file.
  - `openWorkoutEditor()` gained an optional `targetDate` parameter (defaulting to `date`, so the existing Day-view call site is unchanged) so the new `openWorkoutEditorOn(targetDate)` — used by Week/Month "+ Add Workout" — can route through the guarded `selectCalendarDate` and then open the builder for the *passed* date, not a stale closed-over one.
  - Copy Workout wizard integration was unaffected by any of the above: it reads/writes `ScheduledWorkout`s directly and never touches `draftName`/`draftExercises`/`editorOpen` (owner decision, 2026-08-22).
- **Follow-ups:**
  - Re-run the full manual browser pass against the rebased file before this is considered done — the render/lint/build checks do not exercise the draft-guard interaction with the new view switcher live.
  - `origin/main` also added `PUT /api/v1/scheduled-workouts/{id}`. This is unrelated to the "no route updates a Workout template" assumption behind joining `GET /workouts` for card exercise detail (still accurate — that route edits one assignment's frozen snapshot, not the template), but is worth a second look if a future task widens what Week/Month cards read.
