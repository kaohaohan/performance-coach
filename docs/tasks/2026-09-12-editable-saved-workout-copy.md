# Task: Editable copy of a saved workout

- Date opened: 2026-09-12
- Related contract sections: AGENTS.md §2 Core Loop, §6 API Contract Discipline, §7 Task Sizing, §9 Task Documentation, §19 Documentation Rules
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: Calendar → From saved currently allows a Coach to assign a saved Workout only as-is. A Coach who wants to reuse an earlier Back workout on another day and adjust its exercise-level sets, load, reps, RPE, or individual-set overrides must rebuild it manually.
- Options considered:
  1. Keep direct assignment only and require manual recreation for variations.
  2. Open and mutate the selected saved Workout before scheduling it.
  3. Copy the selected saved Workout into the existing inline Builder, edit the copy, create it as a new saved Workout, and then schedule it; retain direct assignment as a secondary shortcut.
  4. Add a workout-wide progression engine for bulk set/load changes at the same time.
- Trade-offs (per option):
  - Option 1 has no engineering cost but keeps the high-friction workflow that triggered this task.
  - Option 2 avoids creating another template but risks changing future use of the original template and conflicts with the Coach's expectation that the source and prior assignments remain unchanged.
  - Option 3 reuses the current draft editor and existing Workout/ScheduledWorkout APIs, keeps source data safe, and solves the immediate workflow with a small frontend-only change. It creates another saved Workout because V0.1 has no ephemeral scheduled-only Workout.
  - Option 4 could reduce future programming work but introduces ambiguous progression semantics across exercises, units, athletes, and per-set overrides. It expands the task beyond the immediate core-loop friction.
- Selected option and why: Option 3. It directly completes the Calendar programming loop with existing domain behavior and no API, schema, authorization, or infrastructure change. Option 4 remains deferred until real usage establishes the required progression rules.
- Risks & unknowns:
  - Copied Workouts can create similarly named saved templates. The copy's name remains editable in the Builder.
  - Draft hydration must preserve sparse, property-specific overrides without flattening them into repeated values.
  - Starting a copy must not mutate the source Workout, an existing ScheduledWorkout, or an unrelated stored browser draft.
- Dependencies / blockers: The saved Workout list must include complete exercise prescription metadata. The current `GET /api/v1/workouts` response already provides it. No known blocker.

## 2. Technical Design

- Affected files/components:
  - `docs/mvp-specification.md`
  - `docs/frontend-ui-spec.md`
  - `apps/web/app/coach/calendar/page.tsx`
  - `apps/web/app/coach/calendar/workout-draft.ts`
  - `apps/web/app/coach/calendar/workout-draft.test.ts`
- Data flow:
  1. Coach selects date, Athlete(s), and a saved Workout in Calendar → From saved.
  2. `Copy & edit` maps the selected Workout name and ordered exercises into the existing local draft representation.
  3. The mapper preserves each exercise's set count, exercise-level defaults, unit, prescription mode, and sparse per-position overrides.
  4. Calendar switches to the existing Build editor and shows that the Coach is editing a copy; the source Workout remains untouched.
  5. Coach edits any exercise. Uniform defaults continue to flow to planned positions that do not have explicit overrides.
  6. Existing Build & Assign orchestration creates one new saved Workout through `POST /api/v1/workouts`, then schedules it through `POST /api/v1/scheduled-workouts` for the selected date and Athletes.
  7. `Assign as saved` remains available as the secondary path and keeps the existing direct scheduling behavior.
- API changes: None. Reuses existing `GET /api/v1/workouts`, `POST /api/v1/workouts`, and `POST /api/v1/scheduled-workouts` contracts and authorization.
- State transitions:
  - `From saved + Copy & edit` → hydrated local Build draft → edited local Build draft → new saved Workout created → ScheduledWorkout assignments created.
  - `From saved + Assign as saved` → existing saved Workout scheduled directly.
  - At no point does either transition update the source Workout or a previously scheduled prescription.
- Frontend state/UI impact:
  - From saved presents `Copy & edit` as the primary action and `Assign as saved` as the secondary action.
  - Copying switches into the current Build editor with all authoring fields prefilled and an explicit source-copy notice.
  - Editing remains exercise-scoped: changing an exercise default updates its inheriting set positions; changing one planned position creates or updates only that override.
  - Workout-wide percentage progression, automatic load recommendations, and bulk cross-exercise changes are not added.
- Backward compatibility / data backfill: Existing saved and scheduled Workouts are unchanged. No data migration or backfill is required.

## 3. Estimate

- Size: M
- Points (optional): 3

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Existing APIs and Builder can support a frontend-only copy flow. |
| Phase 1 — task and canonical product/UI documentation | Done | Copy semantics defined; progression automation remains explicitly deferred. |
| Phase 2 — draft mapper, Calendar UI, and unit tests | Done | Copy now hydrates the existing Builder, preserves defaults/overrides, and retains direct assignment. |
| Phase 3 — lint/build verification and completion review | Done | Unit test, TypeScript, and scoped lint pass; production build reached a DNS failure fetching Google Fonts. |

## 5. Outcome (filled at completion)

- Final status: Completed
- Deviations from plan: The full Next production build could not complete because the local environment could not resolve `fonts.googleapis.com`; this occurred before application compilation and is unrelated to the changed Calendar modules.
- Follow-ups: Evaluate a separate, evidence-driven bulk progression workflow after Coaches use editable copies in production.
