# Task: iOS Beta authentication for com.pumpslate.app

- Date opened: 2026-08-24
- Related contract sections: AGENTS.md §8 Phase Gate Protocol, §9 Task Documentation Requirement, §11 Small Task Exception (excluded — this touches authentication), §12 Working Tree Safety, §13 Environment Safety, §15 Cloud Safety, §17 Verification Rules
- Size (S/M/L/XL, per AGENTS.md §7): **Unknown — blocked on scope clarification** (see §1)

## 1. Feasibility Analysis

This section deliberately does not select an option. The prerequisite facts needed to choose one are not available from anything this session can read, and guessing would risk mixing two different app configurations, which was explicitly ruled out.

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
- Trade-offs: cannot be meaningfully weighed without knowing which of the above is true — options 1 and 2 imply materially different technical designs (edit vs. create a project) and different Apple Developer/App Store Connect setup work.
- Selected option and why: **None selected — blocked.** Choosing here would be guessing at a product decision (is this the same app under a new name, or a new app?) that only the user can make, and the user has explicitly said not to mix the two bundle ID configurations.
- Risks & unknowns:
  - "Beta authentication" itself is undefined in every doc this session can read. Candidate meanings, none confirmed:
    - Sign-in flow specifically for a TestFlight beta build (e.g. a build-time flag, a beta-only login screen, or environment-gated auth).
    - An invite/allowlist gate restricting who can authenticate into a beta release, layered on top of the existing Firebase/Google auth.
    - Something else entirely, not represented in this repo's existing auth code (`apps/web/lib/auth-context.tsx`, `apps/web/lib/firebase.ts`) or task docs.
  - No acceptance criteria exist anywhere for this feature.
  - Apple Developer Team / App Store Connect access is not yet available to this session (user said it will be provided after manual confirmation) — any option chosen must not assume specific Team ID, provisioning profile, or App Store Connect App record details until then.
  - Mixing `com.performancecoach.app` and `com.pumpslate.app` config (e.g. partially renaming files, or standing up a second Firebase iOS app without clarifying intent) was explicitly ruled out by the user and must be avoided even accidentally.
- Dependencies / blockers (must be resolved before Section 1 can pick an option):
  1. Is `com.pumpslate.app` the same app as `com.performancecoach.app` under a new bundle ID/brand, or a distinct app?
  2. What does "Beta authentication" mean functionally — what should a beta tester be able to do that today's flow does not support, or what should it restrict?
  3. Apple Developer Team ID / App Store Connect App record status (tracked separately; TestFlight work itself stays out of scope per user instruction for this doc).

## 2. Technical Design

Not started — deferred until Section 1 has a selected option, per AGENTS.md §9 ("Sections 1 and 2 are deliberately separate").

## 3. Estimate

- Size: Unknown — cannot size until the identity question and the definition of "Beta authentication" are resolved (§1, Dependencies/blockers).

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — Read-only inspection | Done | Confirmed `1aa5d59`/`d7c3277` and all `pumpslate` references are unrecoverable across this repo, this GitHub account, and this account's session/environment history. Confirmed the only real iOS project found is `com.performancecoach.app` on `origin/claude/performance-coach-ios-capacitor-9xpav3`. |
| Phase 1 — Task Doc (this doc) | Done | Written without a selected option, per user instruction: doc only, no code or external config changes. |
| Phase 2 — Clarify `com.pumpslate.app` vs. `com.performancecoach.app` relationship | Not Started | Blocked on user input — see §1 Dependencies/blockers #1. |
| Phase 3 — Define "Beta authentication" scope & acceptance criteria | Not Started | Blocked on user input — see §1 Dependencies/blockers #2. |
| Phase 4 — Feasibility Analysis: select an option | Not Started | Cannot proceed until Phases 2–3 unblock. |
| Phase 5 — Technical Design | Not Started | Depends on Phase 4. |
| Phase 6 — Implementation | Not Started | Requires explicit approval per Phase Gate Protocol (AGENTS.md §8); not started under this doc. |
| TestFlight / Archive / Upload / App Store Connect work | Not Started | Explicitly out of scope for this doc per user instruction; tracked separately once Apple Developer/App Store Connect access is confirmed. |

## 5. Outcome (filled at completion)

- Final status: Task Doc created only. No code changes, no external configuration changes (Apple signing, Firebase, App Store Connect) were made or attempted.
- Deviations from plan: None — matches the user's explicit instruction to create the doc only and stop for approval before implementation.
- Follow-ups: Awaiting user clarification on the two blocking questions in §1 before Feasibility Analysis can select an option. TestFlight distribution remains a separate, later concern.
