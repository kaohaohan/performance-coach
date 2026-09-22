# Task: Shared password field and signup rules

- Date opened: 2026-09-18
- Related contract sections: none (client validation)
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: Login and signup hide passwords with no reveal control. Signup only requires 8 characters.
- Options considered:
  1. Shared `PasswordField` plus 8 + letter + number on create paths.
  2. Per-page toggles and Firebase Console-only policy.
- Selected option and why: Option 1. Same control everywhere; Console policy is a later founder step.
- Risks & unknowns: Login must not leak which password rule failed.
- Dependencies / blockers: None.

## 2. Technical Design

- Affected files/components: new `PasswordField` and `auth-credentials` helper; login, coach signup, join, settings; i18n.
- Frontend state/UI impact: Reveal toggle on every password input. New-password fields show the rule. Email must have `@` and a dotted domain.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Validator + PasswordField | Done | |
| Wire forms + i18n | Done | login, signup, join, settings |
| Verification | Done | npm test 162/162; staging web + App smoke 2026-09-22 |
| Staging sign-off | Done | Show/hide toggle and 8+letter+number rule confirmed on login, join, coach signup |

## 5. Outcome (filled at completion)

- Final status: Implemented and staging-verified (2026-09-22).
- Deviations from plan: None.
- Follow-ups: Optional founder step — align Firebase Console password policy with client rules.
