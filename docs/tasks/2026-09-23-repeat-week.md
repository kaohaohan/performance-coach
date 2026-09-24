# Task: Repeat this week (load + volume)

- Date opened: 2026-09-23
- Related contract sections: `docs/go-backend-api-contract-v0.1.md` §3.3 (`POST /workouts`, `GET /workouts`); `docs/frontend-ui-spec.md` Coach Calendar week view; `docs/mvp-specification.md` Story 1
- Size (L, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: Coaches programming one athlete week-by-week need to copy the current week's assignments forward with load and set progression, without Programs, periodization engines, or a new backend batch endpoint.
- Options considered:
  1. New `POST /repeat-week` transactional endpoint.
  2. Server-side auto-clone all ScheduledWorkouts for an athlete.
  3. Frontend orchestration of existing `POST /workouts` + `POST /scheduled-workouts` per session, with template-level `loadIncrement` (existing) and new `setIncrement`.
- Trade-offs (per option):
  1. New contract surface and partial-failure semantics on the server; slower to ship.
  2. Violates frozen snapshot principle; hard to preview bumps per exercise.
  3. Reuses approved MVP patterns (Copy & edit prefill, Build & Assign retry); coach sees preview; source templates unchanged.
- Selected option and why: Option 3. Matches founder constraint and existing Calendar compose model; no new route.
- Risks / unknowns: Partial batch failure mid-week; target week already has assignments (preview flags, still allows add); incomplete prior week (load falls back to planned + increment).
- Dependencies / blockers: Weekly load increment (2026-09-23-weekly-load-increment), Calendar week view, `GET /athletes/{id}/last-completed-loads`.

## 2. Technical Design

- Affected files/components:
  - `apps/api/migrations/0008_weekly_set_increment.up.sql`
  - `apps/api/internal/workout/workout.go`, `apps/api/cmd/api/main.go`
  - `apps/web/lib/load-increment.ts`
  - `apps/web/app/coach/calendar/repeat-week.ts`, `page.tsx`, `workout-draft.ts`, `types.ts`
  - i18n calendar messages
- Data flow: Source week = `weekDays(weekAnchor)` bounds. For each assignment that week for the selected athlete, resolve `workoutId` → saved Workout template. Build draft via `savedWorkoutToDraft`, apply load prefill (last COMPLETED SetLog per exercise+unit, else template planned load + `loadIncrement`) and set prefill (`setCount + setIncrement`). Confirm → sequential `POST /workouts` then `POST /scheduled-workouts` to `sourceDate + 7` for that athlete. Stop on first failure; surface created-but-unassigned retry when schedule fails after create.
- Schema changes: `workout_exercises.set_increment integer not null default 0` with check `IN (0, 1)`.
- API changes: `setIncrement` on `POST/GET /workouts` exercises (0|1, omit default 0). Snapshots do not carry it. No new route.
- Frontend state/UI impact: Week view only; Repeat button when exactly one calendar athlete and ≥1 assignment in source week. Confirm dialog lists each session (date → date+7, name, load/set preview, conflict if target date has assignments). Builder adds weekly +1 set toggle beside load increment; Copy & edit single-athlete applies both bumps.
- Backward compatibility / data backfill: migration default 0; existing templates unchanged.

## 3. Estimate

- Size: L
- Sub-task breakdown:
  1. Task Doc + contract/spec updates
  2. Schema + workout persistence + validation
  3. Repeat week UI + orchestration module
  4. Builder setIncrement + copy prefill
  5. Verification

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Task Doc + contract/spec | Done | This doc + MVP/UI/API/schema updates |
| 2. Schema + persistence | Done | Migration 0008, workout create/list |
| 3. Repeat week UI | Done | Week view button, preview dialog, sequential POST compose |
| 4. Builder setIncrement | Done | Toggle + copy/repeat prefill |
| 5. Verification | Done | go test, npm test |

## 5. Outcome (filled at completion)

- Final status: Done — Repeat this week ships with load+set progression via existing POST compose.
- Deviations from plan: None.
- Follow-ups: None required for MVP.
