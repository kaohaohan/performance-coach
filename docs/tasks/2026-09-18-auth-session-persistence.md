# Task: Persist Firebase Auth across iOS app switches

- Date opened: 2026-09-18
- Related contract sections: none (client Firebase session only)
- Size (S/M/L/XL, per AGENTS.md §7): S

## 1. Feasibility Analysis

- Problem / trigger: Users report being signed out after briefly leaving the iOS app. `getAuth()` has no explicit persistence; Capacitor WKWebView often falls back to in-memory auth.
- Options considered:
  1. Explicit `initializeAuth` + `indexedDBLocalPersistence`, plus foreground `reload()`.
  2. Native `@capacitor-firebase/authentication` Keychain persistence.
- Trade-offs: Option 2 is more durable but adds a native plugin and a second auth path. Option 1 is the smallest client-only change.
- Selected option and why: Option 1. Native plugin is a fallback if device smoke still drops the session.
- Risks & unknowns: IndexedDB can still fail in WKWebView; HMR must not double-initialize Auth.
- Dependencies / blockers: None.

## 2. Technical Design

- Affected files/components: `apps/web/lib/firebase.ts`, `apps/web/lib/auth-context.tsx`
- Data flow: Auth singleton uses IndexedDB persistence. Returning to the foreground reloads `currentUser` only when one exists; a null user is not treated as logout.
- Backward compatibility / data backfill: Existing signed-in users re-persist on next sign-in.

## 3. Estimate

- Size: S

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| IndexedDB initializeAuth | Done | |
| Foreground reload | Done | Capacitor appStateChange reloads currentUser only |
| Verification | Done | Staging iPhone smoke 2026-09-22: brief background OK; force-kill cold start may still sign out |
| Staging sign-off | Done | Accepted for MVP with known iOS WKWebView limit |

## 5. Outcome (filled at completion)

- Final status: Implemented and staging-verified (2026-09-22).
- Deviations from plan: IndexedDB persistence helps foreground resume; force-kill cold start on a physical iPhone may still require re-login.
- Follow-ups: If force-kill remains unacceptable after prod smoke, add `@capacitor-firebase/authentication` (Keychain).
