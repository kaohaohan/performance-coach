# Task: Verify new password emails before provisioning

- Date opened: 2026-09-18
- Related contract sections: API §§1, 3 coach-signup / invite redeem; MVP onboarding
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: Any syntactically valid email can create a Firebase account and provision a Coach or Athlete.
- Options considered:
  1. Gate only `POST /coach-signup` and invite redeem for password identities with `email_verified == false`. Grandfather existing `users` rows.
  2. Require verification on every authenticated route.
- Selected option and why: Option 1. Existing users stay signed in; Google/Apple unchanged.
- Risks & unknowns: Auth emulator has no real mailbox — skip the client send (and treat emulator users as verified) when `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` is set.
- Dependencies / blockers: Contract update before API + web.

## 2. Technical Design

- Affected files/components: `authn` Identity claims; coach-signup and redeem handlers; login/signup/join verify UI; API contract and MVP spec.
- API changes: 403 `EMAIL_NOT_VERIFIED` on those two provisioning routes when `sign_in_provider == password` and `email_verified` is false. `/me` is ungated.
- Data flow: `createUserWithEmailAndPassword` → `sendEmailVerification` → wait until `emailVerified` → provision.

## 3. Estimate

- Size: L
- Sub-task breakdown:
  1. Contract + API gate and tests.
  2. Web verify UI on signup, join, and abandoned login.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Contract + API | Done | 403 EMAIL_NOT_VERIFIED on signup/redeem |
| Web verify UI | Done | login, coach signup, join; emulator skips send |
| Verification | Done | go test authn + cmd/api; npm test |

## 5. Outcome (filled at completion)

- Final status: Implemented.
- Deviations from plan: Local emulator skips sending the verification email and treats the user as ready to provision.
- Follow-ups: Enable matching password policy in Firebase Console; confirm Action URL domains.
