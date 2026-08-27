# Task: iOS Capacitor shell — point WKWebView at staging web app (Phase I2)

- Date opened: 2026-08-23
- Related contract sections: AGENTS.md §12 Working Tree Safety, §13 Environment Safety, §15 Cloud Safety, §17 Verification Rules
- Size (S/M/L/XL, per AGENTS.md §7): S

## 1. Feasibility Analysis

- Problem / trigger:
  - Phase I1 produced a Capacitor 8.5.0 skeleton (`apps/web/ios/`) whose WKWebView loads a bundled placeholder (`capacitor-shell/index.html`). Phase I2 is Option B: point the shell at the deployed web app instead of building a native UI.
- Options considered:
  1. Option A — build native screens.
  2. Option B — WKWebView loads a fixed, publicly reachable web deployment via `server.url`.
- Trade-offs:
  - Option A is out of scope for this phase (no native Firebase plugin, no native auth work approved yet).
  - Option B is a config-only change, reuses the existing Next.js app and its already-implemented auth, and is reversible by deleting one config block.
- Selected option and why: Option B, per explicit instruction — smallest change that gets a real device shell loading the real product.
- Risks & unknowns:
  - The staging URL is a Vercel git-branch Preview alias (`staging` branch), not a fully isolated environment (Firebase project is shared with Production; see `docs/tasks/2026-08-21-preview-backend-for-scheduled-workout-edit.md`). Acceptable for internal validation only.
  - No Google/Apple Sign-In wired into the native shell in this phase.
- Dependencies / blockers: none — read-only Vercel CLI query only, no deployment/env/project-setting changes made.

## 2. Technical Design

- Affected files/components:
  - `apps/web/capacitor.config.ts` — add `server.url` pointing at the confirmed staging alias.
- Data flow: WKWebView loads `https://performance-coach-git-staging-kaohaohans-projects.vercel.app` directly (Capacitor Option B: remote web server, no bundled webDir served at runtime).
- API changes: none.
- Frontend state/UI impact: none — same web app, no code changes, only the native shell's load target changes.
- Backward compatibility: fully reversible by removing the `server` block, reverting to the bundled placeholder.

## 3. Estimate

- Size: S

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Confirm staging URL (read-only) | Done | `vercel alias ls` — branch alias for `staging`, verified public 200 + real login page, distinct from production `dontworkout.vercel.app`. |
| Update `capacitor.config.ts` | Done | Added `server.url`, no `cleartext`, no `allowNavigation`. |
| `npm ci` / `cap sync ios` / lint / build | Done | See Completion Report. |
| Go verification (unrelated but required) | Done | See Completion Report. |
| Xcode Simulator build | Done | See Completion Report. |

## 5. Outcome (filled at completion)

- Final status: see Completion Report in chat.
- Deviations from plan: none.
- Follow-ups: Google/Apple Sign-In and native Firebase plugin remain explicitly out of scope for this phase.
