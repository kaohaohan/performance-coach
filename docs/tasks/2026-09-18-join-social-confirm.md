# Task: Athlete join social vs email layout

- Date opened: 2026-09-18
- Related contract sections: MVP onboarding; frontend `/join/[code]`
- Size (S/M/L/XL, per AGENTS.md §7): S

## 1. Feasibility Analysis

- Problem / trigger: Google/Apple on the join screen sit above a required Name + email/password form, so social users think they must fill all fields first.
- Options considered:
  1. Reuse coach-signup name-only confirm after social auth.
  2. Split join into separate routes.
- Selected option and why: Option 1. Same model as `/coach/signup`; no new route.
- Risks & unknowns: Apple often omits `displayName` after the first grant.
- Dependencies / blockers: PasswordField from the password-field task.

## 2. Technical Design

- Affected files/components: `apps/web/app/join/[code]/page.tsx`, auth i18n.
- Frontend state/UI impact: Create tab keeps Name + email + password. Sign-in tab is email + password only. Google/Apple do not require Name first; empty provider name opens a name-only confirm card.

## 3. Estimate

- Size: S

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Join social-confirm UI | Done | |
| Verification | Done | |

## 5. Outcome (filled at completion)

- Final status: Implemented.
- Deviations from plan: None.
- Follow-ups: None.
