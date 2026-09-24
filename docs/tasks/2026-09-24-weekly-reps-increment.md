# Task: Independent weekly reps increment

- Date opened: 2026-09-24
- Related contract sections: `docs/go-backend-api-contract-v0.1.md` §3.3 (`POST/GET /workouts`); `docs/frontend-ui-spec.md` Calendar Builder; `docs/mvp-specification.md` Story 1; `docs/plan.md` 週進階
- Size (M, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: Coaches already have independent weekly load and set bumps. They also need to bump **reps** on copy/repeat, without being forced to add a set at the same time. Volume (sets) and intensity-of-effort (reps) are separate programming knobs.
- Options considered:
  1. Couple reps bump to `setIncrement` (one toggle adds both +1 set and +1 rep).
  2. Coach-authored `repsIncrement` on each WorkoutExercise, same shape as `setIncrement` (`0` or `1`), applied only at single-athlete copy/build/repeat prefill.
  3. Last-completed-reps lookup from SetLogs (mirror load history).
- Trade-offs:
  1. Contradicts the founder request: sometimes they only want reps, sometimes only sets.
  2. Small schema + UI; matches existing increment pattern; TEXT prescriptions stay untouched.
  3. Extra endpoint and mixed-mode (TEXT vs REPS) history; slower, not needed for MVP — planned reps are the source of truth for next week's prescription.
- Selected option and why: Option 2. Independent `repsIncrement` 0|1, default 0. Load, sets, and reps are three independent flags.
- Risks / unknowns: TEXT-mode exercises with `repsIncrement=1` must no-op (no integer reps to bump). Per-set reps overrides must bump independently of defaults. New set from `setIncrement` inherits already-bumped default reps.
- Dependencies / blockers: Existing `loadIncrement` / `setIncrement` prefill in `apps/web/lib/load-increment.ts` and Repeat this week.

## 2. Technical Design

- Affected files/components:
  - `apps/api/migrations/0009_weekly_reps_increment.up.sql` + `.down.sql`
  - `apps/api/internal/workout/workout.go` + integration test
  - `apps/api/cmd/api/main.go` create-workout request decode
  - `apps/web/lib/load-increment.ts` + test
  - `apps/web/app/coach/calendar/page.tsx` (exercise card toggle + create payload)
  - `apps/web/app/coach/calendar/workout-draft.ts`, `types.ts`, tests
  - `apps/web/app/coach/calendar/repeat-week.ts` + test (preview source/suggested reps)
  - i18n `en`/`zh-TW` calendar messages
  - `docs/go-backend-api-contract-v0.1.md`, `docs/database-schema-relationships.md`, `docs/mvp-specification.md`, `docs/frontend-ui-spec.md`
- Data flow: Template stores `repsIncrement` on `workout_exercises`. On Copy & edit / Repeat this week with exactly one athlete, frontend applies `defaultReps + repsIncrement` and any explicit `overrides[].reps + repsIncrement` when prescription is REPS. `setIncrement` still adds one set afterward so the new position inherits bumped defaults. `POST /workouts` persists the three increments independently. Snapshots store resolved planned reps only.
- Schema changes: `workout_exercises.reps_increment integer not null default 0` with `CHECK (reps_increment IN (0, 1))`.
- API changes: `repsIncrement` on `POST/GET /workouts` exercises (`0` or `1`, omit default `0`). Snapshots do not carry it. No new route.
- Frontend state/UI impact: Exercise card adds a weekly +1 reps select beside the existing set increment (same optional / +1 pattern). Repeat preview shows `sourceReps → suggestedReps` when REPS mode. Multi-athlete assign skips prefill.
- Backward compatibility / data backfill: migration default 0; existing templates unchanged.

## 3. Estimate

- Size: M
- Sub-task breakdown:
  1. Schema + workout persistence + contract
  2. Prefill math + builder toggle + Repeat preview
  3. Tests + docs
  4. Push main; production migrate + API deploy

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Schema + persistence + contract | Done | Migration 0009; workout.go + main.go |
| 2. Prefill + builder + Repeat | Done | load-increment.ts; calendar builder + Repeat preview |
| 3. Tests + docs | Done | Go/web tests; contract + schema + MVP/UI specs |
| 4. Production deploy | Not Started | Parent agent: migrate 0009 + Cloud Run deploy |

## 5. Outcome (filled at completion)

- Final status: Shipped on `main`. Independent `repsIncrement` 0\|1 on WorkoutExercise templates; applied at single-athlete copy/build/repeat prefill (load → reps → sets); TEXT no-op.
- Deviations from plan: None.
- Follow-ups: Apply migration `0009_weekly_reps_increment` on staging + production; deploy API.
