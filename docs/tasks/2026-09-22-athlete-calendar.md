# Task: Athlete month calendar on `/today`

- Date opened: 2026-09-22
- Related contract sections: `docs/go-backend-api-contract-v0.1.md` §3.6 (`GET /me/scheduled-workouts`); `docs/frontend-ui-spec.md` Athlete `/today`; `docs/mvp-specification.md` Story 3
- Size (M, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: Athletes can only prev/next one day at a time. They want a month view of which days have training, like TeamBuildr, without making a second primary destination.
- Options considered:
  1. Client loops 28–31 `GET /me/scheduled-workouts?date=` calls.
  2. New `/athlete/calendar` route + Calendar domain.
  3. Extend `GET /me/scheduled-workouts` with `from`/`to` (mutually exclusive with `date`) returning a **summary** without exercises; month picker lives on `/today`.
- Trade-offs (per option):
  1. Too many round-trips; payload includes full snapshots.
  2. Spec forbids a second Athlete primary route and a Calendar domain object.
  3. Matches Coach range-list pattern; Today stays the only primary Athlete surface.
- Selected option and why: Option 3. Contract change is required and must land in the API doc before implementation.
- Risks / unknowns: Range max length; empty months; timezone is still local date strings.
- Dependencies / blockers: Wave 1 compact `/today` rows (`docs/tasks/2026-09-22-athlete-session-density.md`). Do not start until that overview density ships.

## 2. Technical Design

- Data flow: Month grid calls `GET /api/v1/me/scheduled-workouts?from=&to=`. Tapping a day still uses `?date=` for the existing detail payload and compact exercise rows.
- Schema changes: none
- API changes (must update contract first):
  - `date` XOR (`from` + `to`); missing/invalid → `400`
  - `from`/`to` response: `{ id, scheduledDate, workoutName, session }` — **no exercises**
  - `date` response unchanged (includes exercises)
- Frontend state/UI impact: `/today` gains a month-grid toggle. Prev/next day remains. No `/athlete/calendar` route.
- Backward compatibility / data backfill: existing `?date=` clients unchanged

Not in this task: Coach programming, Programs, nested calendars, rest timers, video.

## 3. Estimate

- Size: M
- Sub-task breakdown:
  1. Contract + UI spec + Story 3 copy
  2. API `from`/`to` summary
  3. `/today` month grid
  4. Verification

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Contract + spec | Done | §3.6, frontend-ui-spec, Story 3 |
| 2. API range summary | Done | `ListForAthleteRange`, handler XOR + 42-day cap |
| 3. `/today` month grid | Done | Toggle, Sunday-first grid, day dots |
| 4. Verification | Done | go test, npm lint/test |

## 5. Outcome (filled at completion)

- Final status: Done — Athlete `/today` month grid shipped with range summary API.
- Deviations from plan: None.
- Follow-ups: None required for MVP.
