# Task: Training History and Exercise Progress for Coach and Athlete

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
  3. **Units stay separate.** kg and lb are never converted; charts and history group by unit.
  4. **Trajectories count COMPLETED sessions only.** ACTIVE sessions appear in the feed labeled In progress.
- Product decisions (2026-10-05, design review):
  5. **No grades or scores.** A letter grade or composite score per session/exercise was prototyped and rejected: load × reps × RIR cannot be collapsed into one reliable verdict, and exercise order, fatigue, technique, ROM, RIR error, and equipment changes all move the number. The product shows raw data → trend → objective events → coach decision.
  6. **Events are computed by the system, never hand-labelled.** One comparison engine (Go) produces Load PR, Rep PR, load change, matched, and reps-down events. Training history, the progress chart, and in-workout LAST/PR all use it.
  7. **No status judgments in this task.** Labels such as Progressing, Stable, or Needs review need a defined notion of progress (exercise, load, reps, RIR, completion, later effective sets and recovery). They wait for the Dose/Response engine. The Coach Progress Overview V1 shows objective data only and is planned in its own Task Doc.
  8. **Priority:** comparison engine → LAST/PR during the workout → exercise history and progress chart → training-history events → Coach Progress Overview.
- Options considered:
  1. Frontend fan-out: History calls `GET /sessions/{id}` for every listed session.
  2. Add SetLogs to `GET /scheduled-workouts`.
  3. Add a dedicated read endpoint for actual training (`GET /training-log`), plus an additive `history` field (LAST / PR baseline) on `GET /sessions/{id}`.
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
  - **Pre-existing write gap (found in Phase 0).** `requireActiveCoachMutation` (`internal/workoutsession/workoutsession.go`) checks only an active `coach_athletes` row, not that the caller scheduled the session. A Coach who knows another Coach's `sessionId` can therefore log, edit, or complete sets in it. Today ids are not discoverable across Coaches. To keep it that way, `/training-log` and `history` **never return `sessionId`/`scheduledWorkoutId` for OTHER_COACH sessions**, and SetLog ids are never returned. Closing the gap itself (requiring `scheduled_workouts.coach_id = caller` for Coach mutations) is a separate follow-up task.
- Dependencies / blockers:
  - RIR task merged first.
  - Existing `/coach/workouts` History page, `/coach/clients/[athleteId]`, `/session/[id]`, athlete Today/Calendar.

## 2. Technical Design

- Affected files/components (per sub-task, see §3):
  - Docs: API contract (new §3.10 Training Log, `GET /sessions/{id}` additive field, Authentication table row), MVP spec, frontend UI spec, Privacy page copy
  - API: `internal/progress/` (new: pure comparison engine, table-tested), `internal/traininglog/` (new: query + authorization), `internal/workoutsession/` (`history` on session detail), `cmd/api/main.go` (route), tests
  - Web: `app/session/[id]/*` (LAST / PR cards, live set badge), new exercise progress route(s) (chart + history), `app/coach/workouts/*` (inline results + events), athlete History entry, i18n en/zh-TW
- Comparison engine (`internal/progress`, pure functions, no I/O):
  - Input: one athlete's COMPLETED exposures of one `exercise_id` in one unit, in date order, each with its SetLogs (load, reps, rir) and the exercise's position in that day's workout.
  - **Top set** of an exposure: heaviest load; ties → most reps; ties → lowest set number. Bodyweight (no load) compares reps only.
  - Per-exposure metrics (for the chart's metric switch): top set (load, reps, rir), estimated 1RM `load × (1 + (reps + rir) / 30)` from the top set (labelled "estimated", one selectable metric, never a verdict), max load, total reps, volume load `Σ load × reps`, set count.
  - Events, each compared with **all earlier exposures** (across Coaches, same unit):

    | Event | Rule |
    | --- | --- |
    | `LOAD_PR` | top-set load > every earlier load |
    | `REP_PR` (at load X) | reps at load X > every earlier reps at X |
    | `LOAD_CHANGE` (±Δ) | top-set load ≠ previous exposure's top-set load |
    | `MATCHED` | same top-set load and reps as the previous exposure |
    | `REPS_DOWN` | same top-set load as the previous exposure, fewer reps, **and RIR not higher** (a higher RIR means a deliberately easier day, not a drop) |

  - The first exposure has no events. Position is returned as context (`position`), not as an event.
  - Live in-workout badge: the server supplies the baseline (`last`, `maxLoad`, `bestRepsByLoad`). The web compares the just-logged set against it only to show a provisional badge. The persisted events always come from the engine.
- Authorization (single rule, documented in the contract's Authentication table):
  - Athlete caller: own sessions only, all Coaches. Supplying another `athleteId` → `404 NOT_FOUND`.
  - Coach caller: sessions of any athlete with whom the Coach has **historical access** (`coach_athletes` row), **regardless of which Coach scheduled them**, the same rule as `GET /sessions/{id}`. Each session carries `source: "OWN" | "OTHER_COACH"`. For `OTHER_COACH`, `sessionId`, `scheduledWorkoutId`, `workoutName`, `coachCue`, and `plan` are `null`/omitted, and the scheduling Coach is never named. OTHER_COACH rows are therefore not tappable into `/session/{id}`.
  - The response never includes anything from athletes the caller has no row with.
- API changes (contract updated **before** code, per AGENTS.md §6):
  1. `GET /sessions/{id}` (additive): each exercise gains
     `history: { last: { date, setLogs: [{ setNumber, load, unit, reps, rir }] } | null, maxLoad: { load, unit, reps, date } | null, bestRepsByLoad: [{ load, unit, reps, date }] }`.
     `last` is the athlete's most recent **COMPLETED** exposure of the same `exercise_id`, scheduled before this session, from any Coach. Bests cover all earlier COMPLETED exposures in the exercise's unit. No session ids are returned.
  2. `GET /training-log?from=&to=&athleteId=&exerciseId=&status=` (new, Coach or Athlete):
     - `from`/`to` required (inclusive `scheduled_date`). The span is at most 184 days; longer spans return `400 INVALID_ARGUMENT`, and the client pages backwards for All Time.
     - `athleteId` is optional for Coaches (omitted = all athletes with historical access) and must be omitted or self for Athletes.
     - `exerciseId` is optional; with it, each session includes only that exercise, and sessions without it are excluded.
     - `status` is optional (`ACTIVE`, `COMPLETED`); the progress page passes `COMPLETED`.
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
     - Each exercise also carries `position` and engine `events` (`[{ "type": "REP_PR", "load": 32.5, "unit": "kg" }]`).
     - With `exerciseId`, the response adds `exposures`: the engine's per-exposure metrics for the chart, oldest first, grouped by unit.
     - Not-started assignments are not sessions and are not returned. History still gets them from `GET /scheduled-workouts`.
- Data flow:
  - **In-workout LAST / PR:** `GET /sessions/{id}` → `history` per exercise → two cards above the set inputs: `LAST · 9/29 — 32.5 × 9·9·8 @1` and `PR @ 32.5 kg — 9 reps`. After a set is logged, a provisional `Rep PR` / `Matched` badge is shown from the baseline.
  - **Coach History:** fetch `GET /scheduled-workouts` (statuses, including Not started) and `GET /training-log` (results, including OTHER_COACH) for the same range and filter → merge on `scheduledWorkoutId` → OTHER_COACH sessions are rows of their own, labeled `Other coach`.
  - **Exercise progress:** tapping an exercise name opens Athlete → Exercise → `GET /training-log?athleteId&exerciseId&status=COMPLETED` →
    - a metric switch (Top set · Estimated 1RM · Load · Reps · Volume) and a range switch (3 months · 1 year · All);
    - a chart: top-set load on the y-axis, each point labelled `reps@RIR`, dashed event lines at load changes, and other-Coach points drawn hollow;
    - a selected-point card with every set and the previous exposure;
    - a history timeline below (date, every set, events, position). One chart and timeline per unit (kg / lb); `Load earlier` pages 184 days back.
  - **Athlete History:** an athlete entry point (from Today/Calendar) calls the same endpoint without `athleteId` and shows their own feed and exercise progress (read-only).
- Schema changes: none required. An index migration is added only if `EXPLAIN` shows a sequential scan on realistic data.
- Frontend state/UI impact:
  - History cards show one compact line per exercise (`Bench Press  80 kg × 8 · 8 · 7 @2`) with its engine events (Rep PR, Load PR, +2.5 kg, Matched, Reps ↓). ACTIVE sessions are labeled In progress with the sets logged so far.
  - No grades, scores, or status labels anywhere. Raw sets stay visible next to every chart (concept doc: keep raw load/reps/RIR; never replace them with a single score).
  - Copy in en and zh-TW. Mobile width verified.
- Backward compatibility / data backfill:
  - Read-only. No backfill. The only existing-route change is an additive response field.

## 3. Estimate

- Size: XL. Ordered sub-tasks, each independently verifiable and shippable:
  0. **Prerequisite:** RPE → RIR (`docs/tasks/2026-10-04-rpe-to-rir.md`).
  1. **Contract + spec docs:** `history` on `GET /sessions/{id}`, `/training-log` (+ `events`, `exposures`), the authorization row, the event rules table, MVP/UI spec. Docs only.
  2. **Comparison engine** (`internal/progress`): top set, metrics, events; table tests covering every rule, ties, bodyweight, unit separation, first exposure, and RIR-higher-is-not-a-drop.
  3. **LAST / PR during the workout:** backend `history` + integration tests (own Coach, other Coach, no history, ACTIVE excluded, units). Web: LAST and PR cards and a provisional set badge.
  4. **Exercise history + progress chart:** `GET /training-log` backend (authorization matrix, OTHER_COACH redaction, range validation, `EXPLAIN`). Web: progress page with metric/range switch, chart, selected-point card, and history timeline, reachable from session, History, and client detail, for both Coach and athlete (read-only).
  5. **Training history events:** Coach History inline results with engine events, merged with Not-started assignments; athlete "My history" feed.
  6. **Privacy page + join disclosure** (en/zh-TW). It must reach production **with or before** sub-task 3, because LAST can show another Coach's data.
  7. Local end-to-end with two Coaches and one shared athlete; staging deploy and smoke test.
- Next, in its own Task Doc (not this task): **Coach Progress Overview V1**, objective data only — recent PRs, an 8-week trend per exercise, completion rate, and planned vs completed sets. Warnings and recommendations wait for the Dose/Response engine.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Data already links set_logs → scheduled_workout_exercises.exercise_id (+ position); `GET /sessions/{id}` already uses historical-access ACL without `coachId = caller`. |
| Design review — grades rejected | Done | 2026-10-05: A+–D grades prototyped and dropped; events + trends adopted; Overview deferred. |
| 0. RPE → RIR | Not Started | Separate Task Doc. |
| 1. Contract + spec docs | Done | 2026-10-05: contract V0.12 (`history`, §3.10 `/training-log`, event rules, auth rows), UI routes, MVP section. |
| 2. Comparison engine | Not Started | |
| 3. LAST / PR in workout | Not Started | |
| 4. Exercise history + progress chart | Not Started | |
| 5. Training history events | Not Started | |
| 6. Privacy + join disclosure | Not Started | Ships with or before 3. |
| 7. E2E + staging smoke | Not Started | Production excluded until explicitly approved. |

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
  - Remove the RIR task's legacy-`rpe` request guard.
  - Close the Coach mutation gap: Coach writes to a session require `scheduled_workouts.coach_id = caller`.
  - Coach Progress Overview V1 (objective data only), own Task Doc.
  - Dose–response layer (Training Block → prescribed volume → actual SetLogs → exercise performance → muscle effective dose → coach recommendation) builds on `/training-log` and the comparison engine. Training Blocks require an explicit scope change first: AGENTS.md §3 lists Programs and advanced periodization as out of scope.
