# Task: Coach Progress Overview V1 (objective data only)

- Date opened: 2026-10-05
- Related contract sections: AGENTS.md §§2, 5–9; `docs/go-backend-api-contract-v0.1.md` §3.10 and the new §3.11; `docs/frontend-ui-spec.md`; `docs/mvp-specification.md` "Training History & Exercise Progress"
- Size (S/M/L/XL, per AGENTS.md §7): L
- Depends on: `docs/tasks/2026-10-04-training-history.md` (comparison engine, `/training-log`, Exercise Progress page), all deployed to staging

## 1. Feasibility Analysis

- Problem / trigger:
  - A Coach opening one athlete currently sees only a list of exercise names. To judge "how is Jason doing overall" the Coach opens each exercise's chart one by one.
  - Product decision (2026-10-05): V1 shows **objective data only**: recent PRs, an 8-week trend per exercise, completion rate, planned vs completed sets. No Progressing / Stable / Needs-review labels, no grades, no recommendations. Those wait for the Dose/Response engine, because "what counts as progress" is not yet defined (exercise, load, reps, RIR, completion, later effective sets and recovery).
- Options considered:
  1. Frontend fan-out: call `GET /training-log` per exercise and compute everything in the browser.
  2. Extend `GET /training-log` with an overview mode.
  3. New read-only endpoint `GET /athletes/{athleteId}/progress-overview` that returns one compact payload, reusing `internal/progress`.
- Trade-offs:
  - Option 1 costs N requests per page and puts the aggregation rules (business logic) in the frontend, against AGENTS.md §4.
  - Option 2 overloads one endpoint with a second response shape and range semantics.
  - Option 3 is one new route, one place for the aggregation rules and the privacy split.
- Selected option and why: Option 3.
- Risks & unknowns:
  - **Privacy split.** Actuals (trend, PRs) include training under other Coaches, as in `/training-log`. **Completion and planned-vs-completed use only ScheduledWorkouts the caller scheduled**, because they expose another Coach's prescription and scheduling. They are labelled "your assignments".
  - **Completion definition.** Completion rate = COMPLETED sessions ÷ the caller's ScheduledWorkouts dated up to today in the window (Not started and Active count as not completed). Future assignments are excluded. Show the raw counts beside the rate.
  - **Planned vs completed sets** compares frozen planned-set rows with PLANNED SetLogs in the caller's own assignments. EXTRA sets are shown separately and never inflate completion.
  - **Trend metric.** Estimated 1RM per week (best top set that week) is the only trend value. It is labelled "estimated" and shown only as a direction aid, never as a verdict. Exercises without RIR on the top set fall back to top-set load.
  - **Query cost.** One athlete, 8 weeks. Reuse `workout_sessions (athlete_id, status)`; confirm with EXPLAIN.
- Dependencies / blockers: none beyond the deployed training-history work.

## 2. Technical Design

- Affected files/components:
  - Docs: API contract (§3.11, auth matrix row), frontend UI spec, MVP spec
  - API: `internal/progressoverview/` (new: query, aggregation, authorization), `cmd/api/main.go` (route), tests
  - Web: `app/coach/clients/[athleteId]/page.tsx` (Overview section replaces the plain exercise list), a small sparkline component, i18n en/zh-TW, helper tests
- API (contract updated before code, AGENTS.md §6): `GET /api/v1/athletes/{athleteId}/progress-overview?weeks=8` — Coach only.
  - `weeks`: 4–26, default 8. The window is the last N full ISO weeks plus the current week, in the athlete's data dates.
  - Authorization: Coach with **historical access** to the athlete, else `404`. Athlete caller → `403`. Invalid UUID → `404`.
  - Response:
    ```json
    {
      "athlete": { "id": "...", "name": "Jason" },
      "window": { "from": "2026-08-10", "to": "2026-10-05", "weeks": 8 },
      "assignments": {
        "scope": "OWN",
        "scheduled": 14, "completed": 11, "completionRate": 0.79,
        "plannedSets": 168, "completedPlannedSets": 150, "extraSets": 6
      },
      "exercises": [
        {
          "exerciseId": "...", "name": "Preacher Curl", "unit": "kg",
          "latest": { "date": "2026-10-05", "topSet": { "load": 32.5, "reps": 11, "rir": 1 } },
          "trend": [ { "weekStart": "2026-08-10", "estimated1rm": 38.5 }, { "weekStart": "2026-08-17", "estimated1rm": null } ],
          "recentEvents": [ { "date": "2026-10-05", "type": "REP_PR", "load": 32.5, "unit": "kg", "reps": 11 } ],
          "exposures": 7
        }
      ]
    }
    ```
  - `exercises` ordered by most recent exposure, then name. Each has at most one unit series; an exercise logged in both units appears twice, once per unit. `recentEvents` = engine events from the last 28 days, newest first, at most 5. `trend` has one entry per week; weeks without data have `estimated1rm: null` (no interpolation). `completionRate` is `null` when `scheduled` is 0.
  - No SetLog ids, session ids, workout names or coach identity of other Coaches. Nothing in the response is a grade, score, status, or recommendation.
- Data flow: the handler loads the athlete's COMPLETED exposures per exercise in the window plus all earlier exposures (the engine needs full history for PR comparison), runs `internal/progress`, aggregates weekly bests, and computes the OWN-scope assignment numbers with one query over the caller's ScheduledWorkouts.
- Schema changes: none unless EXPLAIN shows otherwise.
- Frontend: on `/coach/clients/[athleteId]`, an Overview section: a three-number strip (Completion %, Planned vs completed sets, PRs in last 28 days), then one row per exercise: name, latest top set (`32.5 kg × 11 @1`), 8-week sparkline, and event chips (Rep PR, Load PR, ↑ load). Tapping a row opens the existing Exercise Progress page. Neutral styling only: no status chips, no warning colors, no grades. The sparkline end point is drawn in the same neutral/series color for every exercise.
- Backward compatibility: read-only, additive.

## 3. Estimate

- Size: L. Ordered sub-tasks:
  1. Contract + spec docs (this PR).
  2. `internal/progressoverview` backend: aggregation, authorization, integration tests (OWN vs OTHER_COACH split of assignments, windowing, null weeks, both units, redaction), EXPLAIN.
  3. Web Overview section, sparkline, i18n, helper tests, headless visual check.
  4. Staging deploy and smoke test (no migration expected).

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Contract + spec docs | Done | 2026-10-05 |
| 2. Backend | Done | 2026-10-05. `internal/progressoverview` + route; 7 integration tests. No migration: EXPLAIN on seeded data (301 athletes, 45k sessions, 136k set logs) uses `workout_sessions_athlete_status_idx`, `scheduled_workouts_coach_athlete_date_idx` and `set_logs` session index; no sequential scan on `workout_sessions`/`set_logs` with an 8-week window. Known: the planned-sets count scans `scheduled_workout_exercises` (only a partial `removed_at IS NULL` index exists), about 7 ms at 45k rows; revisit if it grows. Window = N full ISO weeks + current week, so `trend` has N+1 entries (matches the §3.11 example `from`). "Today" is the UTC date (no per-user time zone in the schema). `completedPlannedSets`/`extraSets` count SetLogs of any session status (Active included) of the caller's in-window assignments. Bodyweight (no-load) exercises are not listed. |
| 3. Web | Done | 2026-10-05. Overview section replaces the plain exercise list on `/coach/clients/[athleteId]` (strip, rows, inline SVG sparkline, chips, en + zh-TW); helpers in `lib/progress-overview.ts` with unit tests. The now-unused `distinctExercises` helper and `progress.clients.*` strings were removed. The "PRs · last 28 days" number is counted client-side from `recentEvents` (max 5 per row), so a very busy exercise can undercount; a server-side count would need a contract field. Checked in headless Chromium against the local API and Auth Emulator (en and zh-TW). |
| 4. Staging deploy + smoke | Not Started | Production excluded until explicitly approved. |

## 3b. Follow-up: PR total (approved 2026-10-05)

- Problem: the strip's "PRs in the last 28 days" was summed from per-exercise `recentEvents`, which is capped at 5 per exercise, so heavily trained exercises undercount.
- Change: add `recentEventTotals { windowDays, loadPr, repPr, total }` (contract §3.11, V0.13.1) computed server-side over all exercises with no cap; the web strip reads `total`. Visual design unchanged. No schema change, no migration.
- Sub-tasks: (a) backend field + tests (an exercise with more than 5 PRs in the window must count all of them; both units summed; PRs older than 28 days excluded; null/empty window gives zeros); (b) web strip reads the field and the client-side summation is removed, with helper tests updated.

| Follow-up sub-task | Status | Notes |
| --- | --- | --- |
| 3b-a. Backend `recentEventTotals` | Done | 2026-10-05. Counted in `loadExercises` from the engine's events (date ≥ today−27), before the bodyweight-row skip, so all exercises and units are included and the 5-item cap does not apply. No migration (no new query). Integration test covers >5 PRs, kg + lb, PRs older than 28 days, empty window, window-length independence; redaction test unchanged and passing. |
| 3b-b. Web strip uses `total` | Not Started | |

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups: status labels and recommendations after the Dose/Response engine.
