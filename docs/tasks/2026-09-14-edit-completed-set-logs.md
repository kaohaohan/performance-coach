# Task: Edit completed SetLogs

- Date opened: 2026-09-14
- Related contract sections: AGENTS.md §6, §7, §8, §9, §10; API contract §3.7–3.8 and §4
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: A completed workout currently renders every logged set as read-only. Athletes need to correct an already-recorded result after completing the session by tapping the completed set. The existing API contract names a SetLog PATCH endpoint, but the route and service are not implemented.
- Options considered:
  1. Reopen a completed session and reuse all ACTIVE-session mutations.
  2. Keep the session completed while allowing PATCH of existing SetLogs only.
  3. Allow only reps correction through a new specialized endpoint.
- Trade-offs (per option):
  - Option 1 reuses the current active UI but weakens completion semantics and also enables unintended add/delete behavior.
  - Option 2 preserves the completed state and audit boundary while providing correction of all existing actual fields through the already-specified resource endpoint.
  - Option 3 is smallest initially but duplicates SetLog mutation semantics and would require another contract expansion for load or RPE corrections.
- Selected option and why: Option 2. It directly addresses correction friction without changing prescription snapshots, session state, or the meaning of completion.
- Risks & unknowns: PATCH needs true omitted-versus-null semantics for optional fields. The UI must not accidentally expose POST or DELETE actions on a completed session. Historical read access must not be mistaken for mutation access.
- Dependencies / blockers: No schema dependency. The API behavior must be documented before frontend and backend implementations are considered complete.

## 2. Technical Design

- Affected files/components: Product/API/UI specifications; Go workoutsession service and API handler; session page, localized messages, and focused tests.
- Data flow: The user taps an existing planned or extra SetLog, edits a prefilled inline form, and submits `PATCH /api/v1/set-logs/{setLogId}`. The Go service resolves the SetLog and owning session, checks athlete/active-coach authorization, validates the merged actual fields, updates only mutable columns, and returns the updated SetLog. The client replaces that log in local session state.
- Schema changes: None.
- API changes:
  - Implement `PATCH /api/v1/set-logs/{setLogId}` with HTTP 200 and the updated SetLog response.
  - Accept optional `reps`, `load`, `unit`, and `rpe`; omitted fields are unchanged and explicit null clears optional fields.
  - Require at least one recognized mutable field. `reps` cannot be null. The merged result must satisfy reps >= 1, load >= 0, paired load/unit, unit in `kg|lb`, and RPE 1–10.
  - Immutable associations and metadata (`session`, exercise, planned target, kind, set number, logger) never change.
  - Athlete self and an active-relationship Coach may PATCH an existing log in ACTIVE or COMPLETED sessions. Unrelated callers, historical-only Coaches, and tombstoned users do not gain write access.
  - POST remains ACTIVE-only; DELETE remains ACTIVE-only and must not be implemented as a completed-session action in this task.
- State transitions: No state transition occurs. A COMPLETED session stays COMPLETED and `completed_at` is unchanged.
- Frontend state/UI impact: Existing planned and extra log summaries become tappable edit controls. One inline form is prefilled from actual values and offers Save/Cancel. A successful save replaces only the matching SetLog. Completed sessions continue to hide all add and completion controls.
- Backward compatibility / data backfill: Existing sessions and SetLogs require no backfill. ACTIVE-session logging behavior remains unchanged.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Contract/specification updates.
  2. Backend PATCH service, route, handler, and tests.
  3. Frontend inline editor, translations, and tests.
  4. Full verification and completion review.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection and approval | Done | Current UI, contract, backend gap, authorization, and working tree inspected; user approved the proposed plan. |
| Planning — Task Doc | Done | Authored in the high-reasoning planning session before implementation sessions. |
| Contract/specification updates | Done | Updated MVP, API, and frontend canonical specifications for PATCH-only edits in ACTIVE/COMPLETED sessions; POST/DELETE remain ACTIVE-only. |
| Backend implementation | Not Started | Assigned to a separate GPT-5.6 Luna medium-effort session after contracts. |
| Frontend implementation | Not Started | Assigned to a separate GPT-5.6 Luna low-effort session after backend. |
| Full verification and completion review | Not Started | Assigned to a separate GPT-5.6 Luna low-effort session. |

## 5. Outcome (filled at completion)

- Final status: In progress.
- Deviations from plan: None.
- Follow-ups: None currently.
