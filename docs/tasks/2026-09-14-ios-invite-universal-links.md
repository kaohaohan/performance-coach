# Task: Open Athlete Invite Links in the iOS App

- Date opened: 2026-09-14
- Related contract sections: `docs/mvp-specification.md` Coach & Athlete Onboarding; `docs/frontend-ui-spec.md` Onboarding routes; AGENTS.md §§7–10
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: Coach "Copy link" currently shares a normal HTTPS `/join/{code}` URL. iOS has no website association or incoming-link routing, so an Athlete who has PumpLoop installed is sent to Safari instead of the in-app join flow.
- Options considered:
  1. Apple Universal Links using the existing production HTTPS invite URL.
  2. A custom URL scheme such as `pumploop://join/{code}`.
  3. Keep the website-only flow and add an "Open App" interstitial.
- Trade-offs (per option):
  - Universal Links preserve one shareable URL, open the installed app directly, and retain the existing Web flow when the app is absent. They require an AASA endpoint, an iOS entitlement, Apple signing configuration, and explicit cold/warm launch routing.
  - A custom scheme is simpler inside the binary but has no reliable browser fallback, exposes an unverified scheme that another app can claim, and would require a second invite URL or an interstitial.
  - A Web interstitial does not meet the requested direct-to-app experience and adds another user step.
- Selected option and why: Universal Links on `https://dontworkout.vercel.app/join/{code}`. It meets the requested installed-app behavior while preserving the already implemented Web onboarding flow for users without the app.
- Risks & unknowns:
  - Apple fetches AASA through its CDN; propagation can take up to 24 hours and devices may need an app reinstall/update before a new association is observed.
  - Third-party in-app browsers decide whether to honor Universal Links; Messages, Mail, and Safari external navigation are the baseline, with LINE covered by best-effort physical-device verification.
  - Debug/staging and production use different databases. Only the production hostname is associated; staging/local invite links must remain Web-only to prevent cross-environment redemption.
  - The worktree already contains unrelated Xcode version/shared-scheme changes. They must be preserved and excluded from task-specific commits.
- Dependencies / blockers:
  - Apple Developer App ID `com.pumpslate.app` must have Associated Domains enabled and the signing profile must contain the entitlement.
  - The production Vercel deployment must publicly serve AASA over HTTPS without authentication or redirects.

## 2. Technical Design

- Affected files/components:
  - Web association endpoint under the Next.js `/.well-known/apple-app-site-association` route.
  - `apps/web/ios/App/App/App.entitlements` for `applinks:dontworkout.vercel.app`.
  - `@capacitor/app@8.1.1` dependency and Capacitor-generated iOS Swift Package registration. The plugin uses its own release cadence; npm marks 8.1.1 as the current stable release and its peer contract accepts `@capacitor/core >=8.0.0`, including this repository's 8.5.0 core.
  - A root client-side Universal Link handler mounted by `apps/web/app/layout.tsx`.
  - Product/UI documentation and focused unit tests.
- Data flow:
  1. Coach shares the existing production URL `https://dontworkout.vercel.app/join/{code}`.
  2. iOS verifies the production domain's AASA file against the app's Associated Domains entitlement.
  3. If PumpLoop is installed, iOS launches/resumes it and delivers the URL; otherwise the same URL loads the existing Next.js join page.
  4. The Capacitor handler reads `App.getLaunchUrl()` for a cold start and listens to `appUrlOpen` for later opens.
  5. A pure parser accepts only HTTPS, the exact production hostname, and `/join/{code}` where the code is a valid 10-character invite-code alphabet value. It discards the query and fragment and returns the internal `/join/{code}` path.
  6. The handler uses replace navigation and suppresses duplicate delivery of the same URL. The existing page performs preview, authentication, redemption, and navigation to Today.
- API changes: No Go API changes. Add one public website association endpoint, `GET /.well-known/apple-app-site-association`, returning `200 application/json` without redirects. Its `applinks.details` identifies `99YPVP2249.com.pumpslate.app` and matches only `/join/*`.
- State transitions: App closed/background/foreground + valid link all converge on the existing join route. Invalid or unsupported incoming URLs are ignored. Existing join states and backend redemption semantics do not change.
- Frontend state/UI impact: No new screen. Installed iOS users enter the existing invite preview inside PumpLoop; users without the app continue through the same Web route.
- Backward compatibility / data backfill: Existing invite links and codes keep their shape and remain valid. Older app builds without the entitlement continue to open the Web page. No data migration or backfill is required.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Web association endpoint plus product/UI contract updates.
  2. iOS Associated Domains entitlement and signing verification.
  3. Install/sync stable `@capacitor/app@8.1.1`.
  4. Add the validated cold/warm Universal Link router and unit tests.
  5. Build, deploy, and perform physical-device/TestFlight verification.

Each implementation sub-task runs in a separate `gpt-5.6-luna` session with `low` reasoning effort. If a sub-task exposes an architectural unknown, stop it and return to a strongest-model/highest-effort planning session before changing this design.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 inspection and design | Done | Existing Web join flow is reusable; iOS lacks AASA, Associated Domains, and URL routing. |
| Task Doc approval | Done | User approved the proposed plan and Luna/low implementation-session split. |
| Web association + contract docs | Done | Added the production AASA endpoint and documented installed/uninstalled behavior. |
| iOS capability + signing | Done | Added the production Associated Domains entitlement. A signed Release archive verified both Associated Domains and Sign in with Apple entitlements. |
| Capacitor App dependency | Done | Installed exact `@capacitor/app@8.1.1`; `npx cap sync ios` registered the plugin in the generated Swift package. Existing Xcode project diff was preserved and excluded. |
| Incoming-link router + tests | Done | Added strict production invite parsing, native cold/warm delivery, duplicate suppression, replace navigation, and focused parser tests. |
| Production deployment | Done | Deployed the task-only hotfix to `dontworkout.vercel.app`. The live AASA endpoint returns `200 application/json` without redirects and matches only `/join/*`; invalid invite paths retain the Web fallback. |
| TestFlight upload | Done | Archived and uploaded iOS version `1.0.1` build `5`; Xcode Organizer reports the archive as uploaded to Apple. |
| Physical-device verification | In Progress | Install TestFlight build `1.0.1 (5)` after Apple finishes processing, then verify Safari, Messages, Mail, and LINE behavior on an iPhone. |

## 5. Outcome (filled at completion)

- Final status: Implementation, production deployment, and TestFlight upload complete; physical-device acceptance is pending.
- Deviations from plan: The initially specified `@capacitor/app@8.5.0` does not exist. After the low-effort implementation session stopped without substituting a version, high-effort planning selected npm's stable 8.1.1, whose peer contract explicitly supports the repository's Capacitor core 8.5.0. To avoid releasing unrelated staging work, production was deployed from a task-only hotfix branch instead of the staging worktree. The isolated release checkout alone incremented the iOS version to `1.0.1 (5)`.
- Verification notes: `npm test -- lib/invite-universal-link.test.ts` passed (2/2); `npm test` passed (160/160); `npm run build -- --webpack` passed. The default Turbopack build could not bind its worker port in the sandbox. `npm run lint` remains blocked by pre-existing generated/vendor files under `ios/DerivedData` (108 errors, 2,304 problems); no invite-source lint errors were reported. `npx cap sync ios` registered `@capacitor/app@8.1.1` and `@capgo/capacitor-social-login@8.4.5`; `plutil -lint` passed for `App.entitlements` and `Info.plist`; signed Release archive entitlements include `applinks:dontworkout.vercel.app` and Sign in with Apple. Production deployment `dpl_9MmyidNPKszj4JYH1gShjyyUcbbQ` serves the live AASA endpoint from `dontworkout.vercel.app` with the expected app ID and `/join/*` scope. Xcode Organizer reports TestFlight archive `1.0.1 (5)` as uploaded to Apple.
- Follow-ups: After Apple finishes processing TestFlight build `1.0.1 (5)`, install it on an iPhone and verify Safari, Messages, Mail, and LINE link behavior. Android App Links remain deferred until an Android target exists.
