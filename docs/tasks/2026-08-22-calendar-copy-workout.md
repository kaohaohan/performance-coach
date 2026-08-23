# Task: Coach Calendar — Copy Workout wizard

- Date opened: 2026-08-22
- Related contract sections: §4 Architecture Boundaries, §6 API Contract Discipline, §7 Task Sizing
- Size (S/M/L/XL, per AGENTS.md §7): M
- Depends on: `2026-08-22-calendar-day-week-month.md` (the day card this attaches to)

## 1. Feasibility Analysis

**Problem / trigger**

A coach who has programmed one good day wants that day's training on other days, and often for several athletes at once. Today the only route is rebuilding it by hand in the inline builder.

The reference UI puts a copy affordance in each day card's header and opens a three-step wizard: ① Select Copy Date → ② Calendar Selection → ③ Select Target Date → PASTE.

**Options considered**

1. **Reuse `POST /api/v1/scheduled-workouts` once per distinct workout on the source day.** That endpoint already takes `{ workoutId, athleteIds[], scheduledDate }` — precisely "put this workout on this date for these athletes".
2. **Add a dedicated copy endpoint** (e.g. `POST /scheduled-workouts/copy` taking source and target dates).
3. **Clipboard model** — a Copy action that arms state, then a Paste action on a target day.

**Trade-offs**

- Option 1: no API change, no contract change, no Phase Gate. Costs one request per distinct workout on the source day (realistically 1–3), and needs explicit partial-failure handling since it is not one atomic call.
- Option 2: atomic and one round trip, but invents a new endpoint for something the existing one already expresses. §6 discourages contract growth without need; it would also need its own authorization and validation surface.
- Option 3: fewest clicks for repeated pastes, but hides state in an invisible mode and does not express "copy to several athletes at once", which is the more valuable half of the reference flow.

**Selected option and why**

Option 1. The existing endpoint is a semantic match, so the whole feature is frontend work. Multi-athlete copy — the part that saves a coach the most time — is supported natively by `athleteIds[]`.

**Deliberately out of scope** — the reference wizard offers these; our domain does not support them:

| Reference control | Why not |
| --- | --- |
| `Prescribed loads` toggle | `POST /scheduled-workouts` takes only `workoutId` and re-snapshots the whole template. Stripping load would require first creating an altered template. |
| `Include workout titles and colors` | No color concept exists; the title necessarily follows the template. |
| `Placement` (top/bottom of workout) | Multiple workouts on one day are independent `ScheduledWorkout` rows, never merged into one, so there is no ordering within a day. |
| `Clear existing workouts` | No DELETE route for scheduled workouts. Adding one is a Go API change requiring its own Phase Gate. |
| `Date Range` source/target | Buildable in the frontend, but adds date-offset mapping and its own verification surface. Deferred. |

**Risks & unknowns**

- Paste **re-schedules from the template**, producing a fresh snapshot — it does not clone the source day's frozen snapshot. Identical today because templates are immutable (no update route); the same debt recorded in the sibling task doc.
- `scheduled_workouts` has no `(athlete, date, workout)` unique constraint, so pasting onto a day that already holds the same workout creates a duplicate row. This is pre-existing behavior (assigning twice already does it) and is not addressed here.
- Partial failure is real: N workouts means N requests. Handled by tracking which workouts still need sending, so a retry never re-sends one that already succeeded.

**Dependencies / blockers**

None beyond the sibling task.

## 2. Technical Design

**Affected files/components** — all under `apps/web/app/coach/calendar/`:

| File | Change |
| --- | --- |
| `copy-workout-wizard.tsx` | New. The three-step modal and its date-picker field. |
| `day-card.tsx` | Modified. Passes the header copy button through to `onCopy`. |
| `page.tsx` | Modified. Wizard state, source-day fetch, paste submission. |

**API changes**

None. Reads `GET /api/v1/scheduled-workouts?from&to&athleteId`; writes `POST /api/v1/scheduled-workouts`.

**Data flow**

1. Copy pressed on a day card → wizard opens with that date as the source.
2. The source day is **fetched**, not read from the in-memory `assignments`: step ① lets the coach move the source date anywhere, including outside the range the current view loaded.
3. Step ② selects athletes from the already-loaded `athletes` list.
4. PASTE → for each distinct `workout.id` on the source day, one `POST /scheduled-workouts` with the chosen `athleteIds` and target date.

**State transitions (paste)**

`idle → sending → done` on full success; `sending → partial` if any request fails. `partial` keeps the modal open holding only the workouts still outstanding, so PASTE resumes rather than restarts.

**Frontend state/UI impact**

- `page.tsx` gains: source date, fetched source assignments, submit-in-flight, error, and the outstanding-workout list.
- The wizard owns its own step, athlete selection, search text, target date, and popover state — all of it discarded on close.
- Step ② disables NEXT and shows `Please select at least one athlete calendar` when nothing is selected, matching the reference.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc | Done | This document |
| `copy-workout-wizard.tsx` | Done | Three steps, step rail with completion ticks, shared month-grid date field |
| `day-card.tsx` — wire copy button | Done | `onCopy` is optional; the button is omitted when no handler is passed |
| `page.tsx` — wizard state, source fetch, paste | Done | Source day fetched per its own date; paste resumes from `copyOutstanding` after partial failure |
| Verification — `npm run lint`, `npx tsc --noEmit`, `npm run build` | Done | All clean |
| Verification — SSR render assertions | Done | Modal semantics, three step labels, source workout list, loading state, step-gated NEXT/PASTE |
| Verification — manual browser pass (plan steps 9–14) | **Blocked** | Same blocker as the sibling task: no auth emulator installed, so no logged-in session |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## 5. Outcome (filled at completion)

- **Final status:** Implemented and locally verified (lint/tsc/build/render assertions). Re-derived, alongside the sibling task, against `origin/main`'s current Coach Calendar file — see that task doc's Outcome for the full account of why a plain rebase was abandoned.
- **Deviations from plan:** Confirmed the owner decision recorded in §1 (Copy is independent of the Build-draft machinery) holds unchanged in the current file: the wizard's fetch/paste logic touches only `copySource*`/`ScheduledWorkout` state, never `draftName`/`draftExercises`/`editorOpen`.
- **Follow-ups:** Same as the sibling task — needs a live manual browser pass (steps 9–14 in the plan) before this ships; not yet run against the rebased file.
