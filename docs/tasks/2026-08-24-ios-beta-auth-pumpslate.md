# Task: iOS Beta authentication for com.pumpslate.app

- Date opened: 2026-08-24
- Related contract sections: AGENTS.md §8 Phase Gate Protocol, §9 Task Documentation Requirement, §11 Small Task Exception (excluded — this touches authentication), §12 Working Tree Safety, §13 Environment Safety, §15 Cloud Safety, §17 Verification Rules
- Size (S/M/L/XL, per AGENTS.md §7): **M** (see §3 — mostly config/registration work gated by external Apple Developer access, not code volume)

## 1. Feasibility Analysis

- Problem / trigger:
  - A prior session reported a completed "Beta authentication" implementation for an iOS app, citing commits `1aa5d59` and `d7c3277`, targeting bundle ID `com.pumpslate.app`.
  - A read-only Phase 0 audit (this session, 2026-08-24) could not verify any of it:
    - `1aa5d59` and `d7c3277` do not exist as objects in `kaohaohan/performance-coach`, checked across all 25 fetched branches (`main`, `staging`, and 23 feature/agent branches).
    - No string match for `pumpslate` or `com.pumpslate` anywhere in the repo, on any branch.
    - No commit message on any branch mentions "beta" (case-insensitive `git log --all -i --grep=beta`).
    - `list_repos` (GitHub, all 43 repos on this account) has no repo named or containing "pumpslate".
    - `list_sessions` (64 prior Claude Code Remote sessions on this account) has none titled with "pumpslate" or "beta auth"; the only iOS-related prior sessions correspond to the two task docs below, neither of which mentions pumpslate or a beta-authentication feature.
    - `list_environments` shows only one environment (`Default`) — no separate environment for a pumpslate project exists.
  - Per user instruction, the prior completion report is **not accepted as landed work**. This task starts from scratch.
  - The only actual iOS project found anywhere in reach is on `origin/claude/performance-coach-ios-capacitor-9xpav3` (HEAD at inspection time: `3d973689dfaac51ab2611154801989465db081f`) — a Capacitor 8.5.0 shell (`apps/web/ios/`) with:
    - `PRODUCT_BUNDLE_IDENTIFIER = com.performancecoach.app` (both Debug and Release, `project.pbxproj`)
    - `MARKETING_VERSION = 1.0`, `CURRENT_PROJECT_VERSION = 1`
    - No `DEVELOPMENT_TEAM`, no `PROVISIONING_PROFILE` set — Automatic signing only, never configured for distribution
    - A working native Google Sign-In flow (`docs/tasks/2026-08-23-ios-google-signin-webview.md`, status: Done, verified end-to-end in Simulator + web) built with `@capgo/capacitor-social-login`, wired to the `dontworkout` Firebase project's iOS app registration
    - A WKWebView pointed at the `staging` Vercel deployment (`docs/tasks/2026-08-23-ios-capacitor-staging-webview.md`, status: Done)
  - **This is a hard mismatch**: the only known iOS app identity in this repo is `com.performancecoach.app`, not `com.pumpslate.app`. The relationship between the two is unknown — it was not recorded, or was recorded only in the unverifiable prior session.
- Options considered (for resolving the identity question — not yet selected):
  1. **`com.pumpslate.app` is a rename/rebrand of the existing Capacitor app.** Reuse the `claude/performance-coach-ios-capacitor-9xpav3` shell and its native Google Sign-In work as the baseline; change `PRODUCT_BUNDLE_IDENTIFIER`, display name, and re-register a matching Firebase iOS app / Apple Developer identifier under the new bundle ID.
  2. **`com.pumpslate.app` is a separate, new app**, unrelated to `com.performancecoach.app`. Would need its own Capacitor/Xcode project (or a second target in the existing one), its own Firebase app registration, and its own Apple Developer / App Store Connect record — none of which currently exist anywhere in reach.
  3. **`com.pumpslate.app` is a planned future rename not yet reflected anywhere**, and "Beta authentication" is scoped narrowly (e.g. TestFlight external-tester gating, not a new sign-in mechanism), independent of which bundle ID ultimately ships.
- Trade-offs: Option 1 reuses verified, working code (Capacitor shell + native Google Sign-In, both confirmed end-to-end in the prior session's docs) at the cost of needing new external registrations (Firebase iOS app, Apple Developer App ID) under the new bundle ID. Option 2 avoids touching the existing app but duplicates work already done and solved once (the prior Google Sign-In task doc records real setup friction — SPM cache corruption, a missing Firebase Authorized domain — that would very likely recur on a from-scratch project) for no identified benefit. Option 3 is a subset of "not yet decided" and doesn't actually resolve anything.
- Selected option and why: **Option 1 (rename in place), per explicit user confirmation (2026-08-24).** `com.pumpslate.app` is the rebrand of the existing app; there is exactly one app, not two. All further design below builds on top of the `claude/performance-coach-ios-capacitor-9xpav3` baseline rather than a fresh project.
  - **"Beta authentication" scope, per explicit user confirmation:** verify that the existing native Google Sign-In flow actually works under a **Release build configuration** (the configuration TestFlight/App Store distribution uses), not just the Debug/Simulator configuration it has been verified under so far. This is not a new authentication mechanism — it is closing a verification gap in what already exists. A beta-tester allowlist/invite gate is explicitly **not** in scope unless a later session decides otherwise.
- Risks & unknowns:
  - **Concrete gap found while inspecting `project.pbxproj` on the baseline branch**: both **Release** `XCBuildConfiguration` entries (project-level `504EC3151FED79650016851F` and target-level `504EC3181FED79650016851F`) have **no `baseConfigurationReference` at all** — only the two **Debug** configs (project-level `504EC3141FED79650016851F` and target-level `504EC3171FED79650016851F`) reference `debug.xcconfig`. Concretely, in a Release build today:
    - `GOOGLE_REVERSED_CLIENT_ID` is undefined → `Info.plist`'s `CFBundleURLTypes` URL scheme resolves empty → Google cannot hand control back to the app after sign-in.
    - `CAPACITOR_DEBUG` is undefined → different from the intended `false`/unset-for-release value.
    - This means **native Google Sign-In is very likely already broken in Release builds today**, independent of the bundle ID rename — this is the most concrete, verifiable candidate for what "Beta authentication" needs to fix, discovered by static inspection, not assumed.
  - Firebase does not allow changing an existing iOS app's bundle ID — the current `dontworkout` Firebase project's iOS app entry for `com.performancecoach.app` cannot be renamed in place. A **new** Firebase iOS app entry (same `dontworkout` project, new bundle ID `com.pumpslate.app`) must be registered, producing a new `GoogleService-Info.plist` with a new `CLIENT_ID`/`REVERSED_CLIENT_ID` pair — distinct from, and to eventually replace, the current one.
  - Apple App IDs are also bundle-ID-specific and cannot be renamed — a new App ID `com.pumpslate.app` must be registered in the Apple Developer account before Release/distribution signing can work. **This session still has no Apple Developer / App Store Connect access** (user: will be provided after manual confirmation) — this is a hard blocker for any step that needs it, but does not block writing this design.
  - No evidence anywhere in reach that an App Store Connect App record exists yet under either bundle ID — treat this as a from-scratch App Store Connect setup, not a migration of an existing listing, until told otherwise.
  - `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` (Vercel env, Preview + Production) is currently set to the `com.performancecoach.app` client ID and must move to the new `com.pumpslate.app` client ID in lockstep with the native-side change — same "two halves must ship together" caveat the original Google Sign-In task doc already documented (native binary vs. deployed web JS ship on different schedules).
  - Must not mix configs: the rename should replace `com.performancecoach.app` config, not leave both live simultaneously (e.g. do not add a second Firebase app and leave the app still building under the old bundle ID "just in case").
- Dependencies / blockers:
  1. **Apple Developer Team ID / App Store Connect access** (user-provided, pending manual confirmation) — required before `DEVELOPMENT_TEAM`, a new App ID, or any Release/distribution signing can actually be configured. Tracked separately; not required to finish this Task Doc, but blocks Phase 6 (Implementation) below.
  2. Firebase Console access to register the new `com.pumpslate.app` iOS app in the `dontworkout` project and retrieve its `GoogleService-Info.plist` — needed before the native config can be updated.
  3. ~~Confirmation of the exact public-facing app name/display string~~ — **Resolved: "PumpSlate"**, per explicit user confirmation (2026-08-24). Bundle ID stays lowercase (`com.pumpslate.app`, unaffected by display-string casing).

## 2. Technical Design

- Affected files/components:
  - `apps/web/ios/App/App.xcodeproj/project.pbxproj` — change `PRODUCT_BUNDLE_IDENTIFIER` from `com.performancecoach.app` to `com.pumpslate.app` (Debug + Release target configs); once Apple Developer access exists, set `DEVELOPMENT_TEAM`; **attach a Release xcconfig to the Release `XCBuildConfiguration` that currently has none** (see Risks above) — either extend `debug.xcconfig`'s coverage or add a parallel `release.xcconfig`, decision deferred to implementation since it doesn't change the design shape.
  - `apps/web/ios/App/App/Info.plist` — `CFBundleDisplayName` changes from `Performance Coach` to `PumpSlate` (confirmed, see Dependencies #3); `CFBundleURLTypes` scheme continues to read `$(GOOGLE_REVERSED_CLIENT_ID)`, which starts resolving correctly in Release once the config gap above is fixed.
  - `apps/web/ios/debug.xcconfig` (and/or new release xcconfig) — `GOOGLE_REVERSED_CLIENT_ID` updated to the value from the new `com.pumpslate.app` Firebase iOS app's `GoogleService-Info.plist`.
  - `apps/web/.env.example` and Vercel env (`NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`, Preview + Production) — updated to the new client ID from the same `GoogleService-Info.plist`.
  - No changes anticipated to `apps/web/lib/auth-context.tsx`, `apps/web/lib/native-google-auth.ts`, or `apps/web/components/google-sign-in-button.tsx` — the sign-in code path itself is not the gap; the build configuration feeding it is.
- Data flow: unchanged from the existing native Google Sign-In flow (`SocialLogin.login` → `GoogleAuthProvider.credential` → `signInWithCredential`, per `docs/tasks/2026-08-23-ios-google-signin-webview.md`). Only the identity/config values (bundle ID, OAuth client, URL scheme) change; no new code path is introduced.
- Configuration: see Affected files above — bundle ID, Firebase app identity, and the two `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID`/`GOOGLE_REVERSED_CLIENT_ID` values must be updated together, matching the "both halves must ship" pattern already documented for this app.
- Backward compatibility: low risk — no confirmed App Store Connect listing or production iOS users exist under either bundle ID today (per Phase 0 audit), so this is a clean rename rather than a live migration. Should still be reconfirmed against actual App Store Connect state once access is available, before treating it as zero-risk.
- Verification target for "Beta authentication is done": a **Release-configuration** Xcode build (a) compiles and signs (Automatic signing, once a Team ID exists) and (b) native Google Sign-In completes successfully under that configuration — i.e. `GOOGLE_REVERSED_CLIENT_ID` actually resolves and the round-trip back into the app works. This can be checked in the iOS Simulator with the Release scheme selected; it does not require an actual TestFlight upload, consistent with TestFlight/Archive/Upload staying out of scope for this task.

## 3. Estimate

- Size: **M**
- Sub-task breakdown:
  1. Register `com.pumpslate.app` as a new iOS app in the `dontworkout` Firebase project; obtain its `GoogleService-Info.plist`. *(needs Firebase Console access)*
  2. Register `com.pumpslate.app` as a new App ID in the Apple Developer account. *(needs Apple Developer access — blocked, see §1 Dependencies #1)*
  3. Update `project.pbxproj` (`PRODUCT_BUNDLE_IDENTIFIER`, `DEVELOPMENT_TEAM` once available) and `Info.plist` (`CFBundleDisplayName` → `PumpSlate`).
  4. Fix the Release `XCBuildConfiguration` xcconfig gap; update `GOOGLE_REVERSED_CLIENT_ID` for the new Firebase app.
  5. Update `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` in Vercel (Preview + Production) and `.env.example`.
  6. Build the Release scheme in the Simulator; verify native Google Sign-In completes end-to-end under Release configuration.
  7. Update/close this Task Doc's Progress Tracker and Outcome with the verified result.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — Read-only inspection | Done | Confirmed `1aa5d59`/`d7c3277` and all `pumpslate` references are unrecoverable across this repo, this GitHub account, and this account's session/environment history. Confirmed the only real iOS project found is `com.performancecoach.app` on `origin/claude/performance-coach-ios-capacitor-9xpav3`. |
| Phase 1 — Task Doc (this doc) | Done | Written without a selected option initially, per user instruction: doc only, no code or external config changes. |
| Phase 2 — Clarify `com.pumpslate.app` vs. `com.performancecoach.app` relationship | Done | User confirmed (2026-08-24): same app, rename in place. Option 1 selected in §1. |
| Phase 3 — Define "Beta authentication" scope & acceptance criteria | Done | User confirmed (2026-08-24): verify native Google Sign-In works under a Release build configuration; no allowlist/invite gate. |
| Phase 4 — Feasibility Analysis: select an option | Done | See §1 — Option 1, with a concrete Release-config xcconfig gap identified as the likely root cause. |
| Phase 5 — Technical Design | Done | See §2 and the sub-task breakdown in §3. |
| Phase 6 — Implementation | Not Started | Requires explicit approval per Phase Gate Protocol (AGENTS.md §8). Sub-tasks 1–2 (§3) are further blocked on Firebase Console and Apple Developer access respectively. |
| TestFlight / Archive / Upload / App Store Connect work | Not Started | Explicitly out of scope for this doc per user instruction; tracked separately once Apple Developer/App Store Connect access is confirmed. |

## 5. Outcome (filled at completion)

- Final status: Task Doc complete through Feasibility Analysis and Technical Design (§1–§3), per user approval to proceed with planning. **No implementation has started** — no code changes, no external configuration changes (Apple signing, Firebase, App Store Connect) were made or attempted. Awaiting explicit approval to begin Phase 6 (Implementation).
- Deviations from plan: None — the doc was opened without a selected option, then completed once the user resolved both blocking questions in the same session.
- Follow-ups: Implementation is blocked on (a) Apple Developer/App Store Connect access, still pending manual confirmation per the user, and (b) Firebase Console access to register the new iOS app. TestFlight distribution (Archive/Upload/App Store Connect App record) remains a separate, later concern, explicitly out of scope here.
