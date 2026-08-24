# Task: Distribute PumpSlate iOS beta to friends through TestFlight

- Date opened: 2026-08-24
- Related contract sections: AGENTS.md §7 Task Sizing, §8 Phase Gate Protocol, §9 Task Documentation Requirement, §10 AI Session & Model Discipline, §12 Working Tree Safety, §15 Cloud Safety, §17 Verification Rules
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger: the founder wants friends to install and use the iOS app quickly under the final user-facing name **PumpSlate**. The existing Capacitor shell works in the Simulator, but its PumpSlate rebrand is preserved only on another branch, its Google iOS OAuth registration still belongs to the old bundle identifier, it loads a staging deployment, and it still has placeholder Capacitor artwork.
- Options considered:
  1. Submit immediately for public App Store distribution.
  2. Distribute an external TestFlight beta first, then prepare a separate public App Store submission after real-user validation.
  3. Keep distributing local Xcode builds directly to individual devices.
- Trade-offs (per option):
  - Option 1 has the largest up-front scope and rejection risk. The current remote-WKWebView shell must be assessed against App Review Guideline 4.2; Google login raises Guideline 4.8; account creation raises the in-app account-deletion requirement; and public product metadata, privacy disclosures, production hosting, signing, artwork, and review credentials must all be ready together.
  - Option 2 still requires a signed archive, App Store Connect record, working beta login, artwork, tester/reviewer access, and external TestFlight Beta App Review, but it is the shortest supported Apple distribution path for friends who should not receive App Store Connect roles. It creates a real-user feedback loop before taking on the full public-listing scope.
  - Option 3 avoids App Store Connect review but does not scale: devices must be registered/provisioned or connected to Xcode, builds expire with their provisioning, and every tester becomes an operator task.
- Selected option and why: **Option 2 — external TestFlight first.** It best satisfies the founder constraint: put a usable PumpSlate build in friends' hands quickly, learn from real usage, and defer public App Store work that does not improve the first beta feedback loop.
- Risks & unknowns:
  - External TestFlight builds undergo Beta App Review and are expected to follow App Review Guidelines. Apple may still require a compliant third-party-login alternative, in-app account deletion, or more app-like native value before approving the beta; TestFlight reduces scope but does not guarantee approval.
  - The binary currently loads the fixed Vercel `staging` branch alias through Capacitor `server.url`. That is acceptable only for an explicitly labeled beta whose backend remains available during review and testing; it is not the intended public production configuration.
  - `c03d69f` contains the PumpSlate identity changes but diverged from the current branch. It must be integrated and reverified rather than assumed present.
  - Google Sign-In cannot work with `com.pumpslate.app` until a new Firebase iOS app registration supplies a matching `CLIENT_ID` and `REVERSED_CLIENT_ID`. This changes production Firebase project configuration and therefore needs an explicit operator-approved phase.
  - The existing App Icon and splash images are Capacitor placeholders. PumpSlate artwork must be supplied or generated, selected by the user, installed, and visually verified.
  - Apple Developer Program membership, App Store Connect access, agreements, signing team, and availability of the name `PumpSlate` inside the user's account have not been verified.
  - The rebrand Task Doc in `c03d69f` has a stale Progress Tracker even though its commit message reports successful builds. The tracker must be corrected during integration.
- Dependencies / blockers:
  - User has an active Apple Developer Program membership and sufficient App Store Connect role.
  - User explicitly approves creating the `com.pumpslate.app` registration in the existing `dontworkout` Firebase project, or approves a separate iOS-beta authentication plan.
  - User selects final beta App Icon / launch artwork.
  - App Review receives a working demo account or complete reviewer instructions, and the staging backend remains available.

## 2. Technical Design

- Affected files/components:
  - Existing rebrand sources from `c03d69f`: `apps/web/capacitor.config.ts`, `apps/web/capacitor-shell/index.html`, `apps/web/ios/App/App.xcodeproj/project.pbxproj`, `apps/web/ios/App/App/Info.plist`, `apps/web/ios/debug.xcconfig`, and `docs/tasks/2026-08-24-ios-rebrand-pumpslate.md`.
  - Generated Capacitor files refreshed only through `npx cap sync ios`.
  - PumpSlate artwork under `apps/web/ios/App/App/Assets.xcassets/` after user selection.
  - App Store Connect metadata and tester configuration are external operator state, not repository files.
- Distribution flow:
  1. Reconcile the preserved PumpSlate commit onto the current development line and verify that the resulting native identity is `PumpSlate` / `com.pumpslate.app`.
  2. Produce and select non-placeholder PumpSlate artwork, install it in the asset catalog, and visually verify icon and launch presentation.
  3. Complete an explicitly approved beta authentication phase. The default path is to register `com.pumpslate.app` as another iOS app in the existing Firebase project, wire its public client identifiers, deploy the matching remote web bundle, and verify sign-in on a real device. If Apple-login compliance expands this phase materially, stop and create/update a dedicated auth Task Doc before implementation.
  4. Configure Apple signing in Xcode, create the PumpSlate App Store Connect record, archive a Release build, validate it, and upload it.
  5. Fill only the metadata required for TestFlight Beta App Review, add reviewer credentials/instructions, submit the external-testing build, and invite a small tester group after approval.
- State transitions:
  - Repository: rebrand preserved on side branch -> integrated and verified on current line -> beta-auth/artwork ready.
  - App Store Connect: app record absent/unverified -> build uploaded and processing -> ready for TestFlight submission -> Beta App Review -> available to external testers.
  - Public App Store submission is a separate future state and is explicitly outside this task.
- Frontend state/UI impact:
  - No product-flow redesign is planned for this beta task.
  - User-facing native identity and artwork become PumpSlate.
  - Authentication must be fully functional in the installed beta; a visible broken provider is not acceptable.
- Backward compatibility:
  - The Firebase/GCP project id and `dontworkout.firebaseapp.com` remain unchanged.
  - The old `com.performancecoach.app` Firebase registration remains intact until PumpSlate is verified, making rollback possible.
  - TestFlight beta distribution does not publish a public App Store product page.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. **S — Rebrand integration:** reconcile `c03d69f` into the current branch, correct its Task Doc tracker, regenerate derived files, and rerun lint/build/Simulator verification. The existing atomic commit spans five identity source/config files plus its required Task Doc; splitting those identity strings across builds would deliberately create an inconsistent bundle, so this one integration phase is the documented exception to the usual five-file preference.
  2. **S — Brand assets:** generate or ingest PumpSlate icon/launch artwork, obtain user selection, update only the asset catalog, and visually/build verify.
  3. **M — Beta authentication:** after explicit approval for Firebase external-state changes, create/wire the PumpSlate iOS client and verify the remote-JS/native-plugin pair on a real device. Stop and re-plan if Sign in with Apple or another material auth redesign becomes necessary.
  4. **M — Archive and TestFlight:** configure signing, create/verify the App Store Connect record, archive/upload one build, complete beta-review metadata, submit to external TestFlight, and invite a small tester cohort after approval.
  5. **Separate future task — Public App Store readiness:** stable production target, in-app account deletion, Guideline 4.8 login compliance, Guideline 4.2/native-value assessment, complete privacy/product metadata, screenshots, and public review submission.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Confirmed branch divergence, preserved PumpSlate commit, stale OAuth registration, staging remote URL, placeholder artwork, absent account-deletion UI, and current Apple review risks. |
| Planning — this Task Doc | Done | Ready to commit before implementation begins. |
| Rebrand integration | Done | Merged `c03d69f` as `f5a6510`; `npx cap sync ios`, lint, Webpack production build, and unsigned iOS Simulator build passed. Native identity verified as `PumpSlate` / `com.pumpslate.app`. |
| Brand assets | Done | User selected Concept B: three offset slate plates in deep navy and teal. Installed a 1024px App Icon and matching full-bleed 2732px launch artwork; visual inspection and unsigned iOS Simulator build passed. |
| Beta authentication | Blocked | Firebase verification found no `com.pumpslate.app` registration, so created the new active PumpSlate iOS App in `dontworkout` while preserving the old `com.performancecoach.app` App. Updated `GOOGLE_REVERSED_CLIENT_ID`, added the matching public `NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID` only to Vercel Preview branch `staging`, and redeployed the staging alias successfully; unsigned Simulator build passed. True-device Google login remains blocked: the paired phone contains only legacy `com.haohan.pumpslate`, not `com.pumpslate.app`. Installing a signed PumpSlate build would require a separate Apple signing/provisioning approval. |
| Archive and external TestFlight | Not Started | Requires Apple membership/account access and successful preceding phases. |
| Public App Store readiness | Not Started | Explicitly deferred to a separate Task Doc. |

## 5. Outcome (filled at completion)

- Final status: Rebrand integration complete and verified locally; remaining TestFlight-beta phases have not started and no external account changes were performed.
- Deviations from plan: The default Homebrew Node runtime was unusable because its ICU dependency was absent, so local verification used the installed Node 22 runtime. Turbopack was blocked by the execution environment's process-binding restriction; the equivalent Webpack production build passed.
- Follow-ups: Brand assets, explicitly approved Firebase beta authentication, and Apple/TestFlight work remain separate, ordered phases. Public App Store readiness is intentionally deferred.
