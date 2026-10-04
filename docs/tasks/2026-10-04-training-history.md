# Task: Training History for Coach and Athlete

- Date opened: 2026-10-04
- Related contract sections: AGENTS.md §§2, 5–9; `docs/mvp-specification.md` Platform Boundary ("Reviewing athlete history"), Navigation Principle; `docs/go-backend-api-contract-v0.1.md` Authentication (Active relationship vs historical access), §3.7 `GET /sessions/{id}`; `docs/frontend-ui-spec.md`
- Size (S/M/L/XL, per AGENTS.md §7): XL → split into ordered sub-tasks below
- Depends on: `docs/tasks/2026-10-04-rpe-to-rir.md` (History displays RIR)

## 1. Feasibility Analysis

- Problem / trigger:
  - Coach feedback (2026-10-04): to see what an athlete actually lifted, the Coach opens every session one by one. `/coach/workouts` (Workout History) lists assignments and statuses only; `GET /scheduled-workouts` intentionally carries no SetLogs, so every result needs a separate `GET /sessions/{id}`.
  - Athletes have no history at all: Today and the active session only. During a set they cannot see what they lifted last time, which is the target for progressive overload.
  - The hypertrophy dose–response concept (Performance Progression) needs exactly this view: raw exercise + load + reps + RIR over time per athlete. This task builds that foundation; it does not build the dashboard.
- Product decisions (2026-10-04, from the Coach):
  1. **Cross-coach visibility: yes.** A Coach sees the athlete's training logged under other Coaches too. The athlete sees all of their own history.
  2. **RIR, not RPE.** Done first in the prerequisite task.
  3. **Units stay separate.** kg and lb are never converted; trajectories group by unit.
  4. **Trajectories count COMPLETED sessions only.** ACTIVE sessions appear in the feed labeled In progress.
- Options considered:
  1. Frontend fan-out: History calls `GET /sessions/{id}` for every listed session.
  2. Add SetLogs to `GET /scheduled-workouts`.
  3. Add a dedicated read endpoint for actual training (`GET /training-log`), plus an additive `previous` field on `GET /sessions/{id}` for "last time".
- Trade-offs (per option):
  - Option 1 needs no contract change but costs N requests per page, and cannot reach other Coaches' sessions (the Coach does not know their ids).
  - Option 2 bloats the Calendar's summary endpoint, which the contract (V0.5) deliberately keeps summary-only, and stays bounded to `coachId = caller`, which contradicts decision 1.
  - Option 3 is one new read-only route plus one additive field. It keeps prescription endpoints untouched and has one place to define the cross-coach rule.
- Selected option and why:
  - Option 3. One request per History page, no change to existing shapes beyond an additive field, and a single authorization rule.
- Risks & unknowns:
  - **Privacy / consent (decision 1).** An athlete who joins Coach A now exposes training done with Coach B. Mitigations, all in scope:
    - Other Coaches' sessions show actuals only: date, exercise names, and sets. They hide the other Coach's identity, workout name, coach cues, and planned prescription.
    - The join flow and the Privacy page state that connected Coaches can see the athlete's full training log.
  - **This widens a read surface that already exists.** `GET /sessions/{id}` already authorizes any Coach with historical access to the athlete, without `coachId = caller`. `/training-log` uses the same rule, so this is a discoverability change, not a new ACL.
  - **Exercise identity across Coaches.** Trajectories key on `exercise_id`. SYSTEM exercises match across Coaches. A Coach's PRIVATE exercises do not match another Coach's similarly named exercise, so they appear as separate exercises (accepted; contract §7.4 already defers same-name identity).
  - **Query cost.** History joins `workout_sessions → set_logs → scheduled_workout_exercises`. Verify with `EXPLAIN` on seeded data. Add an index migration (for example on `workout_sessions (athlete_id, completed_at)`) only if needed.
  - The range must be bounded. All Time cannot be one unbounded query.
  - **Pre-existing write gap (found in Phase 0).** `requireActiveCoachMutation` (`internal/workoutsession/workoutsession.go`) checks only an active `coach_athletes` row, not that the caller scheduled the session. A Coach who knows another Coach's `sessionId` can therefore log, edit, or complete sets in it. Today ids are not discoverable across Coaches. To keep it that way, `/training-log` and `previous` **never return `sessionId`/`scheduledWorkoutId` for OTHER_COACH sessions**, and SetLog ids are never returned. Closing the gap itself (requiring `scheduled_workouts.coach_id = caller` for Coach mutations) is a separate follow-up task.
- Dependencies / blockers:
  - RIR task merged first.
  - Existing `/coach/workouts` History page, `/coach/clients/[athleteId]`, `/session/[id]`, athlete Today/Calendar.

## 2. Technical Design

- Affected files/components (per sub-task, see §3):
  - Docs: API contract (new §3.10 Training Log, `GET /sessions/{id}` additive field, Authentication table row), MVP spec, frontend UI spec, Privacy page copy
  - API: `internal/traininglog/` (new package: query + authorization), `internal/workoutsession/` (`previous`), `cmd/api/main.go` (route), tests
  - Web: `app/session/[id]/*` ("last time" line), `app/coach/workouts/*` (inline results), new exercise trajectory route(s), athlete History entry, i18n en/zh-TW
- Authorization (single rule, documented in the contract's Authentication table):
  - Athlete caller: own sessions only, all Coaches. Supplying another `athleteId` → `404 NOT_FOUND`.
  - Coach caller: sessions of any athlete with whom the Coach has **historical access** (`coach_athletes` row), **regardless of which Coach scheduled them**, the same rule as `GET /sessions/{id}`. Each session carries `source: "OWN" | "OTHER_COACH"`. For `OTHER_COACH`, `sessionId`, `scheduledWorkoutId`, `workoutName`, `coachCue`, and `plan` are `null`/omitted, and the scheduling Coach is never named. OTHER_COACH rows are therefore not tappable into `/session/{id}`.
  - The response never includes anything from athletes the caller has no row with.
- API changes (contract updated **before** code, per AGENTS.md §6):
  1. `GET /sessions/{id}` (additive): each exercise gains
     `previous: { sessionId, date, setLogs: [{ setNumber, load, unit, reps, rir }] } | null`.
     This is the athlete's most recent **COMPLETED** session, scheduled before this one, containing the same `exercise_id`, from any Coach. Units are as logged. The Coach-side `sessionId` is withheld (`null`) when that session is `OTHER_COACH`.
  2. `GET /training-log?from=&to=&athleteId=&exerciseId=&status=` (new, Coach or Athlete):
     - `from`/`to` required (inclusive `scheduled_date`). The span is at most 184 days; longer spans return `400 INVALID_ARGUMENT`, and the client pages backwards for All Time.
     - `athleteId` is optional for Coaches (omitted = all athletes with historical access) and must be omitted or self for Athletes.
     - `exerciseId` is optional; with it, each session includes only that exercise, and sessions without it are excluded.
     - `status` is optional (`ACTIVE`, `COMPLETED`); trajectories pass `COMPLETED`.
     - Response, newest first:
       ```json
       { "sessions": [ {
           "sessionId": "...", "scheduledWorkoutId": "...", "status": "COMPLETED",
           "date": "2026-09-29", "source": "OWN",
           "athlete": { "id": "...", "name": "Jason" },
           "workoutName": "Push A",
           "exercises": [ { "exerciseId": "...", "name": "Bench Press",
             "setLogs": [ { "setNumber": 1, "kind": "PLANNED", "load": 80, "unit": "kg", "reps": 8, "rir": 2 } ] } ]
       } ] }
       ```
     - Not-started assignments are not sessions and are not returned. History still gets them from `GET /scheduled-workouts`.
- Data flow:
  - **Session "last time":** `GET /sessions/{id}` → for each exercise, look up the latest earlier COMPLETED session of the same athlete with the same `exercise_id` → render one muted line under the exercise header (`Last: 30 kg × 11, 10, 10 @ 1 RIR`).
  - **Coach History:** fetch `GET /scheduled-workouts` (statuses, including Not started) and `GET /training-log` (results, including OTHER_COACH) for the same range and filter → merge on `scheduledWorkoutId` → OTHER_COACH sessions are rows of their own, labeled `Other coach`.
  - **Exercise trajectory:** tapping an exercise name opens Athlete → Exercise → `GET /training-log?athleteId&exerciseId&status=COMPLETED` → rows by date, one section per unit (kg / lb), and `Load earlier` pages 184 days back.
  - **Athlete History:** an athlete entry point (from Today/Calendar) calls the same endpoint without `athleteId` and shows their own feed and trajectories (read-only).
- Schema changes: none required. An index migration is added only if `EXPLAIN` shows a sequential scan on realistic data.
- Frontend state/UI impact:
  - History cards show one compact line per exercise (`Bench Press  80 kg × 8, 8, 7 @ 2 RIR`; repeated values are not collapsed in V1). ACTIVE sessions are labeled In progress with the sets logged so far.
  - Trajectory rows show raw sets, with no e1RM, charts, PR badges, or interpretation (concept doc: keep raw load/reps/RIR; do not replace them with a single score).
  - Copy in en and zh-TW. Mobile width verified.
- Backward compatibility / data backfill:
  - Read-only. No backfill. The only existing-route change is an additive response field.

## 3. Estimate

- Size: XL. Ordered sub-tasks, each independently verifiable and shippable:
  1. **Contract + spec docs**: `/training-log`, the `previous` field, the authorization row, MVP/UI spec, and Privacy/join disclosure copy. (Docs only.)
  2. **"Last time" in session**: backend `previous` + integration tests (own Coach, other Coach, no history, ACTIVE excluded, unit preserved) → web line in the session view. Ships the fastest relief.
  3. **`GET /training-log` backend**: query, the authorization matrix (athlete self/other, Coach historical/none, OWN/OTHER_COACH redaction), range validation, `EXPLAIN` check, and tests.
  4. **Coach History inline results**: merge the two sources, other-coach rows, and status labels, with focused helper tests.
  5. **Exercise trajectory page**: Coach route from History, client detail, and session; unit sections; paging.
  6. **Athlete History**: entry point and the same trajectory view, read-only.
  7. **Privacy page + join disclosure** copy (en/zh-TW).
  8. Local end-to-end with two Coaches and one shared athlete; staging deploy and smoke test.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Data already links set_logs → scheduled_workout_exercises.exercise_id; `GET /sessions/{id}` already uses historical-access ACL without `coachId = caller`. |
| 1. Contract + spec docs | Not Started | Blocked on RIR task. |
| 2. "Last time" in session | Not Started | |
| 3. `GET /training-log` backend | Not Started | |
| 4. Coach History inline results | Not Started | |
| 5. Exercise trajectory page | Not Started | |
| 6. Athlete History | Not Started | |
| 7. Privacy + join disclosure | Not Started | Must ship no later than sub-task 3 reaches production. |
| 8. E2E + staging smoke | Not Started | Production excluded until explicitly approved. |

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
  - Remove the RIR task's legacy-`rpe` request guard.
  - Close the Coach mutation gap: Coach writes to a session require `scheduled_workouts.coach_id = caller`.
  - Dose–response layer (weekly hard sets per muscle group, recovery check-in) builds on `/training-log`.
