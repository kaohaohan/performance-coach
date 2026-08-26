# PumpLoop iOS Release Runbook

Canonical operational checklist for producing a TestFlight build. Every item
below was verified during the 2026-08-26 release session (TestFlight build
1.0 (3)). If reality drifts from this document, fix the document in the same
commit as the fix.

## Source of truth

- Release candidates originate from **staging** — never from a feature branch.
- Record the exact staging SHA before Archive.
- Public app name: **PumpLoop**
- Bundle ID: **com.pumpslate.app** (intentionally kept; do not change)
- Apple Developer Team ID: **99YPVP2249**
- Do **not** infer native Release readiness from an old successful TestFlight
  build (see Critical warning).

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

## App Store 1.0 gate

Distinguish two readiness levels:

- **TestFlight-ready** — everything above passes; the build installs and the
  core loop works on device.
- **App-Review-ready** — additionally, all App Review blockers are closed.

The current blocker list is deliberately not hardcoded here. Check the active
Task Docs under `docs/tasks/` and the current staging state for what remains
before submission.
