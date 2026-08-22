# Athlete Onboarding & Coach Invite Codes — Task Doc (V0.1)

> **Document role, added on restoration (2026-08-22).** This is the
> implementation design record for the Coach invite-code / Athlete
> onboarding feature — it explains *why* it was built this way, alongside
> the exact endpoint, schema, and test detail captured during
> implementation. It is not a competing source of truth: product behavior
> is defined in `docs/mvp-specification.md` ("Coach & Athlete Onboarding —
> Implemented (V0.1)"), the wire contract in
> `docs/go-backend-api-contract-v0.1.md` §3.1/§3.4, and the schema in
> `docs/database-schema-relationships.md`. It does not cover
> `POST /coach-signup`, which shipped later and is out of this document's
> original scope.

Status: **Locked for implementation** — decisions below are approved; no application code, migration files, or infrastructure have been touched yet.

Target: 2026-08-18

Source of truth: this document for this feature's product/schema/API/frontend decisions until its first implementation PR folds the relevant pieces into `docs/mvp-specification.md`, `docs/frontend-ui-spec.md`, `docs/go-backend-api-contract-v0.1.md`, and `docs/database-schema-relationships.md` per `AGENTS.md` §17. Where this document and those four disagree today, this document wins for this feature only — it exists precisely because those four currently say the mechanism is "undecided."

This doc supersedes the exploratory options in the prior read-only Phase 0 report (10 numbered decisions, D1–D10) with one locked design. Where a locked decision below differs from that report's *recommendation*, it's called out explicitly.

---

## 1. Bootstrap contradiction — resolved (revised)

> **Superseded, 2026-08-22.** The branch-merge state described in this
> section is out of date: the bootstrap work
> (`apps/api/internal/bootstrap`, `docs/adr/`,
> `docs/deployment-architecture-v0.2.md`) is now merged into
> `origin/main`. The investigative findings and reasoning below are
> preserved as written; only the "not yet merged" branch state has
> changed.

*Revision note: this section originally concluded that no Dockerfile/migrate/bootstrap code existed anywhere in the repository. That conclusion was true only of `origin/main`/`c41ec18`, the base this doc was first branched from. A follow-up delta reconciliation found the real deployment work on a sibling branch that `main` never merged. The corrected findings below replace the original verdict; nothing else in this document changed as a result.*

Two conflicting claims were originally presented:

- **Claim A** (prior deployment inspection): the backend image contains `/api`, `/migrate`, `/bootstrap` binaries.
- **Claim B** (prior repo inspection): an implemented bootstrap command exists with JSON manifest input, transactional writes, `users` upsert by `firebase_uid`, and `coach_athletes ON CONFLICT DO NOTHING`.
- **My original Phase 0 report**: "The bootstrap job is documentation, not code."

**Corrected verdict: Claim A and Claim B are both true — just not on `origin/main`.** They describe `origin/claude/perf-coach-phase-0-inspection-ao1t2v`, tip commit `a2ab984`, which branches directly off `c41ec18` and adds exactly this work:

| SHA | Commit | Adds |
|---|---|---|
| `7bc218e` | `build(api): add Cloud Run container image` | `apps/api/Dockerfile`, `.dockerignore` |
| `1b7b99b` | `feat(api): D1b production database tooling` | `apps/api/cmd/api`, `apps/api/cmd/migrate`, `apps/api/cmd/bootstrap`, `internal/migrate` (embedded SQL, `schema_migrations` version/checksum ledger), `internal/bootstrap` (manifest loader + `Apply`), `BOOTSTRAP_MANIFEST_PATH` |
| `23a8b4f` | `docs: promote deployment architecture to v0.2 and record D1a completion` | `docs/deployment-architecture-v0.2.md` |
| `a2ab984` | `docs: move pilot database from Cloud SQL to Neon (ADR 0001)` | `docs/adr/0001-pilot-database-provider.md` |

`origin/main`/`c41ec18` was simply stale relative to this branch — the deployment work was never merged back, not that it never existed. My original Phase 0 report was correct about the state of `origin/main`; it was incomplete because it only checked one branch.

### What bootstrap actually is — and is not

Direct inspection of `apps/api/internal/bootstrap/bootstrap.go` and `apps/api/cmd/bootstrap/main.go` at `a2ab984` confirms **bootstrap is an operator/deployment provisioning mechanism, not athlete self-service onboarding.** It:

- accepts a reviewed, non-secret **JSON manifest file** (`BOOTSTRAP_MANIFEST_PATH`) listing `users: [{firebaseUid, name, role}]` and `relationships: [{coachFirebaseUid, athleteFirebaseUid}]`, decoded with `DisallowUnknownFields` so an unexpected field (e.g. a password) is rejected at load time rather than silently ignored;
- treats `firebaseUid`, `name`, and `role` in that manifest as **trusted input** — a human already reviewed the file before it touched the database; nothing is verified against a live Firebase token, because bootstrap has no HTTP surface and never calls into `authn` at all;
- **upserts `users`**: `INSERT ... ON CONFLICT (firebase_uid) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role` — re-running the same manifest re-affirms names/roles rather than erroring;
- **creates `coach_athletes` relationships**: `INSERT ... ON CONFLICT DO NOTHING`, resolving both sides by `firebase_uid` lookup;
- runs the whole manifest inside one `pool.Begin` / `defer tx.Rollback(ctx)` / `tx.Commit(ctx)` transaction — atomic and idempotent for its actual use case (an operator re-running the same reviewed file);
- is **not HTTP-reachable** — it is never wired into `apps/api/main.go`'s mux on either branch; it runs only as a standalone CLI/Cloud Run Job, by hand, from a manifest a human wrote.

This means bootstrap is a good fit for **provisioning the initial pilot coaches (and any other pre-approved seed accounts)** — exactly the deployment doc's original intent (§10, "Production bootstrap data") — and nothing here changes that. It is not, and must not become, the athlete's onboarding path: an athlete has no reviewed manifest, no operator, and no file to be listed in. **The invite-code feature described in the rest of this document remains required, unchanged in design**, as the normal, self-service product lifecycle: coach creates an invite → athlete signs up with Firebase → athlete redeems the invite over HTTP with no operator involved.

One divergence is deliberate and must be preserved, not "fixed" toward bootstrap's pattern: bootstrap's user upsert does `ON CONFLICT (firebase_uid) DO UPDATE SET name = ..., role = ...`, which is correct for trusted, human-reviewed input but would be unsafe if reused as-is behind an HTTP-facing endpoint (it would let a repeat caller overwrite their own `role`, or overwrite another account's `name`). §6 below's redeem design already uses `ON CONFLICT (firebase_uid) DO NOTHING RETURNING id` instead — create-once, never overwrite — independently arrived at for exactly this reason. See §5.3/§6 for the full design; no change to it is needed as a result of this reconciliation. The `INSERT INTO coach_athletes ... ON CONFLICT DO NOTHING` idiom, by contrast, *is* identical between bootstrap and the redeem design — both are safe because relationship rows have no mutable fields to overwrite.

### Source-of-truth caveat

`a2ab984` is the newest deployment state currently verifiable from remote Git refs (`git fetch --all --tags --prune` against `origin`, all branches inspected). It may still be behind unpushed commits that exist only on the author's local machine — that cannot be checked from here. Separately, and just as important: nothing in any accessible ref proves the deployment *ran*. The deployment doc's own phase table marks D1a/D1b **Done** (container image builds locally, `/migrate`/`/bootstrap` verified via `--entrypoint` override against a local database) but marks D2 onward — cloud foundation, Secret Manager, the first Artifact Registry image publish, and, critically, **D3c (actually running the migration and bootstrap jobs against real Neon/Cloud Run)** — as future work with no recorded image digest, no "deployment change record," and no evidence of execution in git. That is not a claim that D3a–D6 did not happen; it is a statement of what remote Git does and does not prove. If those phases were completed by hand outside version control, that fact simply isn't visible from any ref this inspection can reach.

**Consequence for this feature:** coach provisioning today is manual SQL, or — on the not-yet-merged deployment branch — the `bootstrap` CLI job; either way it is operator-driven, not self-service, and this feature does not change that. This feature's job remains giving **athletes** a real, self-service provisioning path that requires no operator; it deliberately does not touch or replace coach provisioning.

---

## 2. Locked decisions

These are settled. Implementation should not re-litigate them without a new explicit product decision.

| # | Decision |
|---|---|
| 1 | Invite codes are **reusable** by multiple athletes (not single-use). |
| 2 | Default expiration = **30 days** from creation; coach may choose a different duration at creation. |
| 3 | Codes are **revocable**; revocation is forward-only (does not detach athletes who already joined). |
| 4 | **Firebase Auth remains the only authentication system.** The invite code is a capability, never a credential. |
| 5 | MVP signup provider = **existing email/password** (`createUserWithEmailAndPassword` / `signInWithEmailAndPassword`), matching what `apps/web/lib/auth-context.tsx` already supports. |
| 6 | Google / Apple sign-in are **deferred** — neither is configured in this repo today (§3.5 of the prior Phase 0 report: no provider beyond email/password exists anywhere in `apps/web`). |
| 7 | Redeem **must** work for a Firebase-authenticated identity with **no** PostgreSQL `users` row yet — this is the normal case for a brand-new athlete, not an edge case. |
| 8 | Add a **narrow `FirebaseOnlyMiddleware`** rather than weakening `authn.Middleware`. The existing middleware and every route behind it are untouched. |
| 9 | Redeem is **idempotent**: same athlete + same coach already connected → `200` success, not an error. |
| 10 | Add minimal coach-side removal: **`DELETE /api/v1/athletes/{athleteId}`** detaches the `coach_athletes` relationship only. It must **not** delete the `users` row or touch the Firebase account. |
| 11 | **No TeamBuildr-style "Pending" athlete state** in MVP. Every row in `coach_athletes` is, by construction, a real joined account. |
| 12 | The Athletes table does **not** require `users.email` for MVP. No schema change to `users` for this feature. |
| 13 | No Groups / Teams / Calendar assignment during onboarding / bulk upload / SMS / email-sending infrastructure. |

### Decisions this doc still had to make, and why

The lock list above doesn't cover every implementation-level fork. Each of these was resolved in the direction that keeps the schema and contract surface smallest, consistent with decision #12's spirit ("don't add fields to imitate TeamBuildr"):

- **No `coach_athletes.created_at`, no "Joined" date column.** The target UX lists "Joined / basic status if useful" as optional. Adding a timestamp column to an existing table for a "nice to have" column contradicts the minimalism directive that killed `users.email`. The Athletes tab instead shows a static **Connected** status chip — true for every row by construction (decision #11), and requires zero schema change to an existing table. `coach_athletes.created_at` remains a trivial, purely additive follow-up if a real need for it shows up later.
- **No redemption-audit table.** The prior report's optional `coach_invite_code_redemptions` table is dropped. Idempotency (decision #9) is fully satisfied by `coach_athletes`'s existing composite primary key plus `ON CONFLICT DO NOTHING` — no second table is required for correctness, and the Invite Codes tab's spec'd columns (description, code, expires, status, actions) don't call for a redemption count. **Net effect: this feature adds exactly one new table and zero changes to existing tables.**
- **Invite code entropy/format:** 10-character Crockford Base32 (`0-9`, `A-HJKMNP-TV-Z` — I/L/O/U excluded), ≈50 bits, generated with `crypto/rand`. Stored uppercase/unhyphenated; displayed as `XXXXX-XXXXX`.
- **Invite description is shown to the athlete on the confirmation screen**, alongside the coach's name — it's what makes "You're joining Coach Kao — Fall squad" reassuring instead of a bare name. The create-modal copy tells the coach the field is athlete-visible.
- **The client composes the invite URL** (`${window.location.origin}/join/${code}`) — the API never returns a URL. Avoids a new `APP_ORIGIN` env var and origin-mismatch bugs across local/preview/production.
- **Unknown / malformed / expired / revoked codes all return the same `404`** from both preview and redeem — one indistinguishable response, so neither endpoint can be used to confirm a code once existed. The UI covers this with one honest message.
- **Login flow is embedded inside `/join/[code]`, not a redirect to `/login`.** This is what fully resolves "login-return-to-invite" (see §7) — there's no return-to parameter to plumb because the athlete never leaves the join page for authentication.

---

## 3. Current-state findings (carried forward, re-verified this session)

> **Superseded, 2026-08-22.** Two observations below are out of date:
> `apps/api/internal/bootstrap` is now merged into `origin/main` (see the
> note under §1), and `createUserWithEmailAndPassword` now exists in
> `apps/web/lib/auth-context.tsx` (`signUp()`, added by this feature
> exactly as this section anticipated). The rest of this section's
> findings are preserved as written.

Re-confirmed directly against the working tree, not assumed from the prior report:

- **Coach & athlete provisioning today**: manual SQL against Neon on `origin/main`, or the `bootstrap` CLI job on the not-yet-merged deployment branch (§1 above). Neither is HTTP-reachable — no code path on any branch creates a `users` row from a live request. That gap is exactly what this feature's redeem endpoint closes.
- **`authn.Middleware` behavior on a verified-but-unknown Firebase UID**: `401 UNAUTHENTICATED`, documented in `apps/api/internal/authn/authn.go`'s package comment — "no signup flow exists yet." This is the exact gap decision #7/#8 close.
- **Web auth providers**: `apps/web/lib/auth-context.tsx` implements only `signInWithEmailAndPassword` / `signOut` / `onIdTokenChanged`. `createUserWithEmailAndPassword` does not exist in the repo yet — it needs to be added as part of this feature (decision #5).
- **`/coach/clients`** is a real, working page (`apps/web/app/coach/clients/page.tsx`, gates on COACH role, renders `GET /api/v1/athletes`) plus an athlete-detail subpage — not a placeholder. It is reached via a button in the `/coach/calendar` header row; there is no separate nav component to update.
- **`GET /api/v1/athletes`** (`apps/api/internal/athlete/athlete.go`) returns `{id, name, role}` per connected athlete, ordered by name, defensively filtered to `role = 'ATHLETE'`. Reused unchanged by this feature — decision #12 means no response-shape change here.
- **`coach_athletes`** has composite primary key `(coach_id, athlete_id)` — this is what makes both redeem-idempotency (#9) and remove-then-rejoin trivial with no extra bookkeeping.
- **`scheduledworkout.ListForAthlete`** (backing `GET /me/scheduled-workouts`, the athlete Today view) filters by `sw.athlete_id = $1 AND sw.scheduled_date = $2` only — it does **not** re-check `coach_athletes` at read time. This matters directly for the removal endpoint's semantics; see §5.4.
- **Service-layer conventions to match exactly**: package-level sentinel errors (`ErrForbidden`, `ErrNotFound`-style), pointer `*ValidationError` types, handlers that only decode/delegate/map-status-code, `pool.Begin` + `defer tx.Rollback(ctx)` + `tx.Commit(ctx)` for multi-statement writes (see `scheduledworkout.Create`), and `ON CONFLICT DO NOTHING` used exactly as `exercise.go` and `workoutsession.go` already use it.

---

## 4. Schema

One new table. Zero changes to any existing table.

### Migration `0003_coach_invite_codes` — planned text, not yet created as a file

```sql
-- V0.1 coach invite codes: athlete onboarding without manual bootstrap.
--
-- One coach owns exactly one reusable code per invite. Redemption creates
-- (or reconciles) an ATHLETE users row and a coach_athletes relationship.
-- The code is a capability, never a credential — Firebase Auth remains the
-- sole authentication authority. See
-- docs/athlete-onboarding-invite-codes-v0.1.md for full rationale.

CREATE TABLE coach_invite_codes (
    id          uuid PRIMARY KEY,
    coach_id    uuid NOT NULL REFERENCES users (id),
    code        text NOT NULL UNIQUE,
    description text NULL,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz NULL,
    created_at  timestamptz NOT NULL,
    CONSTRAINT coach_invite_codes_code_format_check
        CHECK (code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'),
    CONSTRAINT coach_invite_codes_description_check
        CHECK (description IS NULL OR length(btrim(description)) > 0),
    CONSTRAINT coach_invite_codes_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT coach_invite_codes_revoked_check
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- Serves GET /api/v1/invite-codes (caller's own codes, newest first).
CREATE INDEX coach_invite_codes_coach_created_idx
    ON coach_invite_codes (coach_id, created_at DESC);
```

Notes:

- **`code UNIQUE`** supplies the lookup index for preview/redeem; no second index needed.
- **No `status` column.** Status is derived once, in the service layer: `revoked_at IS NOT NULL → REVOKED`; else `expires_at <= now() → EXPIRED`; else `ACTIVE`. A persisted status column would drift the moment time passes.
- **No `max_redemptions`.** Reusable-by-default (#1) needs none. A nullable `max_redemptions integer` column is the natural, additive extension point if single-use is ever wanted for a specific invite — not needed now.
- **Storage is plaintext, deliberately.** The coach must be able to re-copy the code from the Invite Codes tab days later — a hash would make that impossible. This is a considered trade, not an oversight: the code grants a `coach_athletes` row and nothing else (§6), it never authenticates anyone, and it's expiring and revocable.
- **Down migration** will follow the `0002` convention: refuse (`RAISE EXCEPTION`) if `coach_invite_codes` holds any rows, matching "guarded, local-only, not a production rollback mechanism."
- **`verify_0003_coach_invite_codes.sql`** will mirror `verify_0002_planned_set_prescription.sql`'s read-only `\set ON_ERROR_STOP on` pattern: assert table presence, all four CHECK constraints, and the index.

None of these files are created yet, per this task's explicit scope fence.

---

## 5. API contracts

Base `/api/v1`, camelCase JSON, RFC 3339 UTC timestamps, the existing unified `{"error":{"code","message"}}` envelope. Role-not-permitted → `403`; caller has the right role but the resource isn't theirs → `404`, never `403` — matching the existing rule in `go-backend-api-contract-v0.1.md` §1 ("避免洩漏資源存在性").

### 5.1 Coach — behind `authn.Middleware` (unchanged)

**`POST /api/v1/invite-codes`**
```
→ { "description": "Fall squad", "expiresInDays": 30 }   // both optional; default 30, range 1–365

← 201
{ "id": "…", "code": "K7M29XR4T2", "description": "Fall squad",
  "status": "ACTIVE", "expiresAt": "2026-09-17T00:00:00Z",
  "revokedAt": null, "createdAt": "2026-08-18T00:00:00Z" }
```
`403` non-coach · `400` malformed JSON, `expiresInDays` out of range, `description` > 120 chars after trim.

**`GET /api/v1/invite-codes`** — caller's own codes, newest first, same shape as above, in an array. Includes expired and revoked rows (they're the audit trail — never deleted). `403` non-coach. No pagination, no filters: the list is pilot-sized and the UI filters/searches client-side, matching how `/coach/clients` already works.

**`POST /api/v1/invite-codes/{id}/revoke`** — sets `revoked_at = now()` if currently `NULL`; re-revoking is a `200` no-op, not a `409` — a double-tap must not look like an error. `404` if `{id}` is unknown **or** belongs to another coach (one indistinguishable response). `403` non-coach. `POST`, not `DELETE`: the row is deliberately retained, so `DELETE` would claim semantics this endpoint doesn't have.

### 5.2 Public — no middleware, first non-`/health`/`/ready` unauthenticated route

**`GET /api/v1/invite-codes/{code}/preview`**
```
← 200  { "code": "K7M29XR4T2", "coachName": "Coach Kao", "description": "Fall squad" }
← 404  { "error": { "code": "NOT_FOUND", "message": "invite code is not valid" } }
```
Unknown, malformed, expired, and revoked codes all produce the identical `404` (§2). Response carries no ids — no `coachId`, no invite `id` — only display strings.

### 5.3 Athlete — new `FirebaseOnlyMiddleware`, application `users` row optional

**`POST /api/v1/invite-codes/{code}/redeem`**
```
Authorization: Bearer <Firebase ID token>
→ { "name": "Kevin Chen" }                 // required only when a new users row is being created

← 200
{ "user":  { "id": "…", "name": "Kevin Chen", "role": "ATHLETE" },
  "coach": { "name": "Coach Kao" } }
```
This is decision #7/#8's endpoint. It cannot sit behind `authn.Middleware`, which `401`s exactly the caller state every new athlete is in. `authn.go` gets a second, narrower middleware:

```go
// authn
type Identity struct {
    UID   string
    Email string // from the verified token; not persisted anywhere in V0.1
}

type IdentityVerifier interface {
    VerifyIdentity(ctx context.Context, idToken string) (Identity, error)
}

// FirebaseOnlyMiddleware verifies the Firebase ID token and attaches
// Identity to the context. Unlike Middleware, it does NOT require a users
// row — this is the only route that needs that relaxation. Missing/invalid
// tokens still 401.
func FirebaseOnlyMiddleware(v IdentityVerifier) func(http.Handler) http.Handler

func IdentityFromContext(ctx context.Context) (Identity, bool)
```

`firebaseVerifier` (the existing concrete type backing `NewVerifier`) implements both `TokenVerifier` and `IdentityVerifier` — same underlying `VerifyIDToken` call, two thin interfaces over it. **`Middleware` and every route behind it are unmodified.** This is the entire authn-package diff for this feature.

Identity is derived **only** from the verified token (Firebase UID) plus server-side state (the invite row's `coach_id`; the role, which is hard-coded `'ATHLETE'` in the one INSERT this endpoint can perform). `name` in the request body is display profile data used **only** when a brand-new `users` row is being created — never used to overwrite an existing row's name, and never treated as identity. Required, trimmed, 1–80 chars, only when creation happens.

### 5.4 Coach-side removal — new, behind `authn.Middleware`

**`DELETE /api/v1/athletes/{athleteId}`**

```
← 204   (no body)
← 404   unknown athleteId, or not connected to the caller
← 403   non-coach
```

Deletes exactly the `(caller.id, athleteId)` row from `coach_athletes`. Implemented as a single `DELETE … RETURNING coach_id`, which doubles as the existence/ownership check — 0 rows returned means "not connected," mapped to `404`, matching the existing "resource-scoping, not a role check" pattern used by `GET /scheduled-workouts?athleteId=`.

**What it explicitly does not do**, per decision #10: it never deletes the `users` row, never touches Firebase, and never cascades into `scheduled_workouts` / `workout_sessions` / `set_logs`. Historical training data is frozen-snapshot by design (`AGENTS.md` §5) and stays exactly as it is.

**A finding worth stating precisely, not glossing over**: `scheduledworkout.ListForAthlete` (§3 above) filters on `athlete_id` alone — it does not re-check `coach_athletes`. So a removed athlete's Today view **still shows previously-scheduled workouts from the removed coach** (past and any already-scheduled future dates) after removal. This is correct and intended, not a bug to fix here: it's the same frozen-snapshot principle that keeps a workout template edit from retroactively changing history. What removal actually cuts off is *forward-looking*: the athlete drops out of the coach's `GET /api/v1/athletes` list, and `POST /api/v1/scheduled-workouts` for that athlete/coach pair now fails with the existing `ErrAthletesNotConnected` → `403`, exactly as it would for any never-connected athlete. Calling this out explicitly in this doc means it can't later be mistaken for a leak.

Repeated `DELETE` (double-tap, or two coaches racing) is safe: second call finds 0 connected rows → `404`. This is standard REST idiom for a resource that's gone, not modeled as idempotent-`204` the way revoke is idempotent-`200` — revoke's target is a still-existing row with a settable flag; a `DELETE`'s target, once gone, is gone.

### 5.5 Authorization matrix addition

| Endpoint | Coach | Athlete | Firebase-only (no row) | Anonymous |
|---|---|---|---|---|
| `POST /invite-codes` | ✅ own | 403 | 401 | 401 |
| `GET /invite-codes` | ✅ own | 403 | 401 | 401 |
| `POST /invite-codes/{id}/revoke` | ✅ own · 404 other | 403 | 401 | 401 |
| `GET /invite-codes/{code}/preview` | ✅ | ✅ | ✅ | ✅ |
| `POST /invite-codes/{code}/redeem` | 403 | ✅ idempotent | ✅ creates row | 401 |
| `DELETE /athletes/{athleteId}` | ✅ own · 404 other | 403 | 401 | 401 |

### 5.6 Rate limiting

Preview and redeem are the only publicly reachable domain routes. Both get a per-IP token bucket via `golang.org/x/time/rate` — already an **indirect** dependency of `go.mod` today (pulled in transitively), so promoting it to direct costs no new download and no new infrastructure, matching the instruction not to introduce a large dependency for this. Suggested: preview 20 req/min, burst 10, per IP; redeem 10 req/min, per IP. Over limit → `429` (needs adding to the contract doc's error-code table, which currently stops at `500`).

**Accepted limitation, stated explicitly rather than assumed away:** an in-process limiter is per-instance. On Cloud Run with N instances the effective ceiling is N× the configured rate, and it resets on cold start. Acceptable for a pilot behind ~50 bits of code entropy; not a guarantee that would hold at real scale. No Redis or external rate-limit service is introduced for MVP.

---

## 6. Auth / onboarding state machine

```
  ANONYMOUS ──opens /join/{code} or enters code at /join──▶ GET …/{code}/preview
                                                                │           │
                                                          200   │           │  404
                                                                ▼           ▼
                                                         CONFIRMING     INVALID CODE
                                                        (coach name,    → back to /join
                                                        description)
                                                                │ Continue
                                                                ▼
                                              AUTHENTICATING (embedded on /join/[code])
                                              ── Create account (Firebase createUser…)
                                              ── or Sign in (Firebase signIn…)
                                                                │ Firebase succeeds
                                                                ▼
                                   FIREBASE-ONLY — verified token, users row may not exist yet.
                                   Every other API route still 401s this caller. Resumable:
                                   the code lives in the URL, not in any client state.
                                                                │ POST …/{code}/redeem
                                                                ▼
        ┌─────────────────────────── one transaction ───────────────────────────────┐
        │ 1  load invite by normalized code                                          │
        │      missing / expired / revoked ─────────────────────────────────► 404    │
        │ 2  INSERT INTO users (…, role='ATHLETE') ON CONFLICT (firebase_uid)         │
        │      DO NOTHING RETURNING id                                                │
        │      ├ 1 row  → new athlete created, name from request body                 │
        │      └ 0 rows → SELECT users WHERE firebase_uid = $uid (already existed)    │
        │            ├ role = ATHLETE → reuse; name/role never overwritten            │
        │            └ role = COACH   → ────────────────────────────────────► 403     │
        │ 3  INSERT INTO coach_athletes (coach_id, athlete_id)                        │
        │      ON CONFLICT DO NOTHING                                                 │
        │ 4  COMMIT                                                                   │
        └───────────────────────────────────┬─────────────────────────────────────────┘
                                             ▼
                                   ONBOARDED → router.replace("/today")
```

### Every branch

| Situation | Result | Why |
|---|---|---|
| Missing / invalid / expired Firebase token | `401 UNAUTHENTICATED` | Same envelope as every other route |
| Unknown, malformed, expired, or revoked code | `404` "invite code is not valid" | One response — no enumeration oracle (§2) |
| Valid token, no `users` row | `200`, ATHLETE row created | The only request-driven user-creation path in the system |
| Repeat redeem, same code, same athlete | `200`, no-op | Decision #9 — a double-tap must not look like an error |
| Athlete already connected to this coach, different code from the same coach | `200`, relationship untouched | Same idempotency, via `coach_athletes`'s composite PK |
| Athlete redeems a **different** coach's code | `200`, second relationship added | `coach_athletes` is N:N by design; `ListForAthlete` already aggregates across coaches with no change needed — multi-coach is preserved for free |
| COACH account redeems any code | `403` "a coach account cannot redeem an invite code" | Role is never silently changed or dual-purposed |
| Coach redeems their own code | `403`, same path | A coach's application user is COACH-role by construction, so this is fully covered by the role check above — no separate guard needed |
| Two concurrent redeems, same brand-new Firebase UID | Both `200`, exactly one `users` row | `firebase_uid UNIQUE` (already in `0001`) + `INSERT … ON CONFLICT (firebase_uid) DO NOTHING RETURNING id` + fallback `SELECT` inside one transaction — a single well-known safe pattern, no manual retry loop |
| Code revoked mid-request | Either outcome (succeeds-just-before or 404s-just-after) is correct | Revocation is forward-only by design (#3); not a hard boundary against an in-flight request, so no row lock is needed |
| Redeem succeeds, client never sees the response (network drop) | Retry returns `200` | Idempotency (#9) is exactly what makes the mobile flow resumable |
| Athlete abandons after Firebase signup, before redeem | Stuck in FIREBASE-ONLY | Returning to the same `/join/{code}` URL (or `/join` + manual entry) and completing auth resumes cleanly — the code was never in client memory alone |

---

## 7. Frontend IA

Routes, components, and state transitions, in the existing visual language (slate-950 header band, teal-300 eyebrow, stone-100 ground, `rounded-3xl` white cards with `ring-1 ring-slate-950/5`, `min-h-14` touch targets, teal-600 primary action). No TeamBuildr density, no new nav item — Clients stays exactly where it is, reached from the `/coach/calendar` header row.

### 7.1 `/coach/clients` — Athletes tab (default)

- Extends the existing `apps/web/app/coach/clients/page.tsx`. Tabs are `?tab=athletes|codes` in the URL, so a tab is linkable and survives refresh — not component-local state.
- Header gains a primary action button: **`+ Invite Athletes`** (opens the create modal, §7.3, from either tab).
- Table (real `<table>` from `sm:` up; the existing avatar-card list below `sm:`, since the current design is `max-w-lg` mobile-first everywhere): **Name · Status · Actions**. Status is a static **Connected** chip (decision: no "Joined" date, §2). Actions: **Remove** → confirm dialog → `DELETE /api/v1/athletes/{athleteId}` → optimistic row removal.
- Search: plain client-side substring filter over `name`, above the table. `GET /api/v1/athletes` already returns the full list; no query param, no contract change.
- Empty state: "No athletes yet. Create an invite code and send the link." + the same `+ Invite Athletes` action.
- Row click keeps its current behavior — navigates into `[athleteId]` for the training timeline (unchanged).

### 7.2 `/coach/clients` — Invite Codes tab

- New component, `apps/web/app/coach/clients/invite-codes-panel.tsx`, rendered when `?tab=codes`.
- Table: **Description · Join Code · Expires · Status · Actions**. Status pill: `ACTIVE` (teal), `EXPIRED` (slate), `REVOKED` (rose) — derived client-side from the same three fields the service derives server-side (§4), never persisted redundantly.
- Row actions: **Copy link**, **Copy code**, **Revoke** (confirm dialog for active codes only; a no-op button once already revoked/expired).
- `GET /api/v1/invite-codes` on tab mount; re-fetch after create/revoke.

### 7.3 Create Invite Code (modal)

- Description (optional, plain text input, helper copy: "Athletes see this when they open the link.")
- Expiration: segmented control, `7 / 30 / 90` days, **30 pre-selected** (decision #2). No group/calendar field (decision #13).
- `Cancel` / `Create invite` (teal-600, `min-h-14`) → `POST /api/v1/invite-codes` → on success, transitions to §7.4 in place (not a route change) → list re-fetched on close.
- Standard modal a11y: focus trap, `Esc` closes, focus returns to the `+ Invite Athletes` trigger on close.

### 7.4 Invite-created state

- Same modal, success view: large monospace **Join Code** (`XXXXX-XXXXX`), **Invite Link** (`${location.origin}/join/${code}`, composed client-side per §2), **Copy link** / **Copy code** buttons (label flips to "Copied ✓" for ~2s; `navigator.clipboard` with a select-the-text fallback for non-secure contexts).
- One line of context: "Expires {date} · {description}". Closing footer: "Send it over LINE, WhatsApp, or email." + `Done`.

### 7.5 `/join` — manual code entry (new)

- Unauthenticated route. Slate-950 header: "Join your coach." Single input, Geist Mono, ≥20px, `autoCapitalize="characters"`, `autoComplete="off"`. Normalizes as the athlete types (uppercase; strips spaces/hyphens; maps `I/L → 1`, `O → 0`) — mirrors the server-side normalizer so a copy-pasted lowercase code with hyphens still works.
- `Continue` → `router.push("/join/" + normalizedCode)`.
- Small "Already have an account? Sign in" link — routes to the existing `/login` (this is the one legitimate path back into the shared login page from onboarding).

### 7.6 `/join/[code]` — preview → confirm → auth → redeem → Today (new)

One route, one client component, stepped local state — **no navigation away for auth**, which is what makes "login-return-to-invite" a non-problem instead of a redirect-param feature:

1. **Loading** → `GET /api/v1/invite-codes/{code}/preview` (via a new unauthenticated `publicApiFetch` in `lib/api.ts`, sharing the existing `ApiError` envelope/parsing).
2. **Invalid** (`404`) → "This code isn't valid. It may have expired or been revoked. Ask your coach for a new link." + `Enter another code` → `/join`.
3. **Confirming** (`200`) → "You're joining" + initials avatar + coach name + description → `Continue` / `Use another code`.
4. **Authenticating** — inline toggle, both paths present on one screen, matching the target UX's "Login *or* Create Account":
   - **Create account**: name, email, password (min 8 chars, `autoComplete="new-password"`) → `createUserWithEmailAndPassword` (new `signUp()` in `auth-context.tsx`, mirroring the existing `signIn()` — returns a fresh ID token directly from the credential rather than racing `onIdTokenChanged`, same pattern already used by `signIn`).
   - **Sign in**: email, password → existing `signIn()`.
   - Coach/description context stays visible above the form the whole time — the athlete never loses the thread.
5. **Redeeming** → `POST /api/v1/invite-codes/{code}/redeem` with the fresh ID token and (if a new account) the entered name.
   - `200` → **Onboarded**: brief confirmation ("You're connected to Coach Kao") → `router.replace("/today")`. `replace`, not `push` — back from Today must not land back in the join flow.
   - Failure → resumable inline error + retry; the athlete keeps their Firebase session, so retry just re-calls redeem (idempotent per #9) rather than repeating auth.

### 7.7 `/login` — defensive fix, independent of the join flow

- Add a small "Have an invite code? Join a coach" link → `/join`.
- Fix the existing dead end: today, a `401` from `GET /api/v1/me` after a successful Firebase sign-in renders a generic "Sign in failed. Please try again." with no way out, because that combination was previously unreachable (no signup existed). It becomes reachable once athletes can create Firebase accounts through `/join/[code]`. Route that specific `401` case to a message that points at `/join` instead of a dead-end retry.

### Mobile constraints — first-class, not an afterthought

- Every control `min-h-14`, matching Today/Session. Inputs ≥16px (the code field explicitly larger) so iOS Safari doesn't zoom on focus.
- `pt-[max(1.5rem,env(safe-area-inset-top))]` / `pb-[max(2rem,env(safe-area-inset-bottom))]` on `/join` and `/join/[code]`, matching every existing page.
- The flow must work cold, inside a chat app's in-app browser (LINE/WhatsApp), with no prior session. This is the concrete reason decision #6 defers Google/Apple sign-in for now: `signInWithPopup` is unreliable inside those webviews, and a correct fix needs `signInWithRedirect` plus authorized-domain configuration — real work, not a checkbox, and out of scope here.
- Code entry tolerates lowercase, hyphens, and stray spaces (§7.5); nobody should fail to join because they typed `o` instead of `0`.

---

## 8. Security invariants

Each should be a named test.

1. **Identity comes only from the verified Firebase ID token.** `firebaseUid`, `userId`, `coachId`, and `role` are never read from a request body or query string on any new endpoint. The redeem body carries exactly one field (`name`), used only for row creation.
2. **Redeem is the only normal, HTTP-reachable path that creates or reconciles an athlete application user**, and it hard-codes `role = 'ATHLETE'`. Role is never a client input. (The operator-run `bootstrap` CLI job, §1, is a separate, non-HTTP, manifest-driven provisioning mechanism for initial pilot seeding — it is not reachable by any endpoint and is out of scope for this invariant's threat model.)
3. **Role is never mutated by redemption.** A COACH's row can never be turned into an ATHLETE by this endpoint, and vice versa.
4. **An invite belongs to exactly one coach**, set from the authenticated caller at creation; there is no update path that reassigns it.
5. **The invite code is not an authentication credential** (#4). It never establishes a session and is never compared against a password.
6. **Possession of a code yields only a coach display name and description** via preview — no ids, no roster, no other athlete's data.
7. **`FirebaseOnlyMiddleware` and `preview` are the only routes outside `authn.Middleware`** besides `/health`/`/ready`. Adding them changes zero existing routes — regression-test this explicitly.
8. **Uniform `404`** for unknown / malformed / expired / revoked codes, on both preview and redeem, plus per-IP rate limiting on both.
9. **Coach-scoped resources 404, not 403, when owned by another coach** — matching the existing privacy rule, applied to revoke and to the new `DELETE /athletes/{athleteId}`.
10. **All authorization decisions live in the service layer** (`internal/invitecode`), never in the handler or a SQL WHERE clause alone — matches every existing package.
11. **No plaintext passwords, no second auth system, no join-password pair.** The stored plaintext *code* is a deliberate, documented exception (§4) justified by the re-display requirement — it is a capability, not a secret, and grants nothing beyond one `coach_athletes` row.
12. **Removal never deletes a `users` row or touches Firebase** (#10) — verified by an integration test that asserts the row and the athlete's own historical sessions survive a `DELETE /athletes/{athleteId}`.
13. **Joining grants no read access to any other athlete.** `GET /me/scheduled-workouts` resolves the athlete from the token alone; session routes `404` for anyone who is neither the session's athlete nor a connected coach — unchanged by this feature, re-verified as a regression check.
14. **`FIREBASE_AUTH_EMULATOR_HOST` must stay unset outside local development.** Already documented in the README; worth re-confirming once `/join/{code}/redeem` becomes the first genuinely public write path.

---

## 9. Migration plan

- **Purely additive**: one new table, zero changes to any existing table (§2, §4). No backfill needed anywhere.
- `0001` and `0002` are never edited (`AGENTS.md` §12; deployment doc's "fail on changed historical migration content" rule).
- **Down migration guarded**, matching `0002`'s convention: refuses via `RAISE EXCEPTION` if `coach_invite_codes` holds any rows. Local convenience only, never a production rollback path.
- **Verify script** (`verify_0003_coach_invite_codes.sql`): read-only, `\set ON_ERROR_STOP on`, asserts the table, all four CHECK constraints, and the index exist.
- **Local proof required before merge**: apply `0001 → 0002 → 0003` against a clean database, run the verify script, run the guarded down, re-apply.
- **Migration-loader naming compatibility, checked against real code**: `origin/claude/perf-coach-phase-0-inspection-ao1t2v`'s `internal/migrate.Load()` selects applied migrations with the regex `^(\d{4}_[a-zA-Z0-9_]+)\.up\.sql$`, deliberately excluding sibling `.down.sql` and `verify_*.sql` files from the applied sequence. `0003_coach_invite_codes.up.sql` / `.down.sql` / `verify_0003_coach_invite_codes.sql` (§4) already follow that exact convention, so this migration will be picked up correctly by the real `migrate` runner whenever that branch (or its equivalent) becomes the implementation base — no naming change needed.

Ordered deployment (when this feature ships):

1. Apply `0003`, either by hand against Neon (`origin/main` has no migration runner yet) or via the `migrate` entrypoint if the implementation base includes it (§1) — safe ahead of any other code since it's purely additive.
2. Deploy the API (adds routes; touches no existing route or response shape).
3. Deploy the web app.
4. Smoke test: coach creates a code → athlete redeems from a phone → athlete lands on Today → coach sees the new row in Clients → coach removes the athlete → athlete's Today still shows prior history, coach's list no longer shows them.

Rollback is forward-only. If redemption misbehaves in production, revoke every outstanding code (one `UPDATE`) rather than reversing schema.

---

## 10. Implementation phases

### Backend

| Phase | Scope | Files | Verification |
|---|---|---|---|
| **B1** | Migration `0003` + down + verify script + schema doc update | 4 | Apply to a clean DB; verify script passes; guarded down refuses with rows present |
| **B2** | Code generator + normalizer (pure, no DB) | 2 | `go test`: alphabet, length, uniform-distribution smoke, normalization of `I/L/O`/hyphens/whitespace/lowercase |
| **B3** | `invitecode` service: `Create`, `ListForCoach`, `Revoke`, status derivation | 2 | Integration: coach-scoping, `404` on another coach's id, idempotent revoke, status at the expiry boundary |
| **B4** | Coach HTTP routes + error mapping | 2 | Happy path, `403` athlete, `400` bad `expiresInDays`, `404` foreign id |
| **B5** | `authn`: `Identity`, `IdentityVerifier`, `FirebaseOnlyMiddleware` | 2 | Unit tests with a fake verifier; assert existing `Middleware` behavior is byte-identical (regression) |
| **B6** | `Preview` + `Redeem` (transaction, user reconcile, relationship) | 3 | Full §6 branch table + a concurrent-redeem test (two goroutines, same new UID) |
| **B7** | `DELETE /athletes/{athleteId}` + rate limiter + contract doc updates | 4 | `204`/`404`/`403`; removed-athlete Today-history-survives test; `429` after burst |

**B1 → B5 is the natural first PR**: schema plus full coach-side invite management, independently usable and testable. **B6 → B7 is the athlete-side PR.** Frontend F1–F3 can start once B4 lands, in parallel with B5.

### Frontend

| Phase | Scope | Depends on |
|---|---|---|
| **F1** | Clients page: `?tab=` shell, Athletes table (Name/Status/Actions), client-side search, responsive card fallback below `sm:` | B7 (needs `DELETE /athletes/{id}` for the Remove action) |
| **F2** | Invite Codes tab: list, status pills, copy code/link, revoke with confirm | B4 |
| **F3** | Create modal + created state; a11y (focus trap, `Esc`, focus return) | B4 |
| **F4** | `/join` and `/join/[code]`: entry, preview, confirmation | B6 |
| **F5** | Embedded auth step (`signUp` in `auth-context.tsx`) + redeem + onboarded state + `router.replace("/today")` | B6 |
| **F6** | `/login`: "Have an invite code?" link + the 401-dead-end fix | B6 |

---

## 11. Exact files likely to change

`AGENTS.md` §7 caps a single task at ~5 files; this feature is ~19, which is exactly why §10 above splits it into B1–B7/F1–F6 phases, each independently under or near that budget.

### Backend

- `apps/api/migrations/0003_coach_invite_codes.up.sql` — new
- `apps/api/migrations/0003_coach_invite_codes.down.sql` — new, guarded
- `apps/api/migrations/verify_0003_coach_invite_codes.sql` — new
- `apps/api/internal/invitecode/invitecode.go` — new: `Create`, `ListForCoach`, `Revoke`, `Preview`, `Redeem`, status derivation
- `apps/api/internal/invitecode/code.go` — new: `crypto/rand` generator + normalizer
- `apps/api/internal/invitecode/code_test.go` — new: pure unit tests, no DB
- `apps/api/internal/invitecode/invitecode_integration_test.go` — new: the §6 branch table
- `apps/api/internal/authn/authn.go` — add `Identity`, `IdentityVerifier`, `FirebaseOnlyMiddleware`, `IdentityFromContext`; existing `Middleware` untouched
- `apps/api/internal/authn/authn_test.go` — new: fake verifier, no live Firebase
- `apps/api/internal/athlete/athlete.go` — add `Remove(ctx, pool, caller, athleteID)` for `DELETE /athletes/{id}`
- `apps/api/internal/httprate/httprate.go` — new: per-IP limiter over `x/time/rate`
- `apps/api/main.go` — 6 new routes (5 invite-code + 1 delete), 2 middleware wirings, error-code mapping
- `apps/api/go.mod` — `golang.org/x/time` indirect → direct

### Frontend

- `apps/web/app/coach/clients/page.tsx` — tabs, header action, search, table, Remove action, modal wiring (largest single change)
- `apps/web/app/coach/clients/invite-codes-panel.tsx` — new
- `apps/web/app/join/page.tsx` — new
- `apps/web/app/join/[code]/page.tsx` — new
- `apps/web/lib/auth-context.tsx` — add `signUp(email, password)`, mirroring `signIn`
- `apps/web/lib/api.ts` — add `publicApiFetch` (no `Authorization` header), sharing `ApiError`
- `apps/web/app/login/page.tsx` — "Have an invite code?" link; route the `/me` 401 to `/join`

`apps/web/app/coach/calendar/page.tsx` needs **no change** — the Clients nav button already exists.

### Docs — required by `AGENTS.md` §17 once the corresponding code phase lands, not before

- `docs/mvp-specification.md` — replace "Deferred — Not Yet Specified: Client Invite / Onboarding" with the decided flow + acceptance criteria
- `docs/frontend-ui-spec.md` — add `/join`, `/join/[code]`; update the `/coach/clients` row and §4's deferred list
- `docs/go-backend-api-contract-v0.1.md` — new §3.10; update §4 matrix, §5 target tables, error-code table (`429`)
- `docs/database-schema-relationships.md` — §2, §3, §6, §7
- `README.md` — note the `0003` migration in the manual-apply step

---

## 12. Tests & acceptance criteria

### Go unit — no database

- Generated codes: correct length, alphabet-only, no ambiguous characters; 10k samples, zero duplicates.
- Normalizer: `"k7m2q-9xr4t"`, `"K7M2Q 9XR4T"`, `"K7MZQ-9XR4T"` → identical stored form; `I/L → 1`, `O → 0`.
- Status derivation across the revoked/expired/active boundary, including `expires_at == now()`.
- `FirebaseOnlyMiddleware` with a fake verifier: valid token → `Identity` in context; missing/malformed/rejected tokens → `401`.

### Go integration — gated on `TEST_DATABASE_URL`, following the existing convention

- Create returns a unique code; another coach's `List` never contains it.
- Revoke is idempotent; revoking another coach's code → `404`.
- Preview: active → `200`; expired, revoked, unknown, malformed → `404`, identical bodies.
- Redeem, brand-new Firebase identity → `users` row created with `role='ATHLETE'`, name from the body; `coach_athletes` row created.
- Redeem twice → `200` twice, exactly one `users` row, one relationship.
- Redeem as an existing ATHLETE → name and role unchanged.
- Redeem as a COACH → `403`; no rows written.
- Redeem an expired code and a revoked code → `404`; no rows written.
- Two goroutines redeeming concurrently for the same new UID → both `200`, exactly one `users` row.
- An athlete connected to coach A redeems coach B's code → two relationships; `GET /me/scheduled-workouts` returns both coaches' work (multi-coach regression).
- `DELETE /athletes/{athleteId}`: removes the relationship; the athlete's `users` row and their historical `workout_sessions`/`set_logs` are untouched; a subsequent `GET /athletes` by that coach no longer lists them; a subsequent `POST /scheduled-workouts` for that pair → `403` (`ErrAthletesNotConnected`, existing behavior).
- **Regression**: every existing endpoint's authorization behavior is unchanged after the `authn` package change (rerun the full existing test suite, assert no diffs in expectations).

### Manual acceptance — there is no frontend test runner in this repo today

1. Coach signs in → Clients → Invite Codes → Create (default 30 days) → sees code and link → copies the link.
2. Fresh mobile browser profile opens the link → sees "You're joining Coach Kao" with the description.
3. Registers with a new email → lands on `/today` → sees the "No Workout Today" empty state, not an error.
4. Coach refreshes Clients → the new athlete appears, status **Connected**.
5. Coach schedules a workout to them from Calendar → athlete refreshes Today → the workout is there. **This closes the full lifecycle and is the real acceptance gate.**
6. Coach removes the athlete from Clients → athlete's Today still shows the previously scheduled workout (§5.4's documented behavior, not a bug) → coach's Clients list no longer shows the athlete → coach cannot schedule new workouts to them.
7. Revoke the code → open the same link again → "This code isn't valid."
8. An already-joined athlete opens the revoked link → still joined, nothing lost.
9. Sign out mid-registration, reopen the link, sign in with the same account → redeem completes, no duplicate relationship.
10. A coach account opens a join link → clear message, nothing corrupted.

**Definition of done** (`AGENTS.md` §15–16): `go fmt ./...`, `go vet ./...`, `go test ./...` (integration included, `TEST_DATABASE_URL` set), `npm run lint`, migration proven from a clean database, the five canonical docs in §11 updated in the phase that lands the corresponding code, diff reviewed.

---

## 13. Explicitly deferred

Confirmed out by the lock list (#13) and unchanged from the prior report: groups/teams, calendar assignment during onboarding, bulk athlete upload, SMS invitations, email-sending infrastructure, Apple Sign-In, coach self-signup, organization/admin hierarchy, multiple coaches per invite, analytics, athlete profile editing, native iOS/Android, archived-user management, TeamBuildr-style dense action-icon sets.

Deferred as a result of locking the decisions above, with the reason and the reopening cost:

| Deferred | Why now / cost to reopen |
|---|---|
| **Google Sign-In** | Not configured anywhere today (§3). Needs a production Firebase provider toggle + authorized domains (an `AGENTS.md` §13 production-config change), and `signInWithPopup` is unreliable inside chat-app webviews so it needs the redirect flow. Strongest fast-follow candidate — not a blocker. |
| **Email verification** | Firebase email/password signups are unverified by default; enforcing it would block the pilot. |
| **`coach_athletes.created_at` / "Joined" date** | Trivial additive column whenever wanted — dropped now purely to keep the migration to one new table (§2). |
| **Redemption-audit table** | Same reasoning — idempotency doesn't need it, and no spec'd UI column needs it yet. |
| **`max_redemptions` / single-use invites** | One nullable column plus a count check, whenever the product wants it — decision #1 doesn't foreclose it. |
| **Server-side athlete search/pagination** | Pilot rosters are small; client-side filtering avoids any contract change. |
| **Extending/editing an existing code** | Revoke and create a new one — two clicks, zero code. |
| **Distributed rate limiting** | In-process only, per-instance on Cloud Run — accepted pilot limitation (§5.6). |
| **Bootstrap tooling** (deployment D1b/D3) | Implemented (D1a/D1b) on `origin/claude/perf-coach-phase-0-inspection-ao1t2v`, not yet merged to `main`; D2–D6 actual execution against real Cloud Run/Neon remains unevidenced in any accessible ref (§1). Either way it's an operator/manifest tool for pilot seeding, not athlete self-service — this feature's redeem path is required regardless of whether/when that branch merges, and does not depend on or reuse bootstrap's HTTP-inaccessible code. |

---

Nothing in this document authorizes running a migration, mutating Neon or GCP, or deploying anything. It is the locked design for the phases in §10.
