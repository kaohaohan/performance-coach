# PumpLoop iOS Release Runbook

Canonical operational checklist for iOS Release archives. Native Archive
steps below were verified during the 2026-08-26 release session (TestFlight
build 1.0 (3)). If reality drifts from this document, fix the document in
the same commit as the fix.

There are two workflows. Do not mix them:

- **TestFlight-from-staging** — Archive staging as it is. The Capacitor
  shell's `server.url` currently loads the Vercel staging alias
  (`https://performance-coach-git-staging-kaohaohans-projects.vercel.app`),
  which proxies to the staging API and Neon staging branch. That is the
  intended beta target. Last uploaded store build: **1.0 (3)**.
- **Public App Store 1.0** — production web, API, and database must already
  be live and smoked. Only then retarget `server.url` at production, Archive
  a new build, TestFlight-RC that binary against production, then submit.
  Archiving current staging for the public store would ship a binary that
  talks to staging.

## Source of truth

- Release candidates originate from **staging** — never from a feature branch.
- Record the exact staging SHA before Archive.
- Public app name: **PumpLoop**
- Bundle ID: **com.pumpslate.app** (intentionally kept; do not change)
- Apple Developer Team ID: **99YPVP2249**
- Do **not** infer native Release readiness from an old successful TestFlight
  build (see Critical warning).
- Do **not** infer production readiness from a successful staging TestFlight
  build. The WKWebView origin is baked in at Archive time via
  `apps/web/capacitor.config.ts` `server.url`.

## Required native Release configuration

All of these must be true on staging before Archive:

- `apps/web/ios/release.xcconfig` exists
- Both Release build configurations (project- and target-level) reference
  `release.xcconfig` via `baseConfigurationReference`
- `GOOGLE_REVERSED_CLIENT_ID` resolves to a non-empty value in Release
  (currently `com.googleusercontent.apps.33959430194-aqvfqnmdhuoig5hr8517pc0q8mbvespf`,
  the com.pumpslate.app Firebase iOS registration)
- Alamofire (5.12.0) is explicitly linked into the App target —
  `project.pbxproj` contains the `XCRemoteSwiftPackageReference`, the
  `XCSwiftPackageProductDependency`, the Frameworks-phase entry, and the
  `packageProductDependencies` entry. The plugin dependency alone is NOT
  enough: Release uses whole-module optimization and fails with
  "symbol(s) not found for architecture arm64" without the explicit link.
- `@capgo/capacitor-social-login` is present (Google + Apple native login)
- "Sign in with Apple" capability is enabled on the App target
- `apps/web/ios/App/App/App.entitlements` contains
  `com.apple.developer.applesignin = Default`, and both build configurations
  set `CODE_SIGN_ENTITLEMENTS = App/App.entitlements`
- Bundle ID remains `com.pumpslate.app`; display name remains `PumpLoop`

## Before Archive

Run from the repo root / `apps/web` unless noted:

1. `git fetch origin staging` and check out the latest staging
2. Verify a clean working tree (`git status`)
3. Record the staging SHA
4. `npm run lint`
5. `npx tsc --noEmit`
6. `npm run build`
7. `npx cap sync ios`
8. Confirm cap sync did **not** remove native wiring (re-check the
   Alamofire entries and baseConfigurationReference lines above)
9. Run a Release build for a generic iOS device:

```bash
cd apps/web/ios/App && xcodebuild -project App.xcodeproj -scheme App \
  -configuration Release -destination 'generic/platform=iOS' \
  -allowProvisioningUpdates build
```

10. Inspect the built product's Info.plist
    (`DerivedData/.../Build/Products/Release-iphoneos/App.app/Info.plist`):
    - `CFBundleDisplayName` = PumpLoop
    - `CFBundleIdentifier` = com.pumpslate.app
    - Google reversed-client URL scheme is non-empty
11. Inspect built entitlements (`codesign -d --entitlements :-`):
    - `com.apple.developer.applesignin` = Default
    - (`get-task-allow = true` is normal for a development-signed local build;
      the Archive export re-signs with distribution credentials)
12. Confirm the Release build has no Alamofire undefined-symbol errors
13. Set `CURRENT_PROJECT_VERSION` (both configurations) to a build number
    not previously uploaded to App Store Connect — it requires a unique
    build number per upload

## Archive / TestFlight

1. Quit and reopen Xcode (avoids stale project state not being written to disk)
2. Destination: **Any iOS Device (arm64)** (not a simulator, not a device)
3. Xcode → Product → Archive
4. Organizer → Distribute App → **App Store Connect** → **Upload** →
   Automatically manage signing
5. Wait for TestFlight processing (typically 5–15 minutes)
6. Verify the uploaded version/build number in App Store Connect
7. Physical-device smoke tests on the TestFlight build:
   - Sign in with Apple (button visible on /login, /coach/signup, /join/[code];
     cancel is silent; missing displayName falls back to name entry)
   - Google Sign-In (Release build — this is where an empty
     GOOGLE_REVERSED_CLIENT_ID would surface)
   - Email/password sign-in
   - Core Calendar flow (Build & Assign / Remove / refresh)
   - Any release-specific regression items

## Critical warning

A successful historical TestFlight build does **not** prove that staging
contains the native Release configuration that produced it. A build can be
archived from a feature branch whose fixes never landed on staging; the next
Archive from staging will then silently regress (observed 2026-08-26:
Release Alamofire linking and `release.xcconfig` existed only on a retired
branch and had to be forward-ported).

All native Release fixes must be committed and merged back into staging.
Do not Archive from an old feature branch.

Archiving staging **without** changing `server.url` produces a binary whose
WKWebView loads the staging Vercel alias, staging Cloud Run API, and staging
Neon database. That is correct for TestFlight-from-staging and **incorrect**
for a public App Store binary.

## TestFlight-from-staging

Use the Before Archive and Archive / TestFlight sections above. Gates:

- Native Release configuration on staging is intact.
- Staging web + staging API are the intended runtime (current `server.url`).
- Physical-device smoke of the uploaded TestFlight build passes.
- Next upload must bump `CURRENT_PROJECT_VERSION` above **3**.

Do not treat this workflow as App Store submission.

## Public App Store 1.0

Do **not** Archive a store RC from current staging. Production is a separate
runtime (`https://dontworkout.vercel.app` → Cloud Run `performance-coach-api`).
GitHub Actions deploys the API only on push to `staging`; merging `staging` →
`main` updates Vercel Production frontend only, unless Cloud Run production
is updated in a separate manual step.

Required order — do not skip or reorder:

1. Staging final verification of all App Review blockers (see Task Docs under
   `docs/tasks/`; account deletion is Guideline 5.1.1(v)).
2. Neon Launch upgrade **before** real athlete/coach data (ADR-002). **Do not
   remove or weaken this step.** It remains the default required order.

   **Approved exception for the current release (recorded 2026-08-27, see
   ADR-002's release-scoped exception note):** the founder explicitly
   deferred this upgrade past App Store submission for this release only.
   Production's `0004_account_deletion` migration and the rest of this
   promotion proceed on Neon **Free**. This is **not** a blanket waiver of
   step 2 for future releases — it is a one-time, informed exception with a
   mandatory make-good gate:

   - Launch upgrade is a **mandatory gate after App Review approval and
     before public availability / real-user rollout.** Do not open the app
     to real users while production is still on Free.
   - Until that upgrade happens, production data (including anything
     App Review's reviewer account creates) has only Free's 6-hour/1
     GB-month PITR window, not Launch's 7-day window.
   - Re-verify the Neon plan (Free vs. Launch) as part of production
     Phase 0 preflight on every subsequent release until this gate closes.

3. Production schema migrate, then production Cloud Run API from the verified
   staging digest (or a new digest built from that SHA).
4. Vercel **Production** env, not Preview/`staging` only:
   - `BACKEND_BASE_URL` = production Cloud Run HTTPS URL (no trailing slash)
   - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
   - `NEXT_PUBLIC_FIREBASE_API_KEY`
   - `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
   - `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` (iOS Google Sign-In reads this from
     the remote JS bundle; staging-only is not enough)
   - `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` must be unset
5. Promote staging frontend to Vercel Production. Smoke
   `https://dontworkout.vercel.app` (PumpLoop branding; `/backend` hits the
   production API, not staging).
6. Only after that smoke: change `apps/web/capacitor.config.ts` `server.url`
   to the production Vercel host, merge, `npx cap sync ios`, re-check native
   Release wiring. **Do not merge a production `server.url` onto staging
   until production is smoked** — every subsequent TestFlight/Debug build
   would flip to production.
7. Bump `CURRENT_PROJECT_VERSION` above any build already in App Store
   Connect (last upload is 1.0 (3)).
8. Follow Before Archive + Archive / TestFlight on that SHA.
9. TestFlight RC on a physical device: confirm the WKWebView origin is
   production, not the staging alias. Repeat Apple / Google / email, core
   loop, and App Review items.
10. App Store submission (reviewer demo account, privacy / account-deletion
    URL as Apple requires) only after that RC.

## App Store 1.0 gate

Distinguish two readiness levels:

- **TestFlight-ready** — TestFlight-from-staging above passes; the build
  installs and the core loop works on device against **staging**.
- **App-Review-ready** — Public App Store 1.0 steps 1–9 pass; the binary
  talks to **production**; all App Review blockers in active Task Docs are
  closed.
