# Task: Drag-and-drop exercise reordering

- Date opened: 2026-09-13
- Related contract sections: AGENTS.md §7, §9, §17, §19
- Size (S/M/L/XL, per AGENTS.md §7): S

## 1. Feasibility Analysis

- Problem / trigger: The Calendar Builder currently reorders Exercises through separate “move earlier/later” buttons. A drag interaction would make ordering faster and more discoverable.
- Options considered:
  1. Keep the existing buttons only.
  2. Use native HTML drag-and-drop on each card.
  3. Make the whole card a pointer-drag surface, while retaining the existing buttons as keyboard/touch fallback.
- Trade-offs (per option):
  - Option 1 has no implementation risk but keeps the current friction.
  - Option 2 is small on desktop but has inconsistent touch behavior in mobile browsers and weak keyboard support.
  - Option 3 adds a small interaction layer but works across mouse and touch without adding a dependency, and preserves an accessible non-drag path.
- Selected option and why: Option 3, with the card itself as the drag surface. A movement threshold distinguishes a drag from a tap, and interactive descendants remain click/focus targets. It changes only the existing draft array ordering and keeps the current API payload semantics.
- Risks & unknowns: The card drag surface must not interfere with page scrolling or inputs; the movement threshold, drop target and keyboard fallback must remain understandable on small screens.
- Dependencies / blockers: None. No schema, API, authentication, or production changes are required.

## 2. Technical Design

- Affected files/components: Calendar Builder exercise list/card, localized labels, and this Task Doc.
- Data flow: Pointer drag selects an Exercise by stable `exercise.id`, calculates a destination index, and reorders the existing `draftExercises` state. The existing save/build payload then sends the reordered array.
- Frontend state/UI impact: Use the whole card as the drag surface with an 8px movement threshold, while excluding buttons, inputs, selects, textareas and content-editable elements so expand/edit actions remain normal. Keep the lifted fixed-position card preview, original-position placeholder, before/after drop indicator, and “往前移動／往後移動” controls for keyboard and non-drag use. Dragging is disabled while the builder is submitting or otherwise not idle. Existing expanded-card state remains keyed by `exercise.id`.
- Backward compatibility / data backfill: None. Existing drafts and saved Workouts already preserve Exercise array order.

## 3. Estimate

- Size: S
- Sub-task breakdown:
  1. Add Task Doc and implement pointer drag/drop reorder interaction.
  2. Add localized drag affordance and rely on the existing web CI checks for regression coverage.
  3. Run web verification and deploy staging only.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection and approval | Done | Existing `draftExercises` array and `moveExercise` logic are reusable; user approved implementation. |
| Phase 1 — drag interaction and translations | Done | Added pointer-based drag interaction, drop target feedback, and retained move buttons as fallback. |
| Phase 2 — verification and staging rollout | Done | Staging CI passed web lint/build/typecheck/test and API checks; staging API deployment smoke test passed. |
| Phase 3 — lifted card drag polish | Done | Dragged cards now follow the pointer with elevation, while the source slot and insertion edge remain visible. |
| Phase 4 — whole-card drag surface | Done | Replaced the dedicated drag handle with thresholded card-level pointer dragging; interactive controls and button fallback remain available. Source lint and typecheck pass; the local production build was blocked only by unavailable Google Fonts network access. |

## 5. Outcome (filled at completion)

- Final status: Complete — ready for staging rollout
- Deviations from plan: No focused component test was added because the repository has no browser component-test harness; source lint, typecheck, and the relevant calendar tests pass. The local production build could not fetch Google Fonts in the restricted network, so CI remains the full build verification.
- Follow-ups: Manually verify pointer dragging in the staging Calendar Builder on desktop and mobile Safari/Chrome before production promotion.
