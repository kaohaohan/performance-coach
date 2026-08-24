# Task: Calendar — replace Copy Workout wizard with Duplicate panel

- Date opened: 2026-08-24
- Related contract sections: AGENTS.md §6 API Contract Discipline, §7 Task Sizing, §8 Phase Gate, §9 Task Documentation
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: The current three-step Copy Workout wizard makes a direct scheduling action feel like a multi-stage enterprise workflow. Coaches need to duplicate a day's selected workouts to chosen clients and a date in one focused interaction.
- Options considered:
  1. Replace the wizard with a single Duplicate panel using the current scheduled-workout endpoints and submission logic.
  2. Add a dedicated copy API endpoint.
  3. Use a persistent copy/paste mode on calendar cards.
- Trade-offs (per option):
  - Option 1 removes navigation overhead without changing the scheduling domain; it must preserve the current non-atomic retry and duplicate-confirmation behavior while making each source workout explicit.
  - Option 2 could centralize copy behavior but expands the API contract without a domain need.
  - Option 3 is compact for repeated copies but hides state and is less clear for a one-off duplicate action.
- Selected option and why: Option 1. It retains the existing API and all reliability behavior while presenting the task as one coherent decision.
- Risks & unknowns: Multiple source workouts still require separate requests. The UI must not re-send successful requests after a partial failure, and duplicate confirmation must retain its explicit user decision.
- Dependencies / blockers: None. This task replaces behavior delivered by `2026-08-22-calendar-copy-workout.md`; it does not alter scheduled-workout API behavior.

## 2. Technical Design

- Scope:
  - Replace the three-step modal with one `Duplicate` panel.
  - Show the fetched source-day workout summary, searchable client selection, and target-date selection together.
  - Let the coach select one or more distinct source workouts; all are selected by default.
  - Default target date to source date plus seven days; allow the coach to change it.
  - Rename visible copy/paste language and actions to duplicate language.
- Affected files/components:

  | File | Expected change |
  | --- | --- |
  | `apps/web/app/coach/calendar/copy-workout-wizard.tsx` | Delete after extracting or relocating its reusable date-picker behavior. |
  | `apps/web/app/coach/calendar/duplicate-day-panel.tsx` | Add a one-panel source summary, client selector, target date, and Duplicate/Cancel controls. |
  | `apps/web/app/coach/calendar/day-card.tsx` | Change the card affordance label, title, and accessibility text from Copy to Duplicate. |
  | `apps/web/app/coach/calendar/page.tsx` | Render the new panel and rename copy-specific state/handlers while preserving request behavior. |

- API changes: None. Continue reading `GET /api/v1/scheduled-workouts?from&to&athleteId` and writing `POST /api/v1/scheduled-workouts` with the existing request and authorization rules.
- Data flow:
  1. Duplicate from a day card opens the panel with that day as the source.
  2. Fetch source-day assignments independently of loaded calendar state, so any selected source date remains valid outside the current view range.
  3. Coach selects one or more source workouts, one or more clients, and a valid target date.
  4. For each selected distinct source `workout.id`, submit the existing schedule request for the selected clients and target date.
  5. Refresh the calendar only after all requests succeed; retain the panel and relevant state for recoverable outcomes.
- State transitions:
  - `idle → selected → submitting → closed` after complete success.
  - `submitting → partial failure` retains only failed workout IDs as outstanding.
  - `partial failure → selected` aligns the panel selection to the outstanding IDs; the next submission retries only those IDs.
  - A 409 duplicate scheduling response moves to explicit confirmation; confirmation retries with the existing duplicate-allowing path.
- Frontend state/UI impact:
  - Keep an in-flight guard, source fetch error/loading state, selected-workout state, submission error, and outstanding-workout state.
  - Use the already-loaded Workout template exercise names/counts to distinguish same-named source workouts without a second API request.
  - Do not derive the source exclusively from the current calendar assignments.
  - Remove the step rail and NEXT/BACK/PASTE flow; use Cancel and Duplicate.
- Invariants:
  - Partial-failure retry sends only workouts still in `copyOutstanding` (renamed as appropriate), never already successful workouts.
  - The initial submission sends only the source workout IDs the coach selected; unselected source workouts are never sent.
  - A 409 duplicate scheduling response requires explicit coach confirmation before the duplicate-allowing retry.
  - Independent source-day fetching remains intact.
  - The feature schedules from the source workouts' saved templates using the existing endpoint; it does not clone frozen source snapshots or add a copy endpoint.
  - Closing the panel discards panel-local selection state; it does not affect the Workout builder draft.
- Backward compatibility / data backfill: No persisted data, schema, endpoint, or authorization change.

### Acceptance Criteria

- A coach can open one Duplicate panel from a scheduled calendar day.
- The panel shows source-day workouts, client selection, and target-date selection without a multi-step flow.
- Each source workout is selectable and selected by default; same-named workouts remain distinguishable by exercise summary.
- It cannot submit without a selected source workout, at least one client, and a valid target date.
- The source date can be read independently from the current calendar range.
- Successful duplication creates the same scheduled-workout results as the current flow.
- If requests partially fail, the coach can retry and only failed workouts are re-sent.
- Duplicate scheduling conflicts require an explicit confirmation before retrying.
- No `POST /scheduled-workouts/copy` endpoint or other API contract change is introduced.

### Verification

- Run `npm run lint` and `npx tsc --noEmit`.
- Update or replace component/render assertions for one-panel dialog semantics, source loading/error, client validation, target validation, and Duplicate/Cancel labels.
- Exercise the request handler with complete success, partial failure followed by retry, 409 followed by confirm, and a source date outside the loaded calendar range.
- Manually verify keyboard access, cancellation, and readable behavior at week and month calendar widths.

### Explicit Non-Goals

- Batch date-range duplication, copy/paste mode, placement ordering, clearing existing workouts, prescribed-load toggles, colors, or copying frozen snapshots.
- Changing scheduled-workout uniqueness rules, API contracts, schema, or authorization.
- Changes to T1 status/footer behavior, T3 inline exercise creation, T4 terminology work, or the All Clients calendar prototype.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 / Task Doc | Done | This document |
| Extract/reuse date picker and create Duplicate panel | Done | One-panel source-workout selection, summary, client selection, target date, Duplicate, and Cancel controls. |
| Replace wizard wiring and preserve submission behavior | Done | Preserves independent source fetch, selected-only submission, outstanding-only retry, 409 confirmation, and in-flight guard. |
| Update card copy affordance | Done | Day-card accessible text and title now use Duplicate. |
| Verification | Done | Focused selection/retry assertions, lint, TypeScript, production build, and diff validation pass. |

## 5. Outcome (filled at completion)

- Final status: Implemented and locally verified.
- Deviations from plan: Follow-up correction adds explicit source-workout selection after manual testing exposed the ambiguity of duplicating every source-day workout.
- Follow-ups: None.
