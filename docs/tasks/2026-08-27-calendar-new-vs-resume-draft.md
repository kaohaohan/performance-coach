# Task: Split Calendar New Workout from Resume Draft

- Date opened: 2026-08-27
- Related contract sections: AGENTS.md §§6–9, 17–19; `docs/frontend-ui-spec.md` §3; `docs/mvp-specification.md` Story 1
- Size (S/M/L/XL, per AGENTS.md §7): M
- Base: `origin/staging` @ `9fb9f55478263d4685f23aed8aec591044a5bf81` (PR #9 assignment-context)

## 1. Feasibility Analysis

- Problem / trigger: PR #9 stopped silent wrong-athlete assignment, but `openWorkoutEditor` treated every open as Resume. On Cheryl's Calendar, `+ Add Workout` / New workout restored Apple Test's draft and locked Apple Test. Calendar chrome and builder context disagreed.
- Options considered:
  1. Keep one button that always resumes the single draft (current).
  2. Per-athlete drafts in localStorage.
  3. One draft still, but **New Workout** follows current Calendar context; **Continue Draft** is a distinct path; conflict asks which to do.
- Trade-offs: (1) is Calendar-first-incompatible. (2) is more storage and UX surface than MVP needs. (3) keeps PR #9 safety and matches coach intent.
- Selected option and why: Option 3. Founder Decision A: New Workout default-selects the viewed Calendar athlete, **editable** (may uncheck), submit requires ≥1 athlete. Continue Draft keeps locked source. User-facing copy is **Continue**, not Resume.
- Risks & unknowns: Starting New while another athlete's draft exists discards that draft after confirm. Single-draft limit is unchanged.
- Dependencies / blockers: None. No API/schema. Must not mix with `feat/account-deletion`.

## 2. Technical Design

- Affected files: `workout-draft.ts` / `.test.ts`, `page.tsx`, `day-card.tsx`, `docs/frontend-ui-spec.md`, this Task Doc.
- Schema / API: none.
- State: `builderSessionKind: "new" | "resume"`. New mode stores the Assign-to list as a mutable set defaulting to `[calendarAthleteId]`. Resume mode keeps `assignmentTargets(source, extras)` with source disabled.
- Entry:
  - No draft → `startNewWorkoutForCalendar`.
  - Any stored draft → `+ Add Workout` opens a confirm dialog (same athlete/date included). Never silently continues.
  - Dialog: Start new (current Calendar, replaces stored draft) **or** Continue (original draft context). Backdrop/Escape dismisses without either action.
  - Amber **Continue {athlete}** chip always continues; never used as `+ Add Workout`.
- Persistence: New-mode extras saved as selected IDs excluding `sourceAthleteId` (still the calendar the session started from). Resume restore unchanged (v1 `[0]`-only / v2 connected extras).

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Branch from origin/staging | Done | `fix/calendar-new-vs-resume-draft` @ `9fb9f55` |
| Task Doc + UI spec | Done | |
| Split New vs Resume + conflict dialog | Done | |
| Decision A assign-to + CTA/chip | Done | |
| Tests + lint/tsc/build | Done | 21 draft tests; lint 1 pre-existing warning |
| Commit / PR | Not Started | Awaiting founder review |

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
