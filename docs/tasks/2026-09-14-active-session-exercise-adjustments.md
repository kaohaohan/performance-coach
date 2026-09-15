# Task: Active Session Exercise Adjustments

- Date opened: 2026-09-14
- Related contract sections: MVP Stories 2/4/7; API §§3.5, 3.7, 3.8; database §§3, 6; frontend `/coach/calendar` and `/session/[id]`
- Size (S/M/L/XL, per AGENTS.md §7): XL

## 1. Feasibility Analysis

- Problem / trigger: A Coach cannot currently edit a ScheduledWorkout after its WorkoutSession starts. The product must support adding, withdrawing, and replacing exercises during an ACTIVE session without deleting planned or actual history. Athletes must also be able to add and manage their own exercises with visibly distinct provenance.
- Options considered:
  1. Remove the ACTIVE guard and keep replacing the whole snapshot.
  2. Permit only append operations after start.
  3. Preserve the pre-start replacement path and add session-scoped incremental add, soft-remove, and replace operations.
- Trade-offs (per option): Option 1 conflicts with SetLog foreign keys and historical identity. Option 2 cannot represent replacement of performed work. Option 3 adds schema and API surface but preserves stable history and provenance.
- Selected option and why: Option 3 is the smallest design satisfying live Coach changes, Athlete autonomy, and immutable performed-training history.
- Risks & unknowns: Concurrent completion, SetLog creation, and exercise adjustment must serialize. Stale clients must be unable to log removed exercises. Provenance cannot rely on color alone.
- Dependencies / blockers: PostgreSQL migration and coordinated Go/Next.js deployment. Unrelated iOS/Universal Link working-tree changes remain untouched.

## 2. Technical Design

- Affected files/components: canonical specifications; additive migration; scheduled-workout/workout-session services and handlers; Coach Calendar; Session UI; focused tests and translations.
- Data flow: NOT_STARTED keeps whole-snapshot `PUT`. ACTIVE endpoints lock the session, verify authorization/status, then append, soft-remove, or atomically replace snapshot rows. Replacement soft-removes the predecessor and creates a new row at the same active position. Clients refresh every 15 seconds and on focus.
- Schema changes: Add `origin`, `added_by_user_id`, `removed_at`, `removed_by_user_id`, and `replaces_scheduled_workout_exercise_id` to `scheduled_workout_exercises`. Backfill `ASSIGNED`; replace position uniqueness with an active-row partial unique index.
- API changes: Add session exercise options, create/replace, and soft-remove endpoints. Expand session/scheduled detail exercise metadata. Request plans reuse the existing complete defaults/overrides shape.
- State transitions: Structural changes require ACTIVE. Coaches with an active relationship manage all exercises; Athletes manage only their own additions. Existing targets are not edited in place. Removed exercises reject new SetLogs.
- Frontend state/UI impact: Calendar ACTIVE edit exposes Add/Remove/Replace with existing plans read-only. Session exposes Athlete self-add; Athlete additions use amber plus a text badge. Removed items remain in expandable adjustment history.
- Backward compatibility / data backfill: Existing rows become `ASSIGNED`; existing NOT_STARTED edit and assignment deletion remain unchanged. Reusable Workout templates are never mutated.

## 3. Estimate

- Size: XL
- Sub-task breakdown:
  1. Canonical contracts and Task Doc.
  2. Migration and provenance-aware read models.
  3. Session exercise APIs and concurrency protection.
  4. Coach Calendar ACTIVE adjustment UI.
  5. Athlete self-add, provenance UI, adjustment history, and refresh behavior.
  6. Full verification and completion reporting.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Contracts and Task Doc | Done | Planning approved and canonical contracts updated 2026-09-14. |
| 2. Migration and read models | Done | Added provenance, soft-remove, replacement linkage, and active-position index. |
| 3. Session adjustment APIs | Done | Added catalog, add/replace, remove, and stale SetLog protection. |
| 4. Coach Calendar UI | Done | ACTIVE Edit enters the shared Session adjustment UI. |
| 5. Athlete Session UI | Done | Added self-add, provenance treatment, replacement/removal flow, history, and refresh. |
| 6. Verification | Done | Go suite, targeted TypeScript/lint, diff checks, and clean scratch-DB migration passed; full Next build is environment-blocked. |

## 5. Outcome (filled at completion)

- Final status: Complete.
- Deviations from plan: The shared Session adjustment UI uses a compact reps-first form with optional kg load and RPE rather than the Calendar Builder's full per-position override interface. The API accepts the complete prescription shape for future expansion.
- Follow-ups: Add translated message keys for the compact adjustment controls; configure ESLint to exclude iOS DerivedData; investigate the local Turbopack worker-port restriction before relying on `next build` in this environment. The shared `performance_coach_test` ledger is missing 0005 entries although its schema already has `coach_cue`; repair that pre-existing migration baseline before using it for migration validation.
