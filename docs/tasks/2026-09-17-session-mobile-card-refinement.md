# Task: Session Mobile Card Refinement

- Date opened: 2026-09-17
- Related contract sections: MVP Stories 2 and 4; frontend UI spec `/session/[id]`
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: The shared live Session screen does not make exercise cards clearly tappable. Opening one creates too many nested card borders and too much vertical space; Athlete-added exercises are also too pale to distinguish at a glance.
- Options considered:
  1. Keep the current card structure and make minor colour-only changes.
  2. Keep the current shared Session state and API behaviour, but compact the card header and the expanded set rows.
  3. Replace the Session UI with a separate mobile-only component and state model.
- Trade-offs (per option): Option 1 does not resolve the unclear opening action or excessive space. Option 2 is contained to the shared UI and preserves unsent input, refresh, and set-log semantics. Option 3 creates unnecessary duplication and risks diverging Coach and Athlete behaviour.
- Selected option and why: Option 2. It makes interaction and provenance clear while preserving the existing core set-log flow.
- Risks & unknowns: Dense 375px layouts need retained 44px-plus targets and 16px input text; real authenticated staging data is required for a complete device acceptance pass.
- Dependencies / blockers: Existing Session API and poll/focus refresh remain unchanged. No schema, API, authorization, or infrastructure change is needed.

## 2. Technical Design

- Affected files/components: Shared `/session/[id]` page plus English and zh-TW athlete messages.
- Frontend state/UI impact: The full header area toggles one open exercise and gives an explicit expand/collapse affordance. Collapsed cards present the source and completion summary in two compact lines. Expanded content uses flatter set rows; the current set keeps direct load/unit, reps, and RPE inputs, while other planned and completed sets remain concise summaries with Record/Edit actions. Athlete-added cards use a pale amber fill, dark left rail, and solid provenance label. The Remove action moves into the expanded area.
- Backward compatibility / data backfill: No persisted data or API payload changes. Existing set-log edit, retry, current-set progression, final-set next-exercise action, and unsent form state are preserved.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| 1. Baseline inspection and Task Doc | Done | Current `origin/staging` inspected; independent branch created. |
| 2. Compact shared Session UI and translations | Done | Kept existing Session state and set-log APIs intact. |
| 3. Automated and viewport verification | In Progress | Lint and relevant unit tests pass; staging viewport pass remains. |
| 4. Staging deployment verification | Not Started | Push only this branch and confirm the deployed commit/CI. |

## 5. Outcome (filled at completion)

- Final status: Pending.
- Deviations from plan: None yet.
- Follow-ups: None yet.
