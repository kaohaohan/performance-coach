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
| Verify redirect resume | Done | `continueUrl` = current href; `auth-pending-verify` in localStorage; auto-resume join/coach signup |
| Change-email escape hatch | Done | `EmailVerificationPrompt` → signOut + return to form |
| Login verified-no-profile copy | Done | Distinct from generic noAccount |
| Verification | Done | go test authn + cmd/api; npm test 162/162 |
| Staging QA (web) | Done | Join + verify + redeem; change-email; Gmail spam copy workaround documented |
| Staging QA (App) | Done | Join create → verify screen → Gmail link in Safari → return to App → I've verified → Today |
| Staging sign-off | Done | 2026-09-22 |

## 5. Outcome (filled at completion)

- Final status: Implemented, follow-up UX fixes shipped, staging-verified (2026-09-22).
- Deviations from plan:
  - Local emulator skips sending the verification email.
  - Post-QA fixes: full-path `continueUrl`, localStorage pending state (sessionStorage lost across Gmail's new tab), change-email button, verified-no-profile login copy.
  - **Accepted UX:** Firebase verify links open in Safari on iOS; they do not return to the Capacitor app on staging or production. Athletes/coaches complete provisioning by returning to the app and tapping **I've verified** (web-only users can complete in-browser after the link).
  - Gmail may classify Firebase mail as spam and disable tappable links; users copy the URL to Safari or report not spam.
- Follow-ups (backlog, not blocking staging):
  - Optional post-verify landing page: “Email verified — return to PumpLoop and tap I've verified.”
  - Firebase Console: password policy alignment; monitor deliverability / spam rate for `noreply@dontworkout.firebaseapp.com`.
  - Production smoke: coach signup verify path; grandfather login with primary Gmail.
