# Task: Coach Workout History

- Date opened: 2026-08-27
- Related contract sections: AGENTS.md §§6–12, 17–21; `docs/mvp-specification.md` Navigation Principle and Story 1; `docs/frontend-ui-spec.md` §§1–3; `docs/go-backend-api-contract-v0.1.md` §3.5
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger:
  - `/coach/workouts` currently spends a secondary navigation surface listing reusable Workout templates even though Calendar already exposes those templates through Create Workout → From saved.
  - Coaches need a compact, athlete-specific view of recent assignments and outcomes, including missed workouts, more than a duplicate template list.
- Options considered:
  1. Keep Workout Library and add a separate Workout History route.
  2. Replace the `/coach/workouts` Library list with a Workout History view backed by existing ScheduledWorkout summaries, while preserving template creation and Calendar's From saved flow.
  3. Add a dedicated backend history endpoint or persistence model with exercise counts and analytics.
- Trade-offs (per option):
  - Option 1 preserves the current page but adds navigation and duplicates a secondary surface before release.
  - Option 2 reuses the existing route, scheduled-workout data, status language, session flow, and saved-workout selector. It is the smallest release-safe change, but the existing summary cannot reliably show a frozen exercise count.
  - Option 3 could tailor pagination and metrics, but duplicates existing query semantics and expands backend/API scope without an MVP need.
- Selected option and why:
  - Select Option 2. It turns the existing secondary route into a useful review surface without changing the domain model or API contract. Saved Workout templates remain available through Calendar → From saved, and `+ Create Workout` continues to open the existing template builder on `/coach/workouts`.
- Risks & unknowns:
  - `GET /api/v1/scheduled-workouts` returns ascending dates, so the frontend must sort newest first.
  - The summary omits frozen exercises. Deriving an exercise count from the live Workout template could become inaccurate after assignment edits, so History deliberately omits the count.
  - A Not started assignment has no session detail route. Entering `/session/[id]` requires explicit session creation; History must therefore retain an explicit Start Session action and must not create a session from a generic card tap.
  - All Time still requires the endpoint's mandatory `from`/`to`; the frontend will use Go's earliest representable ISO date (`0001-01-01`) through the Coach's local today.
  - The current working tree contains unrelated login, Apple sign-in, local Capacitor screenshot, iOS plist, Next config, and `.cursor/` changes. They are user-owned, remain unstaged, and must not enter task commits.
- Dependencies / blockers:
  - Existing Coach-only `GET /api/v1/scheduled-workouts?from=&to=&athleteId=`.
  - Existing Coach-only `GET /api/v1/athletes` for the filter choices.
  - Existing `POST /api/v1/scheduled-workouts/{id}/session` and `/session/[id]` flow.
  - Existing Calendar `GET /api/v1/workouts` From saved flow, which is independent of the `/coach/workouts` Library list.
  - Existing staging branch CI, Vercel Preview deployment, and staging-only Cloud Run deployment workflow.

## 2. Technical Design

- Affected files/components:
  - `docs/mvp-specification.md`
  - `docs/frontend-ui-spec.md`
  - `apps/web/app/coach/workouts/page.tsx`
  - `apps/web/app/coach/workouts/history.ts`
  - `apps/web/app/coach/workouts/history.test.ts`
- Data flow:
  1. After Coach role verification, fetch connected athletes from `GET /api/v1/athletes`.
  2. Convert the selected date-range option into inclusive `from` and local-today `to` dates. This server-side upper bound excludes future assignments.
  3. Fetch `GET /api/v1/scheduled-workouts`; omit `athleteId` for All Athletes and include it for a selected athlete.
  4. Defensively exclude any item after local today, sort by `scheduledDate` descending with stable athlete/workout/id tie-breakers, and group by scheduled date.
  5. Render one card per ScheduledWorkout, preserving separate assignments when a Workout was assigned to multiple athletes.
  6. Active and Completed actions route to `/session/{session.id}`. Not started exposes an explicit Start Session action that calls the existing POST endpoint before routing.
- Schema changes: None.
- API changes: None. Existing routes, request/response shapes, authorization, and status codes remain unchanged.
- State transitions:
  - `session = null` → Not started. Only the explicit Start Session action may create an ACTIVE session.
  - `session.status = ACTIVE` → In progress; Resume opens the existing session.
  - `session.status = COMPLETED` → Done; Review opens the existing session.
- Frontend state/UI impact:
  - `/coach/workouts` default state becomes Workout History with subtitle `Review past workouts across athletes.`
  - Filters: All Athletes or one connected athlete; Last 7, 30, 90 Days, or All Time.
  - History is grouped by date, newest first, and shows athlete name, workout name, date, and the Calendar status chip language.
  - Empty copy is `No workout history yet.` for All Athletes and `No workouts found for this athlete.` for an individual athlete.
  - The existing `← Coach Calendar` and `+ Create Workout` controls and the existing template builder remain.
  - Exercise count, search, charts, PRs, volume, and analytics are excluded.
- Backward compatibility / data backfill:
  - No backfill. History is a read-only view over existing ScheduledWorkout and WorkoutSession data.
  - Saved templates remain persisted and selectable from Calendar → From saved; only their standalone list presentation is removed.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Update the Task Doc and canonical MVP/UI definitions.
  2. Add pure history query/order/status helpers and focused tests.
  3. Replace the Library list with the filtered, grouped History UI while preserving Create Workout.
  4. Run focused tests, typecheck, lint, build, Calendar draft/resume regression checks, and mobile visual verification.
  5. Review and commit only task files, merge/push staging, monitor deployment, and smoke-test the staging alias.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Existing ScheduledWorkout summary is sufficient; no backend/schema/API change needed. |
| Phase 1 — Task Doc and canonical definitions | Done | Canonical MVP/UI definitions now make `/coach/workouts` Workout History and preserve Calendar → From saved. |
| Phase 2 — history helpers and tests | Done | 5 focused tests cover inclusive ranges, encoded athlete filter, future exclusion, newest-first grouping, separate assignments, and status labels. |
| Phase 3 — Workout History UI | Done | Existing builder preserved; History uses athletes + scheduled-workout summaries and explicit Not started session creation. |
| Phase 4 — local verification | In Progress | Focused lint/typecheck, 5 History tests, 45 Calendar draft/build tests, webpack production build, and read-only local API scenarios pass. Task-only clean-tree full lint/build and visual verification remain. |
| Phase 5 — task-only commit | In Progress | Unrelated local changes remain unstaged. |
| Phase 6 — staging deployment and smoke test | Not Started | Production explicitly excluded. |

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
