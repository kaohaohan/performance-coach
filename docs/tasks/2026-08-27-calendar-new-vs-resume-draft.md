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
- Risks & unknowns: Empty New Workout must not discard another athlete's stored draft. The single-draft slot is replaced only when the new Build session has persistable content (name or exercises). Single-draft limit is unchanged (not per-athlete storage).
- Dependencies / blockers: None. No API/schema. Must not mix with `feat/account-deletion`.

## 2. Technical Design

- Affected files: `workout-draft.ts` / `.test.ts`, `page.tsx`, `day-card.tsx`, `docs/frontend-ui-spec.md`, this Task Doc.
- Schema / API: none.
- State: `builderSessionKind: "new" | "resume"`. New mode stores the Assign-to list as a mutable set defaulting to `[calendarAthleteId]`. Resume mode keeps `assignmentTargets(source, extras)` with source disabled. `storedDraft` mirrors localStorage independently of the live empty builder.
- Entry:
  - No draft → `startNewWorkoutForCalendar`.
  - Any stored draft → `+ Add Workout` opens a confirm dialog (same athlete/date included). Never silently continues.
  - Dialog: Start new (current Calendar, empty builder; stored draft kept until persistable content) **or** Continue (original draft context). Backdrop/Escape dismisses without either action.
  - Amber **Continue {athlete}** chip always continues; never used as `+ Add Workout`.
- Persistence: one draft slot. Empty New does not `clearDraft`. New-mode saves the exact checkbox IDs (`sessionKind: "new"`), including when the calendar athlete is unchecked. Resume still persists extras excluding the locked source. Legacy drafts without `sessionKind` restore as resume.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Branch from origin/staging | Done | `fix/calendar-new-vs-resume-draft` merged to staging @ `47532da` |
| Task Doc + UI spec | Done | |
| Split New vs Resume + conflict dialog | Done | |
| Decision A assign-to + CTA/chip | Done | |
| Tests + lint/tsc/build | Done | |
| Staging merge of split | Done | `94df6b4` / `47532da` |
| Keep stored draft on empty New + exact New checkboxes | Done | Follow-up after founder QA |

## 5. Outcome (filled at completion)

- Final status: Implemented keep-on-empty-New on `fix/calendar-keep-draft-on-empty-new`.
- Deviations from original Option 3: Start new no longer immediately replaces the stored draft; replacement waits for persistable Build content. New-mode Continue restores exact checkboxes instead of re-adding the calendar athlete.
- Follow-ups: none.
