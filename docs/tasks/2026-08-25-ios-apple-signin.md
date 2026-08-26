# Task: Sign in with Apple for iOS (App Review Guideline 4.8)

- Date opened: 2026-08-25
- Related contract sections: §6 API Contract Discipline, §7 Task Sizing, §16 AI/LLM Safety (n/a), App Review Guideline 4.8
- Size (S/M/L/XL, per AGENTS.md §7): M overall, split into three sub-tasks
- Source of truth: approved App Store review blocker audit (2026-08-25) + approved plan with founder corrections (2026-08-25)

## 1. Feasibility Analysis

- Problem / trigger: the app offers Google Sign-In (a third-party social login) to set up and authenticate the user's primary account. App Review Guideline 4.8 therefore requires Sign in with Apple as an equivalent option on the iOS build. No 4.8 exception applies: coaches self-register with arbitrary personal accounts, and athlete invite codes are an in-app invite mechanism, not organization-managed credentials. Without Sign in with Apple the 1.0 submission is a likely rejection.
- Options considered:
  1. **Native Apple via @capgo/capacitor-social-login (selected).** The plugin is already installed (8.4.5) and already drives native Google Sign-In; its Apple provider runs `ASAuthorizationController` natively and returns an identity token that converts to a Firebase credential with the pure JS SDK — no new native dependency.
  2. **Firebase web OAuth flow for Apple** (signInWithPopup/redirect inside WKWebView, or bouncing to SFSafariViewController). Rejected: the WKWebView popup path is broken by Capacitor's `createWebViewWith` behavior (the exact problem `lib/native-google-auth.ts` was created to solve), and bouncing to Safari breaks the single client state machine on `/join/[code]`.
  3. **Remove Google Sign-In from the iOS build** (email/password only). Compliant with 4.8 (no third-party login → no Apple requirement) but strictly worse product; rejected.
- Trade-offs (per option):
  1. Capgo native: smallest delta, mirrors a proven in-repo pattern; depends on plugin's Apple support quality (verified in installed source, see Risks).
  2. Web OAuth: no plugin dependency, but re-opens known-broken webview auth and adds redirect complexity.
  3. Google removal: zero code risk, product regression.
- Selected option and why: Option 1 — identical architecture to the shipped Google native flow, smallest compliant surface, no backend change.
- Risks & unknowns:
  - **Firebase/Apple console setup is an external manual step.** The exact requirements (enabling the Apple provider; Service ID / Team ID / Key ID / private key where Firebase currently requires them) must be verified against the current Firebase "Sign in with Apple" documentation at configuration time. Console values must not be fabricated, and code implementation must not block on values that are only needed during manual configuration. (Founder correction #1.)
  - **Account collision semantics.** Firebase project behavior for same-email Apple sign-in depends on console settings verified in the manual phase. The 1.0 code must not implement or assume automatic Google ↔ Apple linking, and must surface `auth/account-exists-with-different-credential` explicitly. (Founder correction #2.)
  - Apple returns the user's name/email only on first-ever authorization; `displayName` may be null. Existing name-form fallbacks (`coach/signup/page.tsx:117`, `join/[code]/page.tsx:212`) already cover this.
  - Apple button styling is itself reviewable; must follow Apple HIG (sub-task 2).
- Dependencies / blockers:
  - Installed plugin verified from source (8.4.5): Apple provider exists (`AppleProvider.swift`), cancellation maps to rejection `code: "USER_CANCELLED"` (`SocialLoginPlugin.swift:22,998`), `initialize` is per-provider and non-clobbering (`SocialLoginPlugin.swift:144-199`), and native initialize/login hard-require `apple: true` in `capacitor.config.ts`.
  - Xcode "Sign in with Apple" capability + Firebase console enablement are manual steps (sub-task 3); they do not block sub-tasks 1–2.

## 2. Technical Design

- Affected files/components:
  - `apps/web/capacitor.config.ts` — enable `apple: true` (sub-task 1)
  - `apps/web/lib/native-apple-auth.ts` — new; mirrors `native-google-auth.ts` (sub-task 1)
  - `apps/web/lib/native-apple-auth.test.ts` — new; node:test, per repo convention (sub-task 1)
  - `apps/web/lib/auth-context.tsx` — add `signInWithApple` (sub-task 1)
  - `apps/web/components/apple-sign-in-button.tsx` — new; HIG-conformant button + error mapper (sub-task 2)
  - `apps/web/app/login/page.tsx`, `apps/web/app/coach/signup/page.tsx`, `apps/web/app/join/[code]/page.tsx` — render Apple button, iOS only (sub-task 2)
  - `apps/web/ios/App/App/App.entitlements` + `project.pbxproj` — Xcode capability (sub-task 3, Xcode-generated)
  - `docs/mvp-specification.md:118`, `docs/frontend-ui-spec.md:87` — correct stale "Google / Apple deferred" wording (sub-task 3)
- Data flow:

```
Apple button tap (iOS only)
 ↓
SocialLogin.login({ provider: "apple", scopes: [name, email], nonce: sha256(rawNonce) })   ← ASAuthorizationController sheet
 ↓
AppleProviderResponse.idToken (JWT)
 ↓
OAuthProvider("apple.com").credential({ idToken, rawNonce })
 ↓
signInWithCredential(Firebase Auth)
 ↓
{ idToken, user }  →  existing screen logic (GET /me routing, coach-signup, invite redeem)
```

  Firebase remains a pure JS-SDK dependency; no native Firebase plugin. Backend identity semantics are unchanged: the Go API resolves `users` by `firebase_uid` and is untouched.
- Schema changes: none.
- API changes: none. No backend files are modified.
- State transitions: none new — `signInWithApple` returns the same `{ idToken, user }` shape as `signInWithGoogle`, so `/login`, `/coach/signup`, and `/join/[code]` state machines are unchanged apart from one additional entry point.
- Frontend state/UI impact:
  - `AuthContextValue` gains `signInWithApple(): Promise<SocialSignInResult>`. Native-only: calling off-platform throws immediately (the button is not rendered on web).
  - Apple button rendered only when `Capacitor.isNativePlatform()`, at equal prominence to Google (Guideline 4.8 "equivalent option").
- Nonce / replay protection: per Firebase guidance, Apple receives `SHA-256(rawNonce)` and Firebase receives the raw nonce (`crypto.subtle` digest; `crypto.getRandomValues` for the nonce — both available in the Capacitor secure context).
- Cancellation: plugin rejection `code: "USER_CANCELLED"` → `NativeAppleCancelledError` sentinel → UI stays silent (same house pattern as `NativeGoogleCancelledError`).
- **Account collision policy (1.0, founder correction #2):**
  - No automatic Google ↔ Apple linking is implemented or assumed.
  - `auth/account-exists-with-different-credential` propagates from `signInWithCredential` untouched; the UI (sub-task 2) shows a clear message telling the user to sign in with their existing method. The existing Firebase account — and therefore the existing backend `users` row, relationships, and training history — is preserved.
  - The app never resolves backend identity by email and never merges application users; a new Apple-only Firebase UID (e.g. Hide My Email) is simply a new Firebase identity, and backend provisioning still only happens via coach-signup / invite redeem.
  - Automatic account linking is a separate future feature, out of scope for 1.0.
- Backward compatibility / data backfill: none — email/password and Google flows are untouched; no data migration.
- **Branding (founder correction #3):** the public product name is **PumpLoop**; the bundle ID intentionally remains `com.pumpslate.app` and must not change. Remaining PumpSlate user-visible branding to record for the release track — `appName: "PumpSlate"` in `capacitor.config.ts` and the iOS display name — is a **separate follow-up task**; it is deliberately not mixed into this task except where this task already edits the same config file (the `appName` line is left untouched here).

## 3. Estimate

- Size: M overall (~3–4 hours including device verification), split per AGENTS.md §7 because the naive single task touches ~10 files.
- Sub-task breakdown:
  1. **Native plumbing** — `capacitor.config.ts`, `native-apple-auth.ts` (+ test), `auth-context.tsx`. ≤5 files. Verified by `npm run lint` + node:test.
  2. **UI wiring** — `apple-sign-in-button.tsx` + the three screens. 4 files. Verified by lint + type check.
  3. **External config + device verification** — Firebase console Apple provider (verify current requirements incl. Service ID / Team ID / Key ID / private key where required; no fabricated values), Xcode capability, `npx cap sync ios`, TestFlight acceptance pass, stale-doc fixes.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Task Doc | Done | This document, authored with founder corrections #1–#3 |
| Sub-task 1: native plumbing | Done | lint clean; 5/5 new unit tests pass; 2 pre-existing calendar test failures (.tsx import under node --experimental-strip-types) are from unrelated in-flight work and were left untouched |
| Sub-task 2: UI wiring | Done | lint, tsc --noEmit, and next build all clean; Apple button renders iOS-only at equal prominence above Google on /login, /coach/signup, /join/[code]; collision + cancel copy handled in appleAuthErrorMessage |
| Sub-task 3: console/Xcode config + TestFlight pass + doc fixes | Done | Manual gate cleared: Firebase Apple provider enabled (Service ID com.pumpslate.app.signin, Team 99YPVP2249); App.entitlements (com.apple.developer.applesignin=Default) + CODE_SIGN_ENTITLEMENTS on disk; cap sync clean. Physical-device Debug smoke (2026-08-26): Apple button renders, Apple sign-in succeeds, Google sign-in works, Calendar Build & Assign / Remove / refresh all pass. Release-blocker forward-port (Alamofire App-target linking + release.xcconfig) landed via e4b4f95 on staging; xcodebuild Release for generic iOS device BUILD SUCCEEDED with store validation; built product verified: CFBundleDisplayName=PumpLoop, bundle=com.pumpslate.app, non-empty Google URL scheme, applesignin entitlement present. Archived and uploaded as build 1.0 (3); TestFlight acceptance passed (2026-08-26). |

## 5. Outcome (filled at completion)

- Final status: **Complete.** Sign in with Apple ships in TestFlight build 1.0 (3) on staging; Guideline 4.8 blocker resolved. Physical-device Debug smoke and TestFlight Release acceptance both passed on 2026-08-26.
- Deviations from plan:
  - The Firebase project has "Link accounts that use the same email" enabled, so a same-email Apple sign-in auto-links onto the existing Firebase UID (observed: Apple sign-in linked onto the existing Google account UID, then coach signup completed). This is the preferred outcome; the `auth/account-exists-with-different-credential` message path is implemented but unreachable for verified same-email collisions under this console mode.
  - Coach-signup name field gained a required indicator + red inline hint (597273f, small-task exception) after device testing showed Apple's missing displayName looked like a backend error.
  - Two pre-existing Release-build blockers surfaced during Archive prep and were forward-ported from the retired fix/ios-release-alamofire-link branch (e4b4f95): Alamofire App-target linking and release.xcconfig. Without them Release archives failed to link and shipped an empty Google URL scheme.
  - Acceptance items #2 (Hide My Email specifically) and #3 (collision message) were not exercised on device; #2's name-fallback path was exercised via the linked-account signup, and #3 is unreachable under the current console linking mode (see above).
- Follow-ups: account linking remains an explicit future feature (not 1.0); PumpLoop rebrand completed separately (042eb87); athlete-assignment-context fix (claude/athlete-assignment-context-bug) audited as NEEDS FORWARD-PORT and scheduled as its own task; account deletion remains a separate approved blocker task, running in a parallel session.

### TestFlight acceptance (sub-task 3)

1. Fresh device → `/login` → Sign in with Apple → new Firebase identity → lands on the "join a coach / create coach" state; no backend `users` row is created by login alone.
2. `/coach/signup` → Sign in with Apple with **Hide My Email on a fresh authorization** → name pre-fill empty → enter name → coach account created (proves private-relay flow works end to end).
3. **Collision:** a Firebase account that already exists with another credential (email/password or Google) → Sign in with Apple with a colliding email → app must stop with a clear "use your existing sign-in method" message; **no second Firebase UID and no duplicate backend identity is created**, and the existing account + data are intact when signing back in with the original method. (Replaces the removed test that assumed same-email auto-linking to the same UID.)
4. `/join/[code]` → Sign in with Apple → athlete created via redeem, lands on `/today`.
5. Dismiss the Apple sheet mid-flow → no error toast, screen unchanged.
6. Regression: email/password and Google sign-in still pass on the same build.
