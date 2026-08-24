# Task: Google Sign-In inside the Capacitor WKWebView shell

- Date opened: 2026-08-23
- Related contract sections: AGENTS.md §8 Phase Gate Protocol, §9 Task Documentation Requirement, §11 Small Task Exception (excluded — this touches authentication), §12 Working Tree Safety
- Size (S/M/L/XL, per AGENTS.md §7): **M, pending live verification** (may resize once the actual failure mode is confirmed)

## 1. Feasibility Analysis

- Problem / trigger:
  - Phase I2 (`docs/tasks/2026-08-23-ios-capacitor-staging-webview.md`) made the iOS shell load the real staging web app in a Capacitor WKWebView. The user tried to sign in on-device and could not: they only had a local-dev fixture credential (`coach@local.test`, invalid against the shared production Firebase project the staging deployment actually uses — see that doc's follow-up discussion), so Google Sign-In is the only realistic sign-in path to test with on this staging target right now.
  - The web app's Google flow uses `signInWithPopup` (`apps/web/lib/auth-context.tsx:168`), chosen explicitly over `signInWithRedirect` because redirect requires reloading the page and calling `getRedirectResult`, which the current architecture doesn't handle (see the comment at that call site). `docs/tasks/2026-08-20-google-signin-account-continuity.md`, which implemented this flow, only reasons about ordinary browsers (Safari/Firefox/Chrome) and Safari's Lockdown/Private-mode storage restrictions — it never considers an embedded native WebView as the host environment. `google-sign-in-button.tsx` documents that the popup must be opened synchronously from a user gesture, which a WKWebView-hosted `window.open` inside Capacitor may or may not satisfy depending on Capacitor's WebView configuration.
  - Not yet confirmed empirically: whether tapping "Continue with Google" inside the iOS Simulator's WKWebView (a) opens a working popup/child WebView at all, (b) reaches Google's OAuth consent screen, and if it does, (c) is rejected by Google's "disallowed_useragent" embedded-webview policy, which historically targets webviews whose user-agent identifies them as an embedded/non-standard browser. Apple's WKWebView is not blanket-blocked the way Android's legacy WebView is, but Capacitor's WKWebView may still present a user agent or `window.open` behavior Google's check flags — this repo has never tested it. The user attempted this once outside a live session (per chat) but no console output was captured, so the exact failure (if any) is still unknown.
  - Live verification was attempted twice this session; the user was not available to tap the button both times. Instead, the failure was **confirmed by static source inspection**, which is deterministic and needs no live tap: `node_modules/@capacitor/ios/Capacitor/Capacitor/WebViewDelegationHandler.swift:328` implements `WKUIDelegate.createWebViewWith` (the delegate method WKWebView calls for `window.open()`) as:
    ```swift
    open func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            UIApplication.shared.open(url, options: [:], completionHandler: nil)
        }
        return nil
    }
    ```
    It always returns `nil` (no popup WKWebView is ever created) and instead hands the URL to the system Safari app via `UIApplication.shared.open`. On the JS side, `window.open()` therefore resolves to `null` — the same signal a blocked popup gives — which is exactly what Firebase Auth's popup resolver checks for, and it throws `auth/popup-blocked` (the same code `google-sign-in-button.tsx:25` already maps to "Your browser blocked the sign-in window..."). Google's own account chooser does open, but in Safari, completely detached from the app's JS context, which has already failed — so even a completed Safari sign-in has no way back into the app. **This is a deterministic failure of the current architecture on iOS, not a possible one; it was confirmed without needing a live tap.**
  - A live tap is still worth doing once the user is available, to confirm the on-screen symptom matches (e.g. does Safari actually visibly open, or does it look like nothing happens) and to see the real console error text, but it is no longer a blocker for deciding an option below.
- Options considered:
  1. **Do nothing / ship as-is.** Ruled out — confirmed broken by the `createWebViewWith` behavior above, not merely unverified.
  2. **Switch iOS's Google flow to a system-browser OAuth session** (`ASWebAuthenticationSession`, via a Capacitor plugin such as `@capacitor/browser`'s in-app browser or a dedicated OAuth plugin) instead of Firebase's in-page `signInWithPopup`. Google fully supports OAuth from `ASWebAuthenticationSession` because it presents as a real browser context, not an embedded webview.
  3. **Switch to `signInWithRedirect`** everywhere (web and iOS), reworking the callback handling to call `getRedirectResult` after reload. Fixes the architectural reason `signInWithPopup` was chosen, but is a bigger, cross-platform change to a flow already shipped and working on ordinary browsers — high blast radius for a fix that's only needed on iOS.
  4. **Hide/disable the Google button on iOS only** (e.g. gate on `Capacitor.isNativePlatform()`) and require email/password (or "Create Coach Account") there for now, revisiting once a native-appropriate OAuth flow is built. Smallest change, but degrades the iOS sign-in experience and needs at least one working non-Google test account, which the user does not currently have on staging either.
- Trade-offs: recorded above per option; a final trade-off ranking needs the actual observed error (Feasibility Analysis is deliberately not picking a winner yet — see AGENTS.md §9: this section evaluates, it does not design).
- Selected option and why: **Option 2 — native Google Sign-In, then hand the resulting Google ID token to the existing Firebase JS SDK via `signInWithCredential`.** The user explicitly approved reopening the "no Google/Apple Sign-In this phase" boundary after being shown that a fix requires native OAuth handling. Option 2 is chosen over 3 (too much blast radius on a working web flow) and 4 (leaves iOS unable to sign in at all, since no staging email/password account exists either).
- Plugin selection (the part that actually constrains the design). Three candidates were checked against the installed stack (Capacitor **8.5.0**, `firebase` **11.10.0**):
  | Plugin | Capacitor peer | firebase peer | Verdict |
  | --- | --- | --- | --- |
  | `@codetrix-studio/capacitor-google-auth@3.4.0-rc.4` | `^6.0.0` | — | **Rejected.** Only an RC exists at the head, and it targets Capacitor 6, two majors behind. |
  | `@capacitor-firebase/authentication@8.4.0` | `>=8.0.0` ✓ | `^12.6.0` ✗ | **Rejected.** Would force a `firebase` 11 → 12 major upgrade across the whole web app — large blast radius on code another agent is concurrently editing (Calendar work in the main worktree). Also is literally the "native Firebase plugin" the original phase brief excluded. |
  | `@capgo/capacitor-social-login@8.4.5` | `>=8.0.0` ✓ | none ✓ | **Selected.** Capacitor-8-aligned, actively maintained, and has no `firebase` peer at all, so the app keeps `firebase` 11.10.0 untouched. It is a Google/social OAuth plugin, not a native Firebase SDK plugin, so it also honours the original "no native Firebase plugin" constraint. |
- Risks & unknowns:
  - Any code change here touches shared auth code (`auth-context.tsx`) used by web `/login`, `/join/[code]`, and `/coach/signup` — the platform-gated change must not regress the existing, working web flow. Excluded from the Small Task Exception (§11: no authentication/authorization changes) regardless of diff size.
  - The plugin surfaces its own error shapes, not Firebase `auth/*` codes. User-cancellation in particular must keep mapping to "no error shown" (today's `auth/popup-closed-by-user` → `null` behaviour in `googleAuthErrorMessage`), or cancelling the Google sheet will render a spurious red alert.
  - `signInWithCredential` creates/links a Firebase identity the same way the popup flow does, so the "One account per email address" Firebase setting documented in `docs/tasks/2026-08-20-google-signin-account-continuity.md` §6 remains the thing that guarantees UID continuity. No new account-linking semantics are introduced by this task.
- Dependencies / blockers:
  - **Operator step the agent cannot perform:** the `dontworkout` Firebase project currently has only a Web app registered. An **iOS app** (bundle ID `com.performancecoach.app`) must be registered there to obtain an iOS OAuth client ID. Implementation can be written and type-checked without it, but sign-in cannot succeed on device until it exists. Exact steps in §2.

## 2. Technical Design

- Affected files/components:
  - `apps/web/package.json` — add `@capgo/capacitor-social-login`.
  - `apps/web/lib/auth-context.tsx` — platform branch inside `signInWithGoogle` only.
  - `apps/web/components/google-sign-in-button.tsx` — extend `googleAuthErrorMessage` to also recognise the plugin's cancellation/error shapes.
  - `apps/web/ios/App/App/Info.plist` — add the reversed-client-ID URL scheme so Google can return to the app.
  - `apps/web/.env.example` — document the new public `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`.
  - Not touched: `apps/web/lib/firebase.ts`, the three calling pages, and the entire web sign-in path.
- Data flow (iOS only; web is unchanged):
  1. User taps the existing `GoogleSignInButton` (no UI change).
  2. `signInWithGoogle()` detects native via `Capacitor.isNativePlatform()`.
  3. It dynamically imports `@capgo/capacitor-social-login` (dynamic so the web bundle and SSR path never load native plugin code), calls `SocialLogin.initialize({ google: { iOSClientId } })` once, then `SocialLogin.login({ provider: 'google', options: { scopes: ['profile','email'], forcePrompt: true } })`. `forcePrompt` preserves today's `prompt: "select_account"` intent — always show the chooser so a shared phone cannot silently sign in as the wrong person.
  4. The plugin returns `{ result: { idToken, profile, responseType: 'online' } }` from the native Google Sign-In sheet.
  5. JS converts it with `GoogleAuthProvider.credential(idToken)` and calls `signInWithCredential(auth, credential)`.
  6. From here everything is identical to the popup path: the same `AuthProvider` state, the same `onIdTokenChanged`, and the function returns the same `GoogleSignInResult` (`{ idToken, user }`), so all three callers are unaffected.
- Configuration:
  - `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` — the iOS OAuth client ID. This is public client configuration, not a secret (OAuth client IDs for installed apps are public by design, and it is already shipped inside the app binary), consistent with how the other `NEXT_PUBLIC_FIREBASE_*` values are treated in `.env.example`. No client secret is involved and none may be added.
  - `Info.plist` gains a `CFBundleURLTypes` entry whose scheme is the reversed client ID (`com.googleusercontent.apps.<id>`).
- Operator prerequisites (cannot be done from the coding environment):
  1. **Firebase Console → Project settings → Your apps → Add app → iOS.** Bundle ID `com.performancecoach.app`. This creates the iOS OAuth client.
  2. From the generated `GoogleService-Info.plist`, take the `CLIENT_ID` value → set as `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`; its `REVERSED_CLIENT_ID` is the URL scheme for `Info.plist`.
  3. **Firebase Console → Authentication → Settings → Authorized domains** already covers the web hosts; no change needed for native.
  4. The "One account per email address" setting from `docs/tasks/2026-08-20-google-signin-account-continuity.md` §6 must already be in place — this task depends on it but does not change it.
- Backward compatibility:
  - Web behaviour is byte-for-byte unchanged (same `signInWithPopup` call on the non-native branch). The native branch is unreachable from a browser.
  - Fully reversible: removing the dependency and the native branch restores the current state.
- **Split-deployment consequence of Option B (important, and easy to get wrong):** because Phase I2 set `server.url`, the WKWebView loads *all* JS from the remote Vercel staging deployment — the bundled `webDir` is ignored at runtime. This change therefore lands in two different places that ship on different schedules:
  | Half | Where it lives | How it ships |
  | --- | --- | --- |
  | Native Google SDK, plugin registration, `Info.plist` URL scheme | the `.app` binary | rebuilding in Xcode / reinstalling the app |
  | `signInWithGoogle` native branch, `native-google-auth.ts`, error mapping | the deployed web app | pushing this branch and letting Vercel deploy the `staging` alias |
  Installing the rebuilt app alone changes nothing user-visible: the deployed staging JS still calls `signInWithPopup`. Conversely deploying the JS alone would call a plugin the installed binary lacks. **Both halves must ship before Google sign-in works on the device**, and the `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` value has to exist in Vercel's environment for the `staging` branch (not only in a local `.env`), because that is where the JS bundle is built.

## 2. Technical Design

Not started — deferred until Section 1 has a selected option.

## 3. Estimate

- Size: M (provisional; revisit once the failure mode narrows the option list)

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Confirmed `signInWithPopup` usage and the total absence of embedded-WebView handling in the existing Google Sign-In implementation/docs. |
| Phase 1 — Task Doc (this doc) | Done | Written ahead of live verification per user request, so the next session can go straight to observing. |
| Phase 2 — Confirm the failure | Done (via static analysis) | Confirmed deterministically by reading `WebViewDelegationHandler.swift`'s `createWebViewWith` — no live tap needed. An optional live tap later can confirm the on-screen symptom and exact console text, but does not block Phase 3. |
| Phase 3 — Select option | Done | User approved reopening the native-auth boundary. Option 2 selected; plugin chosen as `@capgo/capacitor-social-login` after a three-way compatibility check (see §1). |
| Phase 4 — Implement | Done | Added `@capgo/capacitor-social-login` (Google-only via the `providers` config, so the Facebook/Twitter/Apple SDKs stay out of the binary), the `signInWithGoogle` native branch, `lib/native-google-auth.ts`, the cancellation mapping, the `Info.plist` URL scheme fed by `GOOGLE_REVERSED_CLIENT_ID`, and `.env.example` docs. |
| Phase 5 — Verify (web regression + build) | Done | `npm run lint` clean; `npm run build` (incl. TypeScript) passed with all 12 routes; `npx cap sync ios` registered the plugin Google-only; **Xcode Simulator build succeeded** with the native Google SDK linked; app reinstalled and confirmed still loading the staging web app (no regression). Web sign-in code path is untouched by construction. |
| Phase 6 — Ship both halves | Blocked | Needs (a) the Firebase Console iOS app registration from §2, (b) `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` set in Vercel for `staging` plus `GOOGLE_REVERSED_CLIENT_ID` in `debug.xcconfig`, and (c) this branch deployed to the staging alias — see the split-deployment table in §2. |
| Phase 7 — On-device sign-in verification | Not Started | Only meaningful once Phase 6 completes. |

## 5. Outcome (filled at completion)

- Final status: Code complete and building on both halves; **not yet functional end-to-end** — blocked on the operator/deployment steps in Phase 6. Nothing here has been observed signing a real user in.
- Deviations from plan: None yet.
- Follow-ups: None yet.
