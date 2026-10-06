# Task: Prevent accidental "Finish workout" taps

- Date opened: 2026-10-06
- Related contract sections: none changed (`POST /sessions/{id}/complete` unchanged); `docs/frontend-ui-spec.md` `/session/[id]` row ("sticky Finish control on overview")
- Size (S/M/L/XL, per AGENTS.md §7): S

## 1. Feasibility Analysis

- Problem / trigger: An Athlete logged one exercise, then tapped the session header's `完成` button believing it confirmed that exercise. It completed the whole WorkoutSession, which is permanently read-only, so the remaining exercises could not be logged.
- Options considered:
  1. Frontend misclick guard: hide Finish in the focus layer, clearer label, progress-aware confirm.
  2. Coach "reopen session" endpoint (COMPLETED → ACTIVE).
  3. Athlete undo window (e.g. 15 minutes after completion).
- Trade-offs (per option):
  1. No contract/schema change; 3 small files. Prevents the misunderstanding at its source but cannot recover an already-completed session.
  2. Recovers mistakes, but breaks the "COMPLETED is permanently read-only" invariant and touches PR events, last-completed loads, and completion rate. Requires contract change and a larger task.
  3. Same invariant break as 2, and would not have helped this case (the Athlete noticed the next day).
- Selected option and why: Option 1. It is the smallest change that removes the cause (Finish visible next to per-exercise logging, ambiguous label, confirm not mentioning unlogged sets). Option 2 is deferred until recovery is needed again (AGENTS.md §23).
- Risks & unknowns: `window.confirm` is a native dialog that shows the site URL and generic OK/Cancel buttons users dismiss habitually. After the first staging test, this was replaced with the shared in-app `ConfirmDialog` (see Outcome).
- Dependencies / blockers: none.

## 2. Technical Design

- Affected files/components:
  - `apps/web/app/session/[id]/page.tsx`
  - `apps/web/lib/i18n/messages/zh-TW/athlete.ts`
  - `apps/web/lib/i18n/messages/en/athlete.ts`
- Frontend state/UI impact:
  - Header Finish button renders only when `isActive && !focusedExercise`. The UI spec already scopes Finish to overview, so no spec change is needed.
  - `athlete.session.finish` label: `結束整份訓練` / `Finish workout`.
  - `handleComplete` counts planned sets over non-removed exercises using `orderedTargets` / `actualForTarget` (same logic as `session-overview.tsx`). If any planned set is unlogged it confirms with `athlete.session.finishConfirmIncomplete` (`{remaining}`, `{total}`); otherwise `athlete.session.finishConfirm`. Replaces the hard-coded locale ternary.
- Backward compatibility / data backfill: none.

## 3. Estimate

- Size: S

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc | Done | |
| Hide Finish in focus layer + label | Done | |
| Progress-aware confirm (i18n) | Done | |
| Replace `window.confirm` with in-app `ConfirmDialog` | Done | Founder request after first staging test |
| Lint / tests | Done | |
| Manual check in running app | Not Started | Needs a browser check by the founder |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## 5. Outcome (filled at completion)

- Final status: Code done; `npm run lint` (0 errors) and `npm test` (223/223) pass. Manual browser check pending.
- Deviations from plan: the native `window.confirm` was replaced with the shared `components/confirm-dialog.tsx` (title 結束整份訓練？, buttons 繼續記錄 / 結束並鎖定, red when sets are unlogged; focus starts on 繼續記錄). New keys: `finishConfirmTitle`, `finishConfirmAction`, `finishConfirmCancel`.
- Follow-ups: Coach reopen (option 2) stays in the backlog until needed again.
