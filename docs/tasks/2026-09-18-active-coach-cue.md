# Task: Active session coach cue visibility

- Date opened: 2026-09-18
- Related contract sections: AGENTS.md §§5–9, 17–21; active session exercise adjustments
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: A student can open an active exercise without seeing the coach's technique instruction when the scheduled snapshot has no cue. The existing Session renderer already displays a stored cue, but there is no safe way for a coach to add one after a session starts.
- Options considered:
  1. Read the live Workout template as a fallback.
  2. Add an active-session coach-only cue update for the frozen scheduled exercise.
- Trade-offs: Option 1 would make historical/session snapshots change when a reusable template changes. Option 2 adds a small API and UI surface while preserving the snapshot boundary.
- Selected option and why: Option 2, because it fixes existing active sessions without silently rewriting data or SetLog history.
- Risks & unknowns: Completed sessions must remain immutable; concurrent cue updates and session completion must serialize.
- Dependencies / blockers: Existing `coach_cue` column and active-session authorization are already deployed; no schema migration is required.

## 2. Technical Design

- Affected files/components: workout-session service/handler, API contract, shared Session UI, focused integration coverage.
- Data flow: Coach opens an active Session, edits a cue on an existing scheduled exercise, and sends a PATCH. The API locks the session and exercise, checks active relationship authorization, normalizes the cue, updates only `scheduled_workout_exercises.coach_cue`, and returns the updated exercise metadata. The student refresh then renders the frozen cue.
- API changes: Add `PATCH /api/v1/sessions/{sessionId}/exercises/{exerciseId}/coach-cue` with `{ "coachCue": string|null }`; only an active-relationship Coach may use it. ACTIVE returns 200; COMPLETED returns 409; inaccessible resources remain 404; blank cues clear the field.
- State transitions: Cue edits are allowed only while ACTIVE. They do not change exercise identity, planned sets, replacement links, or SetLogs.
- Frontend state/UI impact: Existing Session cards show the cue to all viewers. Coaches get an edit control while ACTIVE; students remain read-only. Save and clear states retain the current exercise list and set-log forms.
- Backward compatibility / data backfill: Existing rows remain null until a Coach adds a cue. No template or historical SetLog data is rewritten.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Contract and task doc | Done | Added active cue update semantics. |
| API service and handler | Done | Added coach-only ACTIVE-session PATCH; completed sessions and non-coaches remain blocked. |
| Session coach UI | Done | Coaches can add, edit, or clear a cue; students see the cue read-only. |
| Verification and staging rollout | In Progress | Go tests/vet, TypeScript, and focused ESLint pass; staging CI/deploy pending. |

## 5. Outcome (filled at completion)

- Final status: Implementation complete; awaiting staging CI/deploy verification.
- Deviations from plan: No focused integration test was added because the existing workout-session suite requires a configured test database; the full package suite still compiles and passes its available checks.
- Follow-ups: Verify the coach edit and student read-only display on the staging Session page.
