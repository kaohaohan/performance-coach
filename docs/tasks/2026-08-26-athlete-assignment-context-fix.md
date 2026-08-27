# Task: Athlete assignment context for Calendar Build New Workout

- Date opened: 2026-08-26
- Related contract sections: AGENTS.md §§6–9, 17–19, 21; `docs/frontend-ui-spec.md` §3; `docs/mvp-specification.md` Story 1
- Size (S/M/L/XL, per AGENTS.md §7): M
- Audited staging SHA: `0e1b7cdb1cee2cc80c3d736ca313237ec6bcddb5` (`origin/staging`)

## 1. Feasibility Analysis

- Problem / trigger:
  - Opening Build New Workout from athlete A's Calendar seeds `ASSIGN TO` with A. That seed is counted as draft content. Switching the Calendar to athlete B then leaving/resuming the draft can show B (header, disabled checkbox) while `selectedAthleteIds` still contains A. Unchecking A reaches a zero-target dead-end; leaving A checked silently assigns to A. Reload rebinds a new-workout draft to `athletes[0]`, dropping the authored athlete.
- Options considered:
  1. Re-seed `selectedAthleteIds` at each transition that currently misses it.
  2. At submit time, fall back to the browsing Calendar athlete when the list is empty.
  3. Derive assignment targets from a source athlete (the Calendar the builder was opened from) plus explicitly added extras; persist that split as draft v2.
- Trade-offs (per option):
  - Option 1 leaves the same class of bug one new transition away and does not give a restored draft an athlete identity.
  - Option 2 can submit an athlete the checkboxes never showed as selected.
  - Option 3 matches the existing `builderDate` vs browsing-date split, makes the source un-droppable, and lets checkboxes and `POST /scheduled-workouts` read one list.
- Selected option and why:
  - Option 3. Cherry-picking `origin/claude/athlete-assignment-context-bug-hpbpjq` is rejected: it was cut from `e5989e3` (before discard/unassign, duplicate-day, and later Calendar work) and pulled in vitest/lockfile churn. The semantic model is re-derived against current staging. v1 migration is stricter than that branch: only `selectedAthleteIds[0]` may become source; otherwise the draft is dropped.
- Risks & unknowns:
  - Existing in-browser v1 drafts whose `[0]` is disconnected are discarded (prescription lost, never mis-assigned).
  - `page.tsx` is large and untested as a component; regression coverage lives in pure helpers under `node:test`.
- Dependencies / blockers:
  - None. No API, schema, iOS, auth, or production change.

## 2. Technical Design

- Affected files/components:
  - `apps/web/app/coach/calendar/workout-draft.ts`
  - `apps/web/app/coach/calendar/workout-draft.test.ts` (new)
  - `apps/web/app/coach/calendar/page.tsx`
  - `docs/frontend-ui-spec.md`
  - this Task Doc
- Data flow:
  - Builder open from athlete X sets `builderAthleteId = X`, `extraAthleteIds = []`.
  - `assignmentTargets(source, extras)` is the list for Assign-to checkboxes, validation, and `athleteIds` on Build & Assign / Assign.
  - Autosave persists `{ sourceAthleteId, extraAthleteIds }` as draft version 2.
  - Restore requires the source to still be connected; extras are filtered to still-connected, deduped, and source-excluded.
- Schema changes: none.
- API changes: none. `POST /api/v1/scheduled-workouts` still receives `{ workoutId, athleteIds, scheduledDate }`.
- State transitions:

  | Transition | Assignment context after |
  | --- | --- |
  | `+ Add Workout` (no draft) | source = Calendar athlete, extras = [] |
  | `Resume draft` | unchanged — draft keeps its own source and date |
  | switch Calendar athlete, no real draft (empty name/exercises) | builder session dropped; next open binds to the new athlete |
  | switch Calendar athlete, live draft | draft keeps its source; header/banner name it |
  | Save Draft / autosave | persists `sourceAthleteId` + extras |
  | restore v2 | source must still be connected or the draft is dropped; extras = still-connected, deduped, source excluded |
  | restore v1 | `selectedAthleteIds[0]` is the only source candidate; if missing/invalid/disconnected, drop; extras not recovered |
  | Build & Assign / Discard | context cleared with the rest of the draft |

- Frontend state/UI impact:
  - `selectedAthleteIds` replaced by `extraAthleteIds` + `builderAthleteId` (counterpart to `builderDate`).
  - `authoringAthleteId = builderAthleteId ?? calendarAthleteId`.
  - Build mode source = `authoringAthleteId`; Existing Workout source = browsing `calendarAthleteId`.
  - Source checkbox is checked and disabled. Builder header names the source athlete. Amber banner covers athlete mismatch as well as date mismatch.
  - `isDraftContentEmpty` ignores athlete selection so merely opening the builder is not a live draft.
- Backward compatibility / data backfill:
  - Draft format v1 → v2 in localStorage only. No server backfill.
  - Junk, unknown versions, sourceless v1, and disconnected sources return `null` (fail safe). They are not reinterpreted as `athletes[0]`.

## 3. Estimate

- Size: M
- Sub-task breakdown:
  1. Draft v2 + `assignmentTargets` / `toggleExtraAthlete` / conservative migration.
  2. `page.tsx` derived assignment context.
  3. `node:test` regression coverage (Cases A–F).
  4. `frontend-ui-spec.md` source-athlete rule.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — inspect `origin/staging` | Done | SHA `0e1b7cd`; bug still present; old branch not cherry-picked |
| Task Doc | Done | This document |
| Draft v2 + migration helpers | Done | Conservative v1 `[0]`-only; v2 connected extras |
| `page.tsx` assignment context | Done | `builderAthleteId` + derived `assignmentTargets` |
| `node:test` Cases A–F | Done | 13 new assertions in `workout-draft.test.ts`; 28/28 calendar unit tests pass |
| `frontend-ui-spec.md` | Done | Source-athlete rule |
| Verification (lint / test / tsc / build) | Done | lint clean; `node --test` 28 pass; `next build` + `tsc --noEmit` clean |
| Staging merge / deploy | Not Started | Blocked on founder approval of this implementation report |

## 5. Outcome (filled at completion)

- Final status: implemented on `fix/athlete-assignment-context` from `origin/staging` (`0e1b7cd`). Not committed, not merged, not deployed.
- Deviations from plan: none material. v1 later-array entries are ignored rather than requiring the whole array to be strings. No vitest/CI workflow change (staging convention is `node:test`).
- Follow-ups: founder review of this report; then commit + staging merge. Manual Calendar acceptance on staging after merge.
