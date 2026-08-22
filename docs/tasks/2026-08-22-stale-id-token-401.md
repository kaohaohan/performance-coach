# Task: Set logging fails in production with 401 "missing or invalid authentication"

- Date opened: 2026-08-22
- Related contract sections: §6 API Contract Discipline (no contract change — verified), §11 Small Task Exception (2 source files), §17 Verification Rules
- Size (S/M/L/XL, per AGENTS.md §7): S

## 1. Feasibility Analysis

- Problem / trigger:
  Reported from the deployed PWA (dontworkout.vercel.app) on a phone: the session
  page rendered the exercise, plan and targets correctly, but `Log Set` failed with
  the API's `UNAUTHENTICATED` message, "missing or invalid authentication".

  Root cause: the web app authenticates every call with a *captured* Firebase ID
  token. `AuthProvider` stores the token in React state from `onIdTokenChanged`
  (`apps/web/lib/auth-context.tsx`), and each page passes that string to
  `apiFetch` (`apps/web/lib/api.ts`). A Firebase ID token is valid for one hour,
  and the SDK's proactive refresh runs on a timer inside the page. During a real
  workout the tab is backgrounded for long stretches (screen lock between sets),
  which suspends that timer on mobile Safari, so the captured string goes stale
  while the page stays mounted. `GET /api/v1/sessions/{id}` succeeded because it
  ran at page load with a fresh token; `POST .../set-logs`, tapped later, sent the
  expired one and the Go API's `authn.Middleware` rejected it. Both routes are
  behind the same middleware (`apps/api/cmd/api/main.go:130-131`), which rules out
  a route/authorization difference; nothing on the API side needs to change.

  Every authenticated page has the same defect (coach calendar, clients, workouts,
  exercises, today) — the athlete's set logging is just where it bites hardest,
  because that page is deliberately left open for the length of a session.

- Options considered:
  1. Mint the token at request time inside `apiFetch`, via a token provider that
     `AuthProvider` registers once with the API client.
  2. Thread a `getIdToken()` callback from `useAuth()` through all 8 page
     components and both prop-drilled child components, replacing each
     `apiFetch(idToken, …)` argument.
  3. Refresh the token on `visibilitychange` (and/or on a short interval) so the
     captured state string is fresher.

- Trade-offs (per option):
  1. One place to change; fixes all current and future call sites, including the
     ones that prop-drill the token (`InviteCodesPanel`, `CreateInviteModal`).
     Cost: the token actually sent is no longer the argument the caller passed,
     which is implicit and has to be documented at both ends.
  2. Most explicit. Cost: ~10 files touched for one bug (over the §7 five-file
     guidance), every call site can still be got wrong later, and it does nothing
     for a token that expires *between* render and tap.
  3. Smallest diff, but it only narrows the window instead of closing it: a tap
     that lands before the refresh completes, or a wake-up whose refresh request
     fails, still sends an expired token. It also cannot fix clock skew, where the
     client believes a token is valid and the server does not.

- Selected option and why: 1.
  It is the only option that makes staleness structurally impossible rather than
  unlikely: `getIdToken()` returns the SDK-cached token when it is still valid and
  exchanges the refresh token when it is not, so correctness no longer depends on
  when a timer last ran. It also keeps the blast radius at two files during a
  production incident (§23), with no page-level churn to re-review.

- Risks & unknowns:
  - The registered provider is module-level state in `lib/api.ts`. It is set on
    `AuthProvider` mount and cleared on unmount; `AuthProvider` wraps the whole app
    exactly once (`app/layout.tsx`), so there is no second writer.
  - `getIdToken()` may make a network call when the token really is expired,
    adding one round trip to the first request after a long background period.
  - If the refresh itself fails (offline), the call falls back to the caller's
    token — no worse than today's behaviour.

- Dependencies / blockers: none.

## 2. Technical Design

- Affected files/components:
  - `apps/web/lib/api.ts`
  - `apps/web/lib/auth-context.tsx`

- Data flow:
  ```
  AuthProvider mount
    └─ setAuthTokenProvider(getIdToken)          // lib/api.ts module state

  page tap → apiFetch(capturedIdToken, path, opts)
    ├─ provider()          → firebase currentUser.getIdToken()        // cached-or-refreshed
    ├─ fetch /backend/…  Authorization: Bearer <fresh>
    └─ on 401 → provider(true) → forced refresh → retry once
                 └─ still 401 → ApiError("Your sign-in has expired…")
  ```

- API changes: none. Routes, request/response shapes, status codes and
  authorization rules are unchanged; this is purely which token the client puts in
  the `Authorization` header it was already sending.

- Frontend state/UI impact:
  - `useAuth()` gains `getIdToken(forceRefresh?)`. `idToken` stays, now documented
    as a render-gating snapshot only (`if (!idToken) return`, "Loading…" guards),
    and every page keeps its existing `apiFetch(idToken, …)` call unchanged.
  - A 401 that survives a forced refresh is re-worded to "Your sign-in has expired
    or is no longer valid. Please sign in again." — the API's own wording describes
    the request, not what the athlete should do. `ApiError.status`/`.code` are
    preserved, so `UNAUTHENTICATED` remains branchable.
  - Retrying a 401 is safe for the `POST` routes: a 401 is produced by the auth
    middleware before any handler runs, so the replay cannot double-write a SetLog.

- Backward compatibility:
  `apiFetch`'s signature is unchanged, and with no provider registered (SSR, or
  before `AuthProvider` mounts) it behaves exactly as before, sending the token it
  was given. The join flow's freshly-minted `signIn`/`signUp` token keeps working.

## 3. Estimate

- Size: S

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Reproduce & root-cause the production 401 | Done | Stale captured ID token; API side ruled out |
| Request-time token minting in `lib/api.ts` | Done | Provider + single force-refresh retry |
| Register provider from `AuthProvider` | Done | Also exposes `getIdToken` on the context |
| Verification (lint, typecheck, build, behaviour) | Done | See §5 |
| Deploy & confirm on the phone | Not Started | Needs a real session left idle >1h |

## 5. Outcome (filled at completion)

- Final status: Implemented, verified locally, not yet confirmed in production.
- Verification run:
  - `npm run lint` — clean.
  - `npx next build` — succeeds (12 routes).
  - Behavioural check of `apiFetch` against a stubbed `fetch` and a stubbed token
    provider (compiled `lib/api.ts`, run under node): fresh token is sent rather
    than the caller's stale snapshot; a 401 triggers exactly one force-refreshed
    retry and returns the retry's result; an unchanged refreshed token skips the
    pointless retry; a persistent 401 surfaces the actionable message with
    `status`/`code` intact; a failing provider falls back to the caller's token;
    non-401 errors pass through untouched.
- Deviations from plan: none.
- Follow-ups:
  - No automated test suite exists for `apps/web`, so the behavioural check above
    is not committed. Adding a runner (and porting this check) is worth its own
    task.
  - Consider surfacing a "signed out" recovery affordance on the session page
    (an inline re-login) so an athlete mid-workout does not lose the page.
