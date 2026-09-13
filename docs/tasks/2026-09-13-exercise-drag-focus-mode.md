# Task: Exercise drag focus mode and compact cards

- Date opened: 2026-09-13
- Related contract sections: AGENTS.md §7, §9, §17, §19; `docs/frontend-ui-spec.md` §3
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: Whole-card dragging works, but iOS long press can select card text and expose the system Copy menu. The current lifted-card state leaves the rest of the page visually and interactively available, while collapsed exercise cards use more height than needed for ordering.
- Options considered:
  1. Retain the current movement-threshold drag and add only CSS selection suppression.
  2. Add a third-party drag-and-drop package with a modal overlay.
  3. Keep Pointer Events, use a touch-specific long press, and render an in-app focus overlay.
- Trade-offs (per option): Option 1 cannot reliably distinguish a page scroll from an intentional mobile drag. Option 2 adds a dependency and does not improve the existing draft-order data flow. Option 3 keeps the existing keyboard fallback and is controllable in Safari/iOS WebView.
- Selected option and why: Option 3. Touch waits 200ms before entering drag mode; a pre-activation 8px move remains a normal scroll. Desktop keeps immediate threshold drag. The overlay creates a Strong-style focused reorder state.
- Risks & unknowns: Pointer capture and the overlay must coexist on iOS; therefore drop targets are measured before the overlay appears instead of discovered through hit testing below it.
- Dependencies / blockers: None. No schema, API, authorization, native-project, or production data change is required.

## 2. Technical Design

- Affected files/components: Calendar Builder's `DraftExerciseCard` and pointer-drag state in `apps/web/app/coach/calendar/page.tsx`.
- Data flow: Dragging still reorders the in-memory `draftExercises` array by stable exercise ID. The existing save/build payload remains unchanged.
- State transitions: Idle → touch pending (200ms) or mouse pending → active drag → committed on pointer-up or reset on pointer-cancel. A touch move of at least 8px while pending becomes an app-managed page-scroll gesture without reordering, preventing iOS from cancelling a vertical drag after activation.
- Frontend state/UI impact: Active drag snapshots card rectangles, locks document scroll, places an input-blocking dim overlay over the page, keeps the lifted source card above it, and leaves dimmed cards plus insertion indicators visible as non-interactive references. From touch pending through drop/cancel, document-level selection and long-press callouts are suppressed so Safari cannot extend a selection beyond the source card. The collapsed card separates its explicit Expand button from the drag surface and uses a compact number/name/summary layout. Expanded editing remains unchanged.
- Backward compatibility / data backfill: None. Existing drafts and saved Workouts preserve their order and shapes.

## 3. Estimate

- Size: M
- Sub-task breakdown:
  1. Replace touch drag activation with long-press-aware pointer state.
  2. Add focus overlay, locked scrolling, measured drop targets, and selection suppression.
  3. Compact collapsed cards while retaining the explicit expand and move-button fallback.
  4. Verify locally and deploy staging for manual iOS validation.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — inspection and interaction decision | Done | User chose long-press touch activation and compact collapsed cards at all breakpoints. |
| Phase 1 — focus drag interaction | Done | Added touch long press, measured card drop targets, focus overlay, selection suppression, and scroll lock. |
| Phase 2 — compact card layout | Done | Collapsed cards now separate the drag surface from the explicit expand button and use a compact summary layout. |
| Phase 3 — verification and staging rollout | In Progress | Lint, typecheck, and selected Calendar tests pass; manual iOS verification remains. |

## 5. Outcome (filled at completion)

- Final status: Pending verification.
- Deviations from plan: None yet.
- Follow-ups: Test normal vertical scrolling, long press, cancellation, and text editing in iOS Safari/Capacitor WebView before production promotion.
