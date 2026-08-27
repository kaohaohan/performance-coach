# Task: Calendar — inline exercise creation from picker

- Date opened: 2026-08-24
- Related contract sections: AGENTS.md §4 Architecture Boundaries, §6 API Contract Discipline, §7 Task Sizing, §8 Phase Gate, §9 Task Documentation
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: When the Calendar builder cannot find an exercise, the coach must leave the primary programming workflow for Exercise Library. This interrupts building a workout for a single missing movement.
- Options considered:
  1. Create the exercise through `POST /api/v1/exercises`, then add the returned exercise to the current draft.
  2. Add a synthetic local exercise and rely on `POST /api/v1/workouts` to find or create it at save time.
- Trade-offs (per option):
  - Option 1 creates a real coach-owned exercise immediately, preserves draft IDs, and makes it reusable without saving the workout. It adds one request at the point of creation.
  - Option 2 avoids a request but makes the persisted draft contain a synthetic ID and defers conflict handling until workout save.
- Selected option and why: Option 1. It uses the existing Exercise API directly and maintains a consistent, reusable exercise entity in the draft.
- Risks & unknowns: Exercise names have case-insensitive system/private collision behavior. A 409 must resolve the visible existing exercise instead of presenting a dead end. Exercise edit/archive remains unavailable, so accidental creation is not corrected by this task.
- Dependencies / blockers: None. `POST /api/v1/exercises` already creates coach-owned private exercises; this task changes frontend behavior and the product/UI documentation that currently declares inline creation out of scope.

## 2. Technical Design

- Scope:
  - Let a coach create a missing exercise directly from the Calendar exercise picker.
  - Add the created or resolved exercise to the active workout draft and return focus to sets.
  - Keep the draft intact for all creation failures.
- Affected files/components:

  | File | Expected change |
  | --- | --- |
  | `apps/web/app/coach/calendar/page.tsx` | Extend `ExercisePicker` and its parent state/handlers for inline creation and collision resolution. |
  | `docs/mvp-specification.md` | Change the Exercise Library and Calendar-builder scope statements to allow this focused inline creation flow. |
  | `docs/frontend-ui-spec.md` | Change the Calendar/Exercise Library route and product-rule wording to reflect inline creation while retaining Exercise Library as secondary management. |

- API changes: None. Use the existing `POST /api/v1/exercises` request and response. Existing 409 conflict semantics remain unchanged. No new endpoint, request shape, response shape, status code, or authorization rule is introduced.
- Data flow:
  1. Coach types a non-empty exercise query in the Calendar picker.
  2. If no usable existing result is selected, show `Create "{query}"`.
  3. Submit `POST /api/v1/exercises` with the queried name.
  4. On success, pass the returned exercise to the existing `addExercise()` flow, close the picker, and focus the new exercise's Sets control.
  5. On 409, re-run `GET /api/v1/exercises?q=` using the attempted name, find the visible case-insensitive matching exercise, and add it through the same path.
  6. On any unresolved or non-conflict failure, show an inline picker error and leave the open builder draft unchanged.
- Frontend state/UI impact:
  - Add a creation-in-flight state separate from search loading.
  - Disable duplicate creation/add actions while creation is in progress.
  - Preserve the current existing-exercise search and deduplication by real exercise ID.
- Invariants:
  - Inline creation always calls `POST /api/v1/exercises`; it does not create synthetic client-only exercises or defer creation to workout save.
  - A case-insensitive 409 name collision re-resolves the existing visible exercise before reporting an error.
  - Any failure leaves the workout draft name, exercises, prescription state, and local draft persistence intact.
  - Success uses the existing `addExercise()` behavior, including duplicate prevention.
  - Exercise Library remains the secondary location for browsing and managing existing exercises; this task adds only quick creation from Calendar.
  - Existing `POST /workouts` name-based exercise payload behavior remains unchanged.
- Backward compatibility / data backfill: No schema, data migration, API contract, or authorization change.

### Acceptance Criteria

- A coach can create a private exercise from a non-empty Calendar picker query and add it to the active draft without leaving Calendar.
- The returned exercise is immediately usable in the draft and later discoverable through the existing exercise search.
- A case-insensitive 409 collision resolves to the existing visible exercise and adds it rather than creating a duplicate or losing the draft.
- A non-409 creation failure displays a local actionable error and preserves the full draft.
- Athlete access and the existing Exercise Library authorization rules remain unchanged.
- No synthetic IDs, new Exercise API endpoint, or workout-save-time-only creation path is introduced.

### Verification

- Run `npm run lint` and `npx tsc --noEmit`.
- Add or update focused component/handler assertions for success, creation pending state, 409 re-resolution, unresolved 409, and general request failure with preserved draft state.
- Manually verify creation from a no-results search, case-variant collision, later picker search visibility, duplicate prevention, keyboard focus returning to Sets, and a retained draft after a forced failure.
- Confirm the relevant `mvp-specification.md` and `frontend-ui-spec.md` statements no longer conflict with the implemented behavior.

### Explicit Non-Goals

- Exercise edit/archive, metadata, tags, categories, media, system-exercise seeding, or changes to Workout Library's separate picker.
- Changes to `POST /workouts`, `FindOrCreateVisible`, the Exercise API contract, schema, or authorization.
- T1 status/footer changes, T2 duplicate-panel work, T4 terminology sweep, and the All Clients calendar prototype.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 / Task Doc | Done | This document |
| Add picker creation action and POST handler | Done | Creates through `POST /api/v1/exercises`, adds through the existing draft flow, and focuses Sets. |
| Add 409 resolution and error handling | Done | Re-searches the attempted name and adds the visible case-insensitive match; failures preserve the draft. |
| Update product and UI specifications | Done | Calendar inline creation is reflected while Exercise Library remains secondary. |
| Verification | Done | Lint, TypeScript, production SSR build, and focused creation/day-card assertions pass. |

## 5. Outcome (filled at completion)

- Final status: Implemented and locally verified.
- Deviations from plan: T1 Calendar day-card status/footer work is implemented in the same approved change set at the user's direction; T2 and T4 remain untouched.
- Follow-ups: None.
