# Task: Athlete Calendar context must be the Build New Workout assignment target

- Date opened: 2026-08-25
- Related contract sections: §5 (Relationship Principle), §6 (no API contract change), §17 (Verification), §19 (docs)
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

**Problem / trigger.** TestFlight report: opening Build New Workout from Hao Han's Aug 26 Athlete Calendar, saving a draft, then resuming it leaves `ASSIGN TO` with the wrong athlete — or with nothing selected and "Select at least one athlete", with the current athlete's checkbox disabled and therefore unselectable. Build & Assign cannot proceed.

**Root cause.** `selectedAthleteIds` was free-floating state, seeded opportunistically at a handful of transitions (`openWorkoutEditor`, `applyCalendarAthlete`, restore, post-assign reset) and mutated freely by the checkboxes. The UI *asserted* an invariant the state machine never maintained: the calendar athlete's checkbox is rendered `disabled` (i.e. "always a target"), but three transitions could leave it out of the list:

1. `applyCalendarAthlete` skipped re-seeding whenever `hasDraftContent` was true — and `hasDraftContent` counted a non-empty athlete selection as draft content, so merely *opening* the builder made it true. Switching athletes then kept the previous athlete as the target while the new athlete's box was disabled and unchecked (stale leak).
2. Draft restore derived the selection from `calendarAthleteId`, which on a fresh page load is just `athletes[0]` — unrelated to the athlete the draft was authored for. The draft persisted its `scheduledDate` but not its athlete, so half its identity was lost on reload.
3. From either state, unchecking the (enabled) wrong athlete emptied the list, and the intended athlete could not be re-checked because its box is disabled — the reported dead end.

**Options considered.**
1. Re-seed `selectedAthleteIds` at the transitions that miss it (patch each site).
2. At submit time, fall back to the calendar athlete when the list is empty.
3. Make the assignment target *derived*: a source athlete (the calendar context, part of the draft's identity alongside its date) plus explicitly-added extras.

**Trade-offs.** (1) leaves the same class of bug one new transition away, and does not fix a restored draft targeting the wrong athlete. (2) makes the submitted set disagree with the checkboxes the Coach is looking at — the failure mode is a silent assignment to someone the UI never showed as selected. (3) makes the invariant structural: the source athlete is a parameter, not a list entry, so no transition can drop it, and the checkboxes and the payload read the same derived list.

**Selected: option 3.** Only it fixes the wrong-athlete-after-reload half, and it removes state rather than adding guards.

**Risks & unknowns.** Draft format change (mitigated by a v1→v2 migration that preserves the Coach's prescription); the deliberate decision in commit `2b87eee` not to replay a prior session's athlete selection must be preserved.

## 2. Technical Design

- **Affected files:** `apps/web/app/coach/calendar/workout-draft.ts`, `apps/web/app/coach/calendar/page.tsx` (+ tests, CI, this doc).
- **API changes:** none. `POST /api/v1/scheduled-workouts` is called with the same `{workoutId, athleteIds, scheduledDate}` shape.
- **Schema changes:** none.
- **Draft serialization:** version 1 → 2. `selectedAthleteIds: string[]` is replaced by `sourceAthleteId: string` (the athlete calendar the draft was started from) + `extraAthleteIds: string[]`. `loadDraft` migrates a v1 draft in place: name/exercises/date/editTarget kept, `sourceAthleteId: ""`, `extraAthleteIds: []`.
- **Frontend state:**
  - `selectedAthleteIds` → `extraAthleteIds` (never contains the source athlete).
  - New `builderAthleteId: string | null`, the counterpart to the existing `builderDate`: together they are the draft's identity. Set when a builder session starts, restored from the draft, cleared only in `resetBuilderDraft`.
  - `authoringAthleteId = builderAthleteId ?? calendarAthleteId` (mirrors `authoringDate`).
  - `assignmentSourceAthleteId = programmingMode === "BUILD" ? authoringAthleteId : calendarAthleteId` — the Existing Workout path has no draft, so it follows the calendar, exactly as it already uses `date` rather than `authoringDate`.
  - `assignmentAthleteIds = assignmentTargets(source, extras)` — one list read by the checkboxes, the submit guard, the validation, and the payload.
  - `isDraftContentEmpty` no longer counts athlete selection, so opening a builder is no longer mistaken for a draft in progress.
- **State transitions:**
  | Transition | Assignment context after |
  | --- | --- |
  | `+ Add Workout` (no draft) | source = calendar athlete, extras = [] |
  | `Resume draft` | unchanged — the draft keeps its own athlete and date |
  | switch calendar athlete, no draft | builder session dropped; next open binds to the new athlete |
  | switch calendar athlete, live draft | draft keeps its athlete; header/banner name it |
  | Save Draft / autosave | persists `sourceAthleteId` + extras |
  | restore | source = draft's athlete (or the calendar athlete if it no longer exists); extras = [] |
  | Build & Assign / Discard | context cleared with the rest of the draft |
- **UI:** the source athlete's checkbox stays checked and disabled (now truthfully); the builder header names the *draft's* athlete; the amber "this draft is for …" banner now covers a different athlete as well as a different date, and the "Move to <date>" button only shows when the date actually differs.
- **Backward compatibility:** v1 drafts migrate; no data backfill.

## 3. Estimate

- Size: M
- Sub-task breakdown: (1) draft v2 + helpers; (2) page state machine; (3) regression tests; (4) CI test step.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — inspection / root cause | Done | Reproduced in a failing test before any fix (Cases C, D, G). |
| Draft v2 + `assignmentTargets`/`toggleExtraAthlete` + v1 migration | Done | |
| `page.tsx` derived assignment context | Done | |
| Regression tests (Cases A–H + serialization) | Done | 26 tests, vitest + jsdom. |
| CI: run web tests | Done | New `npm test` step. |
| Verification (lint / test / build / typecheck) | Done | All green. |

## 5. Outcome

- Final status: complete; pushed to the feature branch for Preview/Staging verification. Not deployed to Production.
- Deviations from plan: added frontend test tooling (vitest, jsdom, RTL) — the repo had none for `apps/web`, and this bug is purely a frontend state-machine defect.
- Follow-ups:
  - **Discard Draft vs. an assigned workout.** `handleDiscardDraft` is shared by both draft kinds. For an Edit Assigned Workout draft (`editTarget`) it discards the local edits while its NOT STARTED `ScheduledWorkout` legitimately stays on the calendar, yet the confirmation says "Everything unsaved in the builder will be permanently deleted." That wording, not the assignment state, is the likely source of the separate "Discard Draft leaves a NOT STARTED workout" report. Nothing in the draft path creates a `ScheduledWorkout`; that only happens in Build & Assign, Assign (existing workout), and Copy/Paste. Deliberately not changed here.
