# Task: In-app account deletion (App Review 5.1.1(v))

- Date opened: 2026-08-26
- Related contract sections: `docs/go-backend-api-contract-v0.1.md` §1 (auth modes, tombstone, active vs historical), §3.1 (`DELETE /api/v1/me`), §3.4, §3.5, §3.7, §3.8, §4, §5
- Size (S/M/L/XL, per AGENTS.md §7): **XL** (split below)

Audited source of truth: `origin/staging` @ `0e1b7cdb1cee2cc80c3d736ca313237ec6bcddb5`.

This task must not touch iOS Release / TestFlight work and must not modify production.

## 1. Feasibility Analysis

- Problem / trigger: App Store 1.0 requires in-app account deletion (Guideline 5.1.1(v)). Apps that offer Sign in with Apple must revoke Apple tokens via the Sign in with Apple REST API. PumpLoop stores application identity in `users` (Firebase UID + name) and historical training in `scheduled_workouts` / sessions / set_logs that both Coach and Athlete legitimately read. Hard-deleting a `users` row is currently impossible (`NO ACTION` FKs) and would corrupt the counterparty's history even if forced.
- Options considered:
  1. **Option A — hard-delete everything** reachable from the user.
  2. **Option B — soft-delete/tombstone the user and retain all owned rows.**
  3. **Option C — anonymize identity, prune capabilities and unreferenced owner data, preserve performed-training closure, durable external-cleanup job, Apple revoke in 1.0.**
- Trade-offs (per option):
  - A is review-simple and destroys the other party's training record. Rejected.
  - B keeps history but leaves invite codes redeemable, future assignments live, unused private library retained, and (as first drafted) rewrote `firebase_uid` before Firebase deletion with no durable retry state. Insufficient.
  - C matches 5.1.1(v) (real deletion of login identity + associated personal data that is not legally/product-required history), preserves counterparty history, and makes Firebase/Apple cleanup recoverable.
- Selected option and why: **Option C**, as approved. Account deletion removes the ability to log in and anonymizes personal identity; it must not corrupt another user's legitimate historical training record.
- Risks & unknowns:
  - Apple authorization codes are single-use and short-lived; exchange + `id_token.sub` bind must happen before any DB mutation.
  - Capgo iOS `useProperTokenExchange: true` returns unused `authorizationCode` only when `redirectUrl` is empty (current PumpLoop init). Deletion helper must not set `redirectUrl`.
  - `reauthenticateWithCredential` must run against `currentUser`; a generic `signIn` can switch Firebase users.
  - Process-boot sweep of `PENDING_EXTERNAL` jobs is best-effort, not a guaranteed scheduler. No Cloud Scheduler in this task unless implementation proves it necessary.
  - `GET/PATCH/DELETE /workouts/{id}` and `PATCH/DELETE /set-logs/{id}` are in the contract but not all wired on staging; any implementation of those later must keep the active vs historical split.
- Dependencies / blockers: Apple Sign In key (Team ID, Key ID, `.p8`) as env; Firebase Admin already used for token verify; `@capgo/capacitor-social-login` ^8.4.5 already in the iOS app. Contract/schema/mvp/UI docs updated in this Phase 2. Implementation must not start until this Task Doc is the approved plan (it is).

## 2. Technical Design

### Affected files/components

See §3 sub-tasks. Docs already updated in Phase 2: `docs/go-backend-api-contract-v0.1.md`, `docs/database-schema-relationships.md`, `docs/mvp-specification.md`, `docs/frontend-ui-spec.md`, this file.

### Data flow

```
Settings / Account
  → destructive confirmation
  → reauthenticateWithCredential(currentUser, providerCredential)
       Apple-linked: native Apple sheet (useProperTokenExchange: true)
         → Firebase credential from idToken
         → reauthenticateWithCredential (must be the same uid)
         → appleAuthorizationCode from plugin result
       Google / password: matching provider credential
  → DELETE /api/v1/me  (Bearer = freshly re-authed ID token)
       Apple-linked: exchange code → validate Apple id_token.sub
         against current Firebase apple.com identity
         → fail 400 with no mutation if mismatch
       lock users row
       tombstone + prune + upsert account_deletion_jobs
       commit (firebase_uid still original)
       Apple revoke + Firebase DeleteUser
       on both success: rewrite firebase_uid, COMPLETE
       on failure: PENDING_EXTERNAL, still 204
  → signOut → /login
```

### Schema changes

Migration `0004_account_deletion` (additive):

- `users.deleted_at timestamptz NULL`
- `account_deletion_jobs` as in `docs/database-schema-relationships.md` §3.3

No `ON DELETE CASCADE` on user FKs. Down migration drops the job table and `deleted_at`.

### API changes

Canonical: `docs/go-backend-api-contract-v0.1.md` §3.1 `DELETE /api/v1/me`.

Exact status/error semantics:

| Case | HTTP | code |
| --- | --- | --- |
| Success, including already-deleted retry | 204 | (empty) |
| Missing/invalid Bearer | 401 | `UNAUTHENTICATED` |
| Tombstoned user on any other application-user route | 401 | `UNAUTHENTICATED` |
| Malformed JSON, unknown fields, empty/missing/unexpected `appleAuthorizationCode` | 400 | `INVALID_ARGUMENT` |
| Apple token endpoint rejects code, or Apple `id_token.sub` ≠ current Firebase Apple identity | 400 | `INVALID_ARGUMENT` (no mutation) |
| `auth_time` older than 5 minutes | 403 | `RECENT_AUTH_REQUIRED` |
| Signup/redeem hits tombstone | 409 | `ACCOUNT_DELETED` |
| Unexpected | 500 | `INTERNAL` |

`POST /coach-signup` and `POST /invite-codes/{code}/redeem` must not return the tombstone as idempotent success.

### State transitions

- `users.deleted_at`: NULL → set once. Never cleared.
- `account_deletion_jobs.status`: insert `PENDING_EXTERNAL` → `COMPLETE` after Firebase delete (and Apple revoke or N/A).
- `workout_sessions.status`: unchanged by account deletion. `ACTIVE` stays `ACTIVE`.
- `firebase_uid`: original until Firebase `DeleteUser` succeeds, then `deleted:{users.id}`.

### Frontend state/UI impact

New `/settings` for both roles. Coach secondary nav and Athlete Today gain an Account entry. After 204, clear auth state and route to `/login`. Calendar continues to render historical rows with `Deleted Athlete`. Roster (`GET /athletes`) omits tombstones.

Apple deletion re-auth: dedicated helper; **must** call `reauthenticateWithCredential(auth.currentUser, credential)`, not `signInWithCredential` / `signInWithApple` as a generic sign-in. If the resulting uid differs from `currentUser.uid`, abort and do not call `DELETE /me`.

### Backward compatibility / data backfill

No backfill. Existing users have `deleted_at` NULL. No production data rewrite in this task.

### Active vs historical `coach_athletes` (every production call site on staging)

| Call site | Class | After deletion |
| --- | --- | --- |
| `athlete.ListForCoach` | active | omit `deleted_at IS NOT NULL` |
| `athlete.Remove` | active | tombstone → `404` (keep row) |
| `scheduledworkout.lookupConnectedAthletes` | active | tombstone → `403` batch fail |
| `scheduledworkout.isConnected` used by `ListForCoach?athleteId=` | historical | tombstone with row → allowed |
| `scheduledworkout` Get/Update/Delete by id | owner `coach_id` | unchanged; unstarted already pruned; started → 409 on write |
| `workoutsession.lookupAccessibleScheduledWorkout` (Start) | active | tombstone athlete → 404 for coach |
| `workoutsession.lookupAccessibleSession` for Get | historical | tombstone athlete → 200 for coach |
| `workoutsession` Complete / CreateSetLog | active | tombstone athlete → 404 for coach |
| `invitecode.Preview/Redeem` JOIN `users` | capability | codes physically deleted for deleting coach |
| `coachsignup.Signup` / `invitecode.reconcileAthlete` | identity create | tombstone → `409 ACCOUNT_DELETED` |
| `authn.Middleware` | login | tombstone → 401 except `DELETE /me` |

### Firebase / Apple sequencing

1. Require `auth_time` ≤ 5 minutes.
2. If Apple-linked: exchange `appleAuthorizationCode` **before** DB writes. Validate Apple `id_token`. Require `sub` == current Firebase Apple provider uid. Negative test: a valid code for a **different** Apple user must 400 and leave DB unchanged.
3. DB commit: tombstone + prune + job with `original_firebase_uid` (+ `apple_refresh_token` if Apple). Do not rewrite `firebase_uid` yet.
4. Best-effort Apple `/auth/revoke` then Firebase `DeleteUser`.
5. Success: rewrite uid, complete job.
6. Failure: `PENDING_EXTERNAL` + `last_error`, HTTP 204. Retry via idempotent `DELETE /me` and optional process-boot sweep.

Operational limitation: boot sweep is best-effort recovery, not a guaranteed scheduler. Do not add Cloud Scheduler unless implementation proves it necessary.

## 3. Estimate

- Size: **XL**
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. **Docs / contract (this phase)** — `docs/go-backend-api-contract-v0.1.md`, schema, mvp spec, frontend UI spec, this Task Doc. No code.
  2. **Migration 0004** — `users.deleted_at` + `account_deletion_jobs` + verify SQL. (~3 files)
  3. **Deletion service + `DELETE /me` + authn** — Apple token exchange/revoke, `id_token.sub` bind, Firebase Admin `DeleteUser`, job state machine, `auth_time`, tombstone middleware exception. (~4–5 files + tests)
  4. **Authorization split** — every `coach_athletes` / signup / redeem call site in §2. Split if it exceeds ~5 files.
  5. **Frontend** — `/settings`, confirmation, `reauthenticateWithCredential`, Apple deletion helper, nav links, signed-out return.
  6. **Verification** — tests in §J below; no production deploys in this task.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 1 — read-only design audit | Done | Against `origin/staging` @ `0e1b7cdb1cee2cc80c3d736ca313237ec6bcddb5` |
| Phase 2 — contract-first docs | Done | Commit `c95fe8322476c0a0452c7951c8728d9d6fc2cfec` |
| Sub-task 2 — migration 0004 | Done | Additive `deleted_at` + `account_deletion_jobs`; round-trip verified on `performance_coach_test` |
| Sub-task 3 — DELETE /me + external cleanup | Not Started | |
| Sub-task 4 — active vs historical auth | Not Started | |
| Sub-task 5 — frontend Settings flow | Not Started | |
| Sub-task 6 — verification | Not Started | |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`. Keep this table current — do not write it once and abandon it.

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:

## J. Test plan (implementation)

- Coach deletion: invite codes gone; unreferenced workouts/exercises gone; referenced workout stubs + snapshots remain; athlete Today still renders `workoutName`; athlete can still complete an in-flight session; invite preview 404.
- Athlete deletion: unstarted assignments gone; ACTIVE sessions remain `ACTIVE` and mutation-blocked; coach `GET /sessions/{id}` 200 with `Deleted Athlete`; `GET /athletes` omits them; `POST /scheduled-workouts` 403; start/set-log/complete 404; `DELETE /athletes/{id}` 404; calendar `?athleteId=` historical list 200.
- Cross-tenant: athlete linked to two coaches; the other coach's rows untouched.
- Apple: valid code for another Apple user → 400, no `deleted_at`, no job. Matching `sub` proceeds.
- Re-auth: frontend must use `reauthenticateWithCredential` on `currentUser`; a mismatched uid must not call `DELETE /me`.
- Sequencing: Apple exchange fail → 400, row unchanged. Firebase fail after commit → 204, job `PENDING_EXTERNAL`, uid unchanged, signup 409 `ACCOUNT_DELETED`. Retry/boot then COMPLETE and uid rewritten.
- Second `DELETE /me` → 204 and re-drives cleanup.
- Sign-in after COMPLETE: old credentials cannot resolve the tombstone; a new Firebase user gets a new empty app account, never the old id.
- `RECENT_AUTH_REQUIRED`; malformed body 400; Apple-linked missing code 400.
- Every `coach_athletes` call site in §2 covered for mutation vs read.
