# Task: Google Sign-In with existing-account continuity

- Date opened: 2026-08-20
- Related contract sections: §4 (Architecture Boundaries), §6 (API Contract Discipline — verified *unchanged*), §13 (Environment Safety), §15 (Cloud Safety — Firebase Console is operator-only)
- Size (S/M/L/XL, per AGENTS.md §7): **M**

## 0. Identity invariant (non-negotiable)

```
Firebase verified UID  →  users.firebase_uid  →  all application data
```

Email is **never** an application identity. This task adds an authentication
*provider*; it does not add, change, or bypass any identity resolution. No
application-level "merge by email" exists or may be introduced. Firebase
remains solely responsible for provider identity and linking.

## 1. Feasibility Analysis

### Problem / trigger

Pilot athletes and coaches registered with Firebase Email/Password, many on
`@gmail.com` addresses. We want "Continue with Google" on login, athlete
invite onboarding, and coach signup — without creating a second Firebase
identity (and therefore a second `users` row) for someone who already has
history under a password account.

### Options considered

1. **Rely on Firebase's native "One account per email address" linking.**
   Google's assertion of a verified email resolves to the *existing* Firebase
   user; the UID never changes, so `users.firebase_uid` still matches and every
   relationship/history row is reached unchanged.
2. **Application-level merge:** look up `users` by email, detect a duplicate
   after Google sign-in, and repoint `firebase_uid` / move rows.
3. **Explicit `linkWithCredential` flow:** ask the user to sign in with their
   password first, then link the Google credential client-side.

### Trade-offs

| Option | Identity safety | History safety | Cost |
| --- | --- | --- | --- |
| 1 | Firebase is the authority; UID is stable by construction | Nothing moves — same UID, same row | Frontend only; depends on one project setting |
| 2 | **Unacceptable.** Email becomes a de-facto identity; anyone who can assert an email can inherit an account | Requires rewriting `firebase_uid` or moving `coach_athletes` / `scheduled_workouts` / `workout_sessions` / `set_logs` | High, and irreversible when wrong |
| 3 | Safe, but only needed when Firebase *doesn't* auto-link | No movement | Extra friction on every affected sign-in; unnecessary for the case we actually have |

### Selected option and why

**Option 1.** It is the only one that keeps Firebase as the identity
authority, requires no data migration, and cannot produce a duplicate
application user. Option 2 is explicitly forbidden by the identity invariant.
Option 3 solves a problem that measurement (§1, "Verified behavior") shows we
do not have for the Google provider, and would add friction to every pilot
user's first Google sign-in.

Option 3's *error path* is still implemented defensively:
`auth/account-exists-with-different-credential` is caught and shown as
actionable copy telling the user to sign in with their existing method. It is
never auto-merged.

### Verified behavior (measured, not assumed)

Measured against the Firebase Auth Emulator (`firebase-tools`, project
`performance-coach-local`) by driving the Identity Toolkit REST API directly:
create a password account, record the UID, then `accounts:signInWithIdp` with
`providerId=google.com` asserting the same address, and re-read the account.

| Pre-existing password account | Project setting | UID after Google | Providers after | Password still works |
| --- | --- | --- | --- | --- |
| email **unverified** | One account per email | **unchanged** | `[google.com]` | **no** — `INVALID_PASSWORD` |
| email **verified** | One account per email | **unchanged** | `[password, google.com]` | yes |
| either | Multiple accounts per email | **DIFFERENT UID** | `[google.com]` | (separate account) |

Two conclusions drive this design:

1. **Continuity holds in every "one account per email" case.** The Firebase UID
   is preserved, so `users.firebase_uid` still resolves to the same row and no
   history moves. This is the acceptance requirement, and it is satisfied
   without any backend or database change.
2. **"Multiple accounts per email address" would create a duplicate identity**,
   and on the invite flow that duplicate would be provisioned as a *second*
   `users` row, orphaning the athlete's history. This is the single
   configuration that makes the feature unsafe — see §6, Operator Prerequisites.

A third, non-blocking consequence: for an account whose email was never
verified, Firebase **removes the password provider** when Google proves
ownership of the address. This is documented, intentional Firebase behavior
(an unverified password credential cannot outrank a trusted email IdP —
otherwise anyone could pre-register a password on an address they do not own).
It costs the user their password, not their identity or their history. It must
be communicated to pilot users; it is not a defect to work around, and it must
not be "fixed" by disabling One-account-per-email.

Consistent with the current official Firebase documentation, which states that
Google is both an email and a social identity provider, that email IdPs are
authoritative for addresses on their hosted domain, and that "a user logging
in with Google will never cause this error [`account-exists-with-different-credential`]
when their account is hosted at Google."

### Risks & unknowns

- **Firebase Console configuration cannot be inspected or changed from this
  environment.** The One-account-per-email setting must be verified by an
  operator before release. Treated as a release blocker, not an assumption.
- Emulator behavior is strong evidence but is not production. The production
  UID before/after check stays on the manual E2E checklist.
- `fetchSignInMethodsForEmail` is deprecated and silently fails under email
  enumeration protection — deliberately not used anywhere in this design.

### Dependencies / blockers

- Firebase Console: Google provider enabled; `dontworkout.vercel.app` on the
  authorized-domains list.
- New public env var `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` (the app is not on
  Firebase Hosting, and `signInWithPopup` cannot build its handler URL
  without it).

## 2. Technical Design

### Affected files/components

| File | Change |
| --- | --- |
| `apps/web/lib/firebase.ts` | optional `authDomain` in the client config |
| `apps/web/lib/auth-context.tsx` | add `signInWithGoogle()`; existing methods untouched |
| `apps/web/components/google-sign-in-button.tsx` | new — shared button, divider, error→copy mapping |
| `apps/web/app/login/page.tsx` | Google entry point; no provisioning |
| `apps/web/app/join/[code]/page.tsx` | Google entry point + coach-session bug fix |
| `apps/web/app/coach/signup/page.tsx` | Google entry point + name confirmation |

Backend: **unchanged**. Database: **unchanged, no migration**.

### Data flow

```
Continue with Google
  → signInWithPopup(GoogleAuthProvider)      [Firebase resolves provider→UID]
  → credential.user.getIdToken()             [fresh token, no onIdTokenChanged race]
  → existing endpoint, Bearer <token>
      /login          GET  /api/v1/me                     (never provisions)
      /join/[code]    POST /api/v1/invite-codes/{c}/redeem (backend provisions ATHLETE)
      /coach/signup   POST /api/v1/coach-signup            (backend provisions COACH)
```

The frontend never sends a Firebase UID, a role, or an email as identity. The
backend derives the UID from the verified token exactly as it already does for
password sign-in — which is why no backend change is required.

### Popup vs redirect

**`signInWithPopup`.** `signInWithRedirect` completes by reading browser
storage belonging to the `authDomain` sign-in helper, which is cross-origin to
`dontworkout.vercel.app`. Safari 16.1+, Firefox 109+, and Chrome M115+ block
that access, and Firebase's own redirect best-practices guidance lists
switching to `signInWithPopup()` as the remedy for apps not served from
Firebase Hosting. Of the documented options, Option 1 (Firebase Hosting
reverse proxy) does not apply — we are on Vercel — and Option 3 (self-hosting
the sign-in helper) is meaningful complexity for an MVP.

Redirect would also require persisting pending invite context (`/join/<code>`)
across a full page navigation, with the attendant risk of redeeming the wrong
invite or looping. Popup keeps the invite flow a single uninterrupted client
state machine, which is what makes "don't lose the invite code" true by
construction rather than by careful bookkeeping.

The older Firebase guidance preferring redirect on mobile predates storage
partitioning; on a modern iOS Safari a redirect on a non-Firebase-Hosting
domain is the *less* reliable path. Popup is invoked only from an explicit tap
(never automatically), and `popup-blocked` / `popup-closed-by-user` /
`cancelled-popup-request` are handled explicitly. Real-device Safari
verification remains a manual E2E item.

`prompt: "select_account"` is set so Google always shows the account chooser
rather than silently reusing the browser's single Google session — the
"wrong Google account" guard, and the reason a shared phone cannot quietly
attach an invite to the wrong identity.

### State transitions — `/join/[code]`

Fixes the known bug where a signed-in Coach opening an athlete invite redeems
with the Coach token, gets 403, and then retries the same token forever.

```
loading → invalid
        → confirming ─Continue─→ checkingSession ─COACH────→ coachBlocked ─signOut→ authenticating
                                                 ─ATHLETE──→ redeeming
                                                 ─no user──→ redeeming
                     ─no session─→ authenticating ─(google | email/password)→ redeeming
        redeeming → onboarded | authenticating(retry) | coachBlocked(403)
```

Role is resolved via `GET /api/v1/me` *before* any redeem attempt whenever a
Firebase session already exists. Retry re-mints a token from the current
Firebase user rather than replaying a stored one, and a 403 routes to
`coachBlocked` instead of offering a same-token retry.

### Frontend state/UI impact

- One `Continue with Google` button, Google's four-colour mark, above an
  `or` divider, on all three routes. Email/password is preserved everywhere.
- `/login`: on `GET /api/v1/me` 401 the user is shown both onward paths
  (athlete invite, Create Coach Account) and is **not** provisioned.
- `/coach/signup`: after Google the card switches to a name-confirmation step
  pre-filled from Google `displayName` (editable, and the only path when
  Google supplies no name), plus "Use a different account" to sign out.
- Layout targets a 375px-wide viewport; controls stay `min-h-14`.

### Backward compatibility / data backfill

None required. No schema change, no backfill, no data movement. Existing
password sign-in, signup, and invite redemption paths are unchanged.

## 3. Estimate

- Size: **M**
- Deviation from AGENTS.md §7 (≤5 files): this change touches 6 source files
  plus docs. Splitting further would ship a partially-wired auth surface —
  `signInWithGoogle()` with no entry point, or a Google button on one journey
  but not the other two — which is worse to review and worse to test than one
  coherent change. Recorded here deliberately rather than left implicit.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — inspect web auth, backend auth, invite/coach-signup | Done | Backend already provider-agnostic; no change needed |
| Research current Firebase linking semantics | Done | `firebase.google.com` egress-blocked; used official-doc text via search + direct emulator measurement |
| Measure UID before/after (emulator) | Done | Same UID under One-account-per-email; different UID under Multiple |
| `lib/firebase.ts` — `authDomain` | Done | Optional; emulator path unaffected |
| `lib/auth-context.tsx` — `signInWithGoogle()` | Done | Popup, `select_account`, fresh token |
| Shared Google button + error mapping | Done | `components/google-sign-in-button.tsx` |
| `/login` Google entry point | Done | No provisioning from login |
| `/join/[code]` Google + coach-session fix | Done | Role resolved before redeem |
| `/coach/signup` Google + name confirmation | Done | `displayName` pre-fill, editable |
| Env/docs updates | Done | `.env.example`, README, deployment §11 env table |
| lint / tsc / build / go test | Done | All pass |
| Production Firebase Console + Safari E2E | **Blocked — operator** | Not performable from this environment; see §6 |

## 5. Outcome

- Final status: implemented; frontend-only. Backend unchanged, no migration.
- Deviations from plan: 6 source files instead of ≤5 (see §3).
- Follow-ups:
  1. Operator verifies the Firebase Console prerequisites in §6 **before**
     pilot users see the button.
  2. Real-device iOS Safari popup verification on the Vercel Preview URL.
  3. Production UID before/after check on one real pilot account.
  4. Tell pilot users with unverified emails that Google becomes their
     sign-in method afterwards.

## 6. Operator Prerequisites (cannot be done from the coding environment)

**Release blocker — verify before enabling for pilot users.**

1. **Firebase Console → Authentication → Sign-in method → Google → Enable.**
   Set the project support email. Without this, sign-in fails with
   `auth/operation-not-allowed`.
2. **Firebase Console → Authentication → Settings → User account linking →
   "One account per email address".** This must be selected, **not** "Multiple
   accounts per email address". This is the setting that guarantees an existing
   Gmail/password user keeps their Firebase UID. If it is set to "Multiple",
   **do not ship** — Google sign-in would create a second Firebase identity and
   the invite flow would provision a duplicate `users` row.
3. **Firebase Console → Authentication → Settings → Authorized domains.** Add
   `dontworkout.vercel.app`. Add any Vercel Preview hostname used for testing
   (preview URLs are per-deployment; a stable preview alias is easier to
   authorize than a rotating one). `localhost` is authorized by default.
4. **Vercel → Project → Settings → Environment Variables:** add
   `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` (Production and Preview). For the
   `dontworkout` Firebase project this is `dontworkout.firebaseapp.com` unless
   a custom auth domain is configured. It is public web configuration, not a
   secret. Confirm `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` remains **unset**
   in every deployed environment.
5. No OAuth client secret is handled by this repository and none should be
   added to it — the Google provider's client ID/secret live in the Firebase
   Console only.
