# Task: Exercise coach cues and compact workout builder

- Date opened: 2026-09-13
- Related contract sections: AGENTS.md §2, §5, §6, §7, §9, §17, §19
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: A coach needs concise, workout-specific technique guidance for each Exercise, and the Calendar builder becomes impractically long when several Exercises expose all detail at once.
- Options considered:
  1. Add guidance to the global Exercise library and leave the Builder expanded.
  2. Keep guidance only in browser drafts and render it on the Coach screen.
  3. Store an optional cue on each WorkoutExercise, snapshot it into each ScheduledWorkoutExercise, and use a single-open Exercise accordion in the Builder.
- Trade-offs (per option):
  - Option 1 incorrectly shares workout-context guidance across unrelated programmes and cannot preserve historical intent.
  - Option 2 loses guidance on refresh/assignment and does not complete the Athlete workflow.
  - Option 3 adds one additive migration and existing API fields, but keeps template authoring, scheduled snapshots, Today, and Session consistent.
- Selected option and why: Option 3. It is the smallest durable extension of the core Coach → schedule → Athlete workflow and preserves the established template-versus-snapshot boundary.
- Risks & unknowns: This touches several existing API representations. The implementation must not flatten planned-set overrides, change routes, or make a later template edit mutate an existing assignment.
- Dependencies / blockers: A staging-only migration route is required because the current staging deploy guard rejects a migration-bearing API change. Production is explicitly out of scope.

## 2. Technical Design

- Affected files/components: Workout and ScheduledWorkout services/handlers, migration files, Calendar draft/builder, Today and Session renderers, focused API/web tests, and the four canonical product/API/schema/UI documents.
- Data flow:
  1. Coach enters an optional cue while authoring one Exercise in a Workout draft.
  2. `POST /workouts` trims and validates the cue, persists it with the WorkoutExercise, and returns it in existing Workout reads.
  3. Scheduling copies the cue into the ScheduledWorkoutExercise snapshot; pre-session edits replace the frozen cue only while no session exists.
  4. Athlete Today and Session reads render the frozen cue, never the live template field.
- Schema changes: Add nullable `coach_cue` text columns to `workout_exercises` and `scheduled_workout_exercises`; check non-blank values and maximum 500 characters. Existing rows remain null. The down migration removes only these additions.
- API changes: Existing workout and scheduled-workout exercise objects gain optional `coachCue`. Requests trim whitespace; blank serializes/stores as absent. More than 500 characters returns the existing 400 validation shape. Routes, authorization, and existing status codes remain unchanged.
- State transitions: New/copy/resumed Builder drafts preserve cues. A not-started scheduled workout may update its frozen cue with the rest of its snapshot. Active or completed sessions continue returning `409` for all scheduled-workout edits.
- Frontend state/UI impact:
  - Rename `Prescription` to `Training target` / `訓練目標` and `Text` to `Custom target` / `自訂目標`.
  - Add one `Coach cues (optional)` / `教練提示（選填）` textarea per exercise; its placeholder is `肩膀不要聳起，頂端停一秒` in zh-TW.
  - Keep custom target (for AMRAP, timed, or ranges) separate from the cue (technique/tempo/safety advice).
  - Render only one expanded Exercise card at a time. Cards initially load collapsed except a newly added exercise; a collapsed card shows name, sets, target, load, RPE, and an override marker. Validation opens, scrolls to, and focuses the first invalid card. Headers are accessible buttons with `aria-expanded` and `aria-controls`.
- Backward compatibility / data backfill: The migration is additive and no existing workout or assignment needs backfill. Old browser drafts deserialize without a cue and retain all prior authoring data.

## 3. Estimate

- Size: L
- Sub-task breakdown:
  1. Add the task/canonical documentation and schema migration with migration verification.
  2. Thread `coachCue` through Workout/ScheduledWorkout persistence, reads, handlers, and service tests.
  3. Preserve/render the field in Calendar draft/copy/edit, Athlete Today, and Session.
  4. Implement the single-open Builder accordion, translations, focused web tests, and accessibility behavior.
  5. Run full verification and deploy/migrate staging only; complete the staging E2E check.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Existing template/snapshot architecture supports the field without a route or auth change. |
| Phase 1 — task doc and canonical documentation | Done | Product, UI, API, and schema docs record Coach-cue snapshot semantics. |
| Phase 2 — migration and backend contract implementation | Done | Additive 0005 migration, trim/500-character validation, template/snapshot/read plumbing completed. |
| Phase 3 — Calendar, Today, Session UI and tests | Done | Draft/copy persistence, accessible single-open cards, labels, and Athlete rendering completed. |
| Phase 4 — verification and staging-only rollout | Done | Local migration, Go vet/test, TypeScript, lint, and web tests pass; staging migration completed, API deployed, and `/health` plus `/ready` checks pass. |

## 5. Outcome (filled at completion)

- Final status: Complete — staging-only rollout
- Deviations from plan: The staging migration credential was provisioned in a dedicated staging Secret Manager secret and executed by a dedicated staging Cloud Run Job before the API rollout. Production was not read or modified.
- Follow-ups: Validate the compact Builder and Coach cues in the staging UI at `https://performance-coach-git-staging-kaohaohans-projects.vercel.app`.
