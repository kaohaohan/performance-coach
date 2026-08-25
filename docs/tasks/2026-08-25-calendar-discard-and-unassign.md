# Task: Calendar discard semantics and removing a mistaken assignment

- Date opened: 2026-08-25
- Related contract sections: AGENTS.md §§6–9, 12, 17–19, 21; `docs/go-backend-api-contract-v0.1.md` §3.5; `docs/frontend-ui-spec.md` §§2–3; `docs/mvp-specification.md` Story 1
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger:
  - Reported from TestFlight: on a date that already had one workout, the Coach began a second workout, chose **Discard Draft**, and a second `NOT STARTED` card remained on the Calendar after refresh.
  - Phase 0 inspection contradicts the report's causal claim. Discard Draft cannot create or leave a persisted ScheduledWorkout:
    1. `handleDiscardDraft` (`apps/web/app/coach/calendar/page.tsx`) is synchronous and issues no request; it calls `clearDraft` (localStorage) and resets builder state.
    2. Nothing is persisted while drafting. The draft lives only under `performance-coach:workout-builder-draft:<coachId>`; the autosave effect writes to localStorage only. `scheduled_workouts` has no status, draft, or archived column.
    3. The Discard button is disabled for the entire build transaction (`programmingControlsDisabled = assigning || buildStatus !== "idle"`), and `pendingAssignment` is non-null only while `buildStatus` is `assigning`/`assignmentFailed`. Discard is therefore unreachable in every state where a build is in flight or half-committed.
  - Exhaustive enumeration of write call sites confirms it: the web app has exactly three `POST /api/v1/scheduled-workouts` sites (the duplicate-day panel, `schedulePendingBuild`, and `handleAssign`), none reachable from discard.
  - The card can only have come from an assignment that actually succeeded. Two real defects explain why that reads as a discard leftover:
    - **No success confirmation.** `completeBuildAssignment` sets `assignSuccess` and then `setEditorOpen(false)`, but the notice was rendered inside `workoutEditor`, which is `editorOpen ? (...) : null`. Closing the builder unmounted the notice the same action had just enabled, so it never appeared. The builder simply vanished; on a phone the new card is often below the fold. The Coach concludes nothing happened and reaches for the one red button on screen.
    - **No way to remove an assignment.** No `DELETE /scheduled-workouts/{id}` existed in the router or the contract, which stated outright that the system had no ability to delete a schedule. An accidental assignment was permanent, so Discard Draft was used as an undo it never was.
- Options considered:
  1. Change Discard to delete a provisional persisted object.
  2. Fix the unreachable success notice only.
  3. Fix the notice, harden the build-transaction teardown, and add `DELETE /scheduled-workouts/{id}` with a Remove action on the card.
  4. Add an idempotency key to `POST /scheduled-workouts`.
- Trade-offs (per option):
  - Option 1 is not implementable as described: there is no provisional persisted object to delete. Building one would invert the current architecture, in which draft state is client-side until an explicit persistence action — the architecture the bug report itself asks for.
  - Option 2 addresses the likely trigger but leaves the Coach with no way to remove the workout already sitting in their data, and no way to correct the next mistake.
  - Option 3 fixes the misleading feedback and supplies the missing capability. It changes the API contract, so it must be split and the contract updated first.
  - Option 4 addresses ambiguous-network double-scheduling, which is a real but separate risk and is explicitly deferred by the existing "Partial failure / retry" rule.
- Selected option and why:
  - Option 3. It makes an accidental assignment visible when it happens and removable after it happens, without inventing a provisional persistence layer the architecture deliberately avoids.
- Risks & unknowns:
  - The exact TestFlight trigger is not directly observed; the analysis is from exhaustive static tracing of every write path. If a `POST /scheduled-workouts` is ever observed firing from anything other than the Assign submit, this analysis is wrong and the task must return to planning (AGENTS.md §10).
  - A delete endpoint is destructive. It is constrained to one row, owner-scoped in SQL under `FOR UPDATE`, and refused once any session exists.
  - The frontend test suite did not run at all before this change (see §2). Repairing it was a prerequisite for adding regression coverage.
- Dependencies / blockers:
  - `gh` returned `Forbidden` earlier; GitHub auth must be re-authorized before push.

## 2. Technical Design

- Affected files/components:
  - `apps/web/app/coach/calendar/page.tsx`
  - `apps/web/app/coach/calendar/build-transaction.ts` (new), `build-transaction.test.ts` (new)
  - `apps/api/internal/scheduledworkout/scheduledworkout.go`, `scheduledworkout_delete_integration_test.go` (new)
  - `apps/api/cmd/api/main.go`
  - `docs/go-backend-api-contract-v0.1.md`, `docs/mvp-specification.md`, `docs/frontend-ui-spec.md`
  - `apps/web/tsconfig.json` and the four existing `*.test.ts` files (test-harness repair, below)
- API change (contract updated first, per AGENTS.md §6):
  - New `DELETE /api/v1/scheduled-workouts/{id}`, Coach only. Checks in order: role → 403; UUID parse → 400; owner-scoped lookup `FOR UPDATE` → 404; any `workout_sessions` row (`ACTIVE` or `COMPLETED`) → 409. Success → 204.
  - Deletes in FK order within one transaction: `scheduled_workout_planned_sets` → `scheduled_workout_exercises` → `scheduled_workouts`. Reuses `lookupOwnedScheduledWorkoutForUpdate` and `scheduledWorkoutHasSession` so delete and update can never drift on "may this caller still change this assignment?".
  - No migration and no schema change. `apiFetch` already returns `undefined` on 204, so no client change was required.
- Frontend state:
  - `assignSuccess` becomes `string | null` — the message naming workout, date, and athlete count — and is rendered outside the builder alongside `saveChangesSuccess`, with the existing 5s auto-dismiss pattern.
  - Build-transaction vocabulary (`BuildStatus`, `PendingAssignment`) and its predicates (`clearedBuildTransaction`, `shouldOfferRetry`, `areProgrammingControlsDisabled`) move to `build-transaction.ts` so they are assertable; `page.tsx` is ~2000 lines with no component test harness available.
  - `handleDiscardDraft` additionally applies `clearedBuildTransaction()`. This is defensive — the button is unreachable mid-transaction — and guarantees a discarded draft can never strand a created workout id for the retry button.
  - Remove action on the Day-view card, gated on `session === null`, confirmed through the shared `ConfirmDialog`, with a 409 path that re-fetches and explains.
- Test-harness repair (prerequisite, not incidental scope):
  - All four existing frontend tests failed with `ERR_MODULE_NOT_FOUND`: they use extensionless relative imports, which Node's ESM resolver does not resolve. Adding explicit extensions plus `allowImportingTsExtensions` in `tsconfig.json` (safe under the existing `noEmit: true`) makes the pure-logic suites run.
  - `day-card.test.ts` and `duplicate-day-panel.test.ts` still cannot run: they import `.tsx`, and Node's type stripping does not transform JSX. That needs a loader/transform this repo has no dependency for, and is left as a separate concern.
- Backward compatibility: additive route; no existing route, request shape, response shape, status code, or authorization rule changed.

## 3. Estimate

- Size: M, executed as ordered sub-tasks:
  1. Sub-task 0 — confirm no discard→persist path exists (static enumeration of write call sites).
  2. Sub-task A — success notice, teardown hardening, extracted module + tests.
  3. Sub-task B — contract, `Delete`, route/handler, integration tests.
  4. Sub-task C — Remove action and product docs.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 / Task Doc | Done | This document |
| Sub-task 0 — confirm the persistence boundary | Done | Three `POST /scheduled-workouts` call sites enumerated; none reachable from `handleDiscardDraft` |
| Sub-task A — success notice + teardown + module | Done | `assignSuccess` now renders outside the builder; `build-transaction.ts` extracted, 6 assertions |
| Frontend test harness repair | Done | 3 of 5 suites now run; the 2 JSX ones still need a transform |
| Sub-task B — DELETE endpoint | Done | Contract first, then `Delete`, route, handler, 5 integration tests |
| Sub-task C — Remove action + product docs | Done | Day-card Remove behind `ConfirmDialog`, gated on `session === null` |
| Verification | Done | See §5 |
| Staging deploy | Blocked | Requires GitHub re-authorization (`gh` returned `Forbidden`) |

## 5. Outcome (filled at completion)

- Final status: Implemented and locally verified; staging deploy pending GitHub re-authorization.
- Deviations from plan: the frontend test suite had to be repaired before any frontend regression test could run — this was not anticipated in the plan and touches `tsconfig.json` plus the four existing test files.
- Follow-ups: a JSX transform so the two component tests can run; CI runs no frontend tests at all; an idempotency key for `POST /scheduled-workouts` remains deferred.
