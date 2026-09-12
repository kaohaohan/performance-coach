# Task: prevent an iOS build from using the wrong environment

- Date opened: 2026-09-12
- Related contract sections: AGENTS.md §8 Phase Gate, §9 Task Documentation, §12 Working Tree Safety, §13 Environment Safety, §15 Cloud Safety, §17 Verification Rules
- Size (S/M/L/XL, per AGENTS.md §7): M

## 1. Feasibility Analysis

- Problem / trigger: The Capacitor iOS shell loads a URL from the generated, untracked `ios/App/App/capacitor.config.json`. A bare `npx cap sync ios` currently produces a staging-targeted file, and Xcode has no rule that rejects that file for a Release build. Debug and Release also share the public display name and bundle identifier, so a developer-installed build can be mistaken for the App Store app.
- Options considered:
  1. Depend on the release checklist to require `APP_TARGET=production`.
  2. Make production the default for every Capacitor sync.
  3. Enforce the target at Xcode build time, label Debug visibly, and update the release checklist.
  4. Give staging a separate bundle identifier and separate Apple/Firebase OAuth registrations.
- Trade-offs (per option):
  - Option 1 remains vulnerable to a missed manual step.
  - Option 2 protects Archive but silently sends ordinary development traffic to real users and production data.
  - Option 3 blocks an invalid Release or Debug build at the native boundary without changing cloud identities or daily staging behavior.
  - Option 4 is the final isolation posture, but it requires Apple App ID, provisioning, Firebase iOS app, Google OAuth, and Sign in with Apple configuration changes; doing it without a separate approved infrastructure phase could break native sign-in.
- Selected option and why: Option 3 is the emergency safety gate. It removes the silent bad-build path now while preserving the current explicitly-selected development targets. Option 4 remains a follow-up.
- Risks & unknowns: The Debug build retains the public bundle identifier in this phase, so a developer install can still replace the public binary; the DEV display name makes that state visible but is not full identity isolation. The follow-up must solve that with separate native identity registrations.
- Dependencies / blockers: None for this phase. It does not change Firebase, Apple Developer, Vercel, Cloud Run, or Neon.

## 2. Technical Design

- Affected files/components:
  - `apps/web/ios/verify-capacitor-target.sh` validates the generated URL for the active Xcode configuration.
  - `apps/web/ios/App/App.xcodeproj/project.pbxproj` runs that validator before resources are copied and supplies the per-configuration display-name setting.
  - `apps/web/ios/App/App/Info.plist` resolves its display name from the setting.
  - `docs/ios-release-runbook.md` requires an explicit production sync and an independent validator invocation before Archive.
- Data flow:

  ```text
  APP_TARGET=production npx cap sync ios
      -> capacitor.config.json (production URL)
      -> Xcode Release build phase validates exact URL
      -> Archive may proceed

  staging/local generated URL
      -> Xcode Release build phase fails before packaging
  ```

- Frontend state/UI impact: Debug builds show `PumpLoop DEV` on the device. Release continues to show `PumpLoop`.
- Backward compatibility / data backfill: No API, schema, data, or cloud-state change. Existing staging/local Debug workflows continue; Debug using production and Release using staging/local fail intentionally.

## 3. Estimate

- Size: M

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Add target validator and wire it into Xcode | Done | First native target phase, before Sources/Frameworks/Resources. |
| Distinguish Debug display name | Done | Debug = `PumpLoop DEV`; Release = `PumpLoop`. |
| Update release runbook | Done | Explicit production sync and standalone verification required. |
| Verify negative and positive target cases | Done | Direct validator covered all four configuration/URL combinations; native Release build rejects the active staging URL. |
| Review diff and record outcome | Done | No unrelated tracked file was modified. |

## 5. Outcome (filled at completion)

- Final status: Complete. Release builds now fail unless the generated Capacitor URL is exactly production; Debug builds fail when given that production URL and are named `PumpLoop DEV`.
- Deviations from plan: The Xcode negative build was initially blocked by sandboxed Swift cache paths; a subsequent local-cache-enabled verification reached the target phase and failed exactly as intended. The positive production path was verified directly through the same validator using a temporary config, without rewriting the checkout's active staging config.
- Follow-ups: Provision a separate staging bundle identifier and matching Apple/Firebase/OAuth registrations in a separately approved infrastructure task.
