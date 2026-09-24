# Task: Weekly load increment on Workout templates

- Date opened: 2026-09-23
- Related contract sections: `docs/go-backend-api-contract-v0.1.md` §3.3 (`POST /workouts`), §3.4 (`GET /athletes/{athleteId}/last-completed-loads`); `docs/frontend-ui-spec.md` Calendar Builder; `docs/mvp-specification.md` Story 1
- Size (L, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: Coaches need a lightweight way to bump loads week-to-week when copying/building the next assignment, without auto-programming engines or rewriting frozen snapshots.
- Options considered:
  1. Server-side auto-progression across all future ScheduledWorkouts.
  2. Frontend-only math with no persistence of increment preference.
  3. Coach-authored `loadIncrement` on each WorkoutExercise template, applied only at copy/prefill time with optional last-completed lookup.
- Trade-offs (per option):
  1. Violates frozen snapshot principle and multi-athlete safety.
  2. Loses coach preference between sessions; cannot reuse template defaults.
  3. Small schema + one read endpoint; keeps prescription vs actual separate; matches founder-approved MVP expansion.
- Selected option and why: Option 3. Template stores increment; snapshots store resolved planned load only; single-athlete prefill uses COMPLETED SetLog history with template fallback.
- Risks / unknowns: Mixed-unit exercises; exercises without load history; coach expecting bump on multi-athlete assign (explicitly disabled).
- Dependencies / blockers: Existing Calendar copy/build flows and `POST /workouts` contract.

## 2. Technical Design

- Affected files/components:
  - `apps/api/migrations/0007_weekly_load_increment.up.sql`
  - `apps/api/internal/workout/workout.go`
  - `apps/api/internal/loadincrement/*`
  - `apps/api/cmd/api/main.go`
  - `apps/web/lib/load-increment.ts`
  - `apps/web/app/coach/calendar/page.tsx`, `workout-draft.ts`, `types.ts`
- Data flow: Template stores `loadIncrement` on `workout_exercises`. On Copy & edit with exactly one athlete selected, frontend calls `GET /athletes/{id}/last-completed-loads`, then applies `base + increment` where base is last COMPLETED load for exercise+unit or template planned load. `POST /workouts` persists increment on the new template; scheduling still resolves and freezes planned loads only.
- Schema changes: `workout_exercises.load_increment numeric not null default 2.5` with `>= 0` check.
- API changes:
  - `POST/GET /workouts` exercises expose `loadIncrement`
  - `GET /athletes/{athleteId}/last-completed-loads?exerciseIds=&units=` (parallel lists, equal length)
- Frontend state/UI impact: Builder exercise card adds increment picker beside load; unit change normalizes allowed options; multi-athlete assign skips prefill bump.
- Backward compatibility / data backfill: migration default `2.5`; existing rows pick up default; no snapshot rewrite.

## 3. Estimate

- Size: L
- Sub-task breakdown:
  1. Schema + workout persistence + contract
  2. Last-completed-load lookup endpoint + package tests
  3. Calendar builder UI + prefill
  4. Verification

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Schema + workout persistence + contract | Done | Migration 0007, workout create/list |
| 2. Last-completed lookup + tests | Done | `loadincrement` package + integration test |
| 3. Calendar builder UI + prefill | Done | Increment picker; single-athlete copy prefill |
| 4. Verification | Done | go test, npm test, lint |

## 5. Outcome (filled at completion)

- Final status: Done — weekly load increment shipped on templates with single-athlete copy prefill.
- Deviations from plan: None.
- Follow-ups: None required for MVP.
