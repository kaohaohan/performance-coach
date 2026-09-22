# Task: Session focus polish and completed lock

- Date opened: 2026-09-22
- Related contract sections: `docs/go-backend-api-contract-v0.1.md` §3.7, §3.8, §4 (`PATCH /set-logs/{id}`); `docs/frontend-ui-spec.md` `/session/[id]`; `docs/mvp-specification.md` Story 2 / Story 4
- Size (S/M/L/XL, per AGENTS.md §7): **L** (split below)

Reverses the completed-session PATCH allowance from `docs/tasks/2026-09-14-edit-completed-set-logs.md`. Founder decision 2026-09-22: a finished workout is fully read-only.

## 1. Feasibility Analysis

- Problem / trigger: Focus `‹` `›` reads as paging to another workout. Athlete-added exercises use a full amber card that looks cheap. Athletes need to fix a mistyped load while the session is live. After Finish, the workout should not be editable.
- Options considered:
  1. Copy-only: relabel “All exercises” / arrows; keep amber cards; keep PATCH on COMPLETED.
  2. Frontend-only lock on COMPLETED while API still accepts PATCH.
  3. Relabel focus navigation, quiet athlete-added provenance, keep ACTIVE SetLog edit, and make COMPLETED fully read-only in the API and UI.
- Trade-offs (per option):
  - 1 does not fix the yellow card or the “finished still mutable” product rule.
  - 2 looks locked in the app but Coach/API/voice can still PATCH a completed log.
  - 3 matches founder intent; typos must be fixed before Finish; Coach review of completed sessions is read-only.
- Selected option and why: **Option 3.** Completion means the record is closed.
- Risks & unknowns: This is an intentional contract change. Existing integration test `TestUpdateSetLogCompletedSessionAuthorizationAndMergedValidation` must flip. Voice `UPDATE_PREVIOUS_SET` on a completed session will get `409`.
- Dependencies / blockers: None besides the contract update before backend/frontend.

## 2. Technical Design

- Affected files/components:
  - Contract / MVP / UI spec
  - `apps/api/internal/workoutsession/workoutsession.go` (`UpdateSetLog`)
  - `apps/api/cmd/api/main.go` (`handleUpdateSetLog` → `409` on `ErrSessionNotActive`)
  - `apps/api/internal/workoutsession/workoutsession_integration_test.go`
  - `apps/web/app/session/[id]/{page,exercise-focus,session-overview}.tsx`
  - `apps/web/lib/i18n/messages/{en,zh-TW}/athlete.ts`
- Data flow: Unchanged for ACTIVE logging and PATCH. After `POST /sessions/{id}/complete`, PATCH/POST/DELETE SetLogs and exercise adjustments all `409`. GET remains.
- Schema changes: none
- API changes:
  - `PATCH /api/v1/set-logs/{id}` requires session `ACTIVE`. COMPLETED → `409 CONFLICT` (`session is not active`), same as POST/DELETE.
  - Authorization otherwise unchanged (Athlete self or active-relationship Coach; historical Coach still `404`).
- State transitions: ACTIVE SetLogs remain editable. COMPLETED is read-only for all mutations.
- Frontend state/UI impact:
  - Focus back label: “返回動作列表” / “Back to list”.
  - Arrows keep previous/next exercise; show `{current} / {total}` between them.
  - Athlete-added and coach-added use the same white card as assigned exercises; provenance is a quiet text label, not a yellow fill.
  - Logged rows are tappable to edit only while ACTIVE. COMPLETED shows values without an edit control.
  - Finish confirm copy states the workout becomes fully read-only.
- Backward compatibility / data backfill: Existing completed logs stay as stored. Clients that still PATCH a completed log get `409`.

## 3. Estimate

- Size: L
- Sub-task breakdown:
  1. Task Doc + contract / MVP / UI spec
  2. Backend `UpdateSetLog` ACTIVE-only + tests
  3. Frontend navigation, provenance, ACTIVE-only edit, Finish copy

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Task Doc + specs | Done | Contract, MVP, UI spec: COMPLETED is fully read-only |
| 2. Backend PATCH lock | Done | `UpdateSetLog` requires ACTIVE; handler 409; tests split ACTIVE vs COMPLETED |
| 3. Frontend polish | Done | Nav label + position, white provenance, ACTIVE-only edit, Finish copy |
| Verification | Done | `gofmt`; `go vet`; `go test ./internal/workoutsession/... ./cmd/api/...`; `npm run lint`; `npx tsc --noEmit`; `npm test` (165 pass). iOS build bumped to 1.0 (5). |
| iOS build bump | Done | `CURRENT_PROJECT_VERSION = 5` for TestFlight upload |

## 5. Outcome (filled at completion)

- Final status: Committed on `staging` with session focus polish, COMPLETED read-only lock, coach cues/video surfacing, and TestFlight build 5.
- Deviations from plan: Session add-exercise dialog layout, coach cues, and `youtubeUrl` API surfacing landed in the same commit after founder QA.
- Follow-ups: Archive with `APP_TARGET=production npx cap sync ios` after promoting staging to production. Physical-device TestFlight smoke before wider distribution.
