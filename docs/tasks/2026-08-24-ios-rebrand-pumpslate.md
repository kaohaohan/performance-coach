# Task: Rebrand iOS shell to PumpSlate (cosmetic scope only)

- Date opened: 2026-08-24
- Related contract sections: AGENTS.md §11 Small Task Exception (excluded — touches the Google Sign-In config chain), §12 Working Tree Safety, §15 Cloud Safety
- Size (S/M/L/XL, per AGENTS.md §7): S

## 1. Feasibility Analysis

- Problem / trigger: the product is being renamed to "PumpSlate" (checked clean of App Store/Play Store/domain collisions this session). The iOS Capacitor shell currently carries the old "Performance Coach" name and `com.performancecoach.app` bundle ID everywhere.
- Options considered:
  1. Rename everything, including the Firebase/GCP project `dontworkout` (whose `.firebaseapp.com` domain briefly appears in the Google OAuth chooser).
  2. Rename only the app-facing identity (display name, icon, Bundle ID, App Store listing name); leave the Firebase/GCP project id untouched.
- Trade-offs: Option 1 requires a brand-new Firebase project (project IDs are immutable after creation) — full user-auth migration, and rebuilding Cloud Run/Secret Manager/IAM/Neon wiring under a new GCP project. That's production infrastructure risk (AGENTS.md §15) wildly disproportionate to a cosmetic rename; the `dontworkout.firebaseapp.com` string is only ever visible for one instant on Google's own account-chooser page, never inside the app itself.
- Selected option and why: **Option 2**, per explicit user decision after being shown the trade-off.
- Risks & unknowns:
  - Changing the Bundle ID breaks the existing Google Sign-In wiring (client ID + reversed URL scheme are registered per-bundle-ID in Firebase). A **new iOS app must be registered in the `dontworkout` Firebase project** under the new Bundle ID — this is an operator step the agent cannot perform (same shape as `docs/tasks/2026-08-23-ios-google-signin-webview.md`'s Phase 6).
  - The old `com.performancecoach.app` Firebase iOS app registration is left in place, unused — harmless, but a follow-up could clean it up once the rename is confirmed final.
  - App icon/launch screen artwork is not something this agent can produce; that half of the rebrand is blocked on the user supplying image assets, tracked separately in Progress Tracker.
- Dependencies / blockers: user to register a new Firebase iOS app for the new Bundle ID (Firebase Console → Add app → iOS) and provide its `CLIENT_ID`/`REVERSED_CLIENT_ID`, same flow as the original Google Sign-In setup.

## 2. Technical Design

- Bundle ID: `com.performancecoach.app` → `com.pumpslate.app` (keeps the existing `com.<product>.app` convention).
- Affected files (source of truth only — generated files are refreshed via `cap sync`, never hand-edited):
  - `apps/web/capacitor.config.ts` — `appId`, `appName`
  - `apps/web/capacitor-shell/index.html` — placeholder title/text (cosmetic, bundled fallback page)
  - `apps/web/ios/App/App.xcodeproj/project.pbxproj` — `PRODUCT_BUNDLE_IDENTIFIER` (Debug + Release configs)
  - `apps/web/ios/App/App/Info.plist` — `CFBundleDisplayName`
  - `apps/web/ios/debug.xcconfig` — `GOOGLE_REVERSED_CLIENT_ID` (new value, once the user has it)
  - Vercel env `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` (staging) — new value
  - Regenerate `apps/web/ios/App/App/capacitor.config.json` and `.../public/index.html` via `npx cap sync ios` — never hand-edited directly.
- Explicitly not touched: Firebase/GCP project id `dontworkout`, the web app's own display name/branding (out of scope — this task is the iOS shell only), App Store Connect listing (needs a paid Developer Program account, separate follow-up).
- Backward compatibility: fully reversible (revert the Bundle ID/name strings, re-run `cap sync`); the old Firebase iOS app registration is untouched so nothing is destructively changed.

## 3. Estimate

- Size: S

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Rename config source files | Not Started | `capacitor.config.ts`, `capacitor-shell/index.html`, `project.pbxproj`, `Info.plist` |
| `cap sync ios` to regenerate derived files | Not Started | |
| Verify: lint / build / Xcode Simulator build | Not Started | |
| User: register new Firebase iOS app for `com.pumpslate.app` | Not Started | Blocks Google Sign-In working under the new Bundle ID |
| Wire new Google client ID (`debug.xcconfig` + Vercel env) | Not Started | Depends on the above |
| App icon / launch screen artwork | Not Started | Blocked — needs image assets from the user; this agent cannot design them |

## 5. Outcome (filled at completion)

- Final status: In progress.
- Deviations from plan: None yet.
- Follow-ups: App Store Connect listing under "PumpSlate" needs a paid Apple Developer Program account (separate from this task); old `com.performancecoach.app` Firebase app registration can be deleted once the rename is confirmed final.
