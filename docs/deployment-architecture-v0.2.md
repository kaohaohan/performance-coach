# Deployment Architecture v0.2

Status: the v0.1 architecture below (hosting split, migration-job-only schema changes, forward-only rollback) remains **approved**. The v0.2 additions — phase reordering around the container image, per-entrypoint configuration, and the new Observability section (§12) — are **proposed**, pending review, because they introduce new acceptance criteria for D1b–D4 rather than only clarifying existing text. This document is the canonical deployment/runbook specification for future deployment tasks. It does not provision or deploy anything.

**Superseded by two ADRs (2026-08-18):** `docs/adr/ADR-001-use-neon-launch-postgresql-for-mvp-pilot.md` moves the database to **Neon PostgreSQL in `aws-ap-southeast-1` (Singapore)**, not Cloud SQL, and Cloud Run/Artifact Registry colocation moves from `asia-east1` to `asia-southeast1` accordingly. `docs/adr/ADR-002-stage-neon-free-before-launch-upgrade.md` further stages the rollout: **the initial D2 project is provisioned on the Free plan** for the current disposable-data internal-testing phase, with Launch required before an explicit trigger (primarily: before real athlete/coach data enters the system) — see ADR-002. This document has been reconciled to both decisions throughout; see the ADRs for the full rationale, trade-offs, and rollback/upgrade paths. Everything else in v0.1/v0.2 — hosting split, migration-job-only schema changes, forward-only rollback, Vercel frontend, Firebase Auth — remains unchanged.

## 1. Scope and principles

The pilot architecture optimizes for a small real-user release: simple operations, correct production boundaries, controlled cost, and hands-on learning of Docker, Cloud Run, managed PostgreSQL (Neon, per ADR-001), and production secrets. It preserves the current application split and does not add Kubernetes, Redis, a load balancer, VPC networking, replicas, HA, Terraform, or CI/CD in this architecture.

The product flow remains Coach → Workout → Schedule Athlete → WorkoutSession → SetLog → Coach Review. Deployment work must not change the API or database contracts without their normal approval process.

## 2. Current state

| Area | Current implementation |
| --- | --- |
| Web | `apps/web`, Next.js 16. Local default: `http://localhost:3000`. |
| API | `apps/api`, Go HTTP API. `PORT` defaults to `8080`. |
| Database | Local Docker PostgreSQL 16. Host port `5433`, container port `5432`. |
| Authentication | Firebase client SDK obtains ID tokens; Go Firebase Admin SDK verifies them. |
| Request path | Browser calls `/backend/*`; `apps/web/next.config.ts` rewrites to `BACKEND_BASE_URL`, defaulting locally to `http://localhost:8080`. |
| Schema | SQL migrations in `apps/api/migrations`; no automatic migration runner or production bootstrap tool exists yet. |

The API already reads `DATABASE_URL` and `FIREBASE_PROJECT_ID`, initializes Firebase Admin with the project ID, and therefore can use Application Default Credentials (ADC) on Cloud Run. It must not use a local service-account JSON in production.

## 3. Target architecture

```text
Browser / iPhone
        |
        | HTTPS
        v
Vercel: apps/web (Next.js)
        |
        | same-origin /backend/* external rewrite over HTTPS
        v
Google Cloud Run: apps/api (Go container)
        |
        | outbound TCP/TLS (postgres://, sslmode=require) — revised by ADR-001
        v
Neon: PostgreSQL (aws-ap-southeast-1)

Firebase Authentication supplies browser ID tokens.
GitHub remains source control.
```

Use `asia-southeast1` (Singapore) for Cloud Run, Cloud Run Jobs, and API-adjacent GCP resources, colocated with the Neon database region (`aws-ap-southeast-1`). **Revised from `asia-east1` by ADR-001** (2026-08-18) specifically to preserve API↔database colocation after the database moved to Neon; see §3.1. Artifact Registry may remain in `asia-east1` or move with the rest — image pulls happen at deploy time, not per request, so this is not latency-sensitive; record whichever is chosen when D3b-equivalent work resumes.

### Decisions

| Decision | Choice |
| --- | --- |
| Frontend | Vercel, rooted at `apps/web`. (v0.1, unchanged) |
| API | Docker image on Cloud Run, region `asia-southeast1`. (v0.1 choice of Cloud Run unchanged; region revised by ADR-001) |
| Database | **Neon PostgreSQL, `aws-ap-southeast-1` (Singapore) — Free plan initially, Launch required before ADR-002's trigger.** Revised from Cloud SQL `db-g1-small`/`asia-east1` by **ADR-001** (2026-08-18); staged by **ADR-002** (2026-08-18) — see §3.1 for the full rationale, cost comparison, SLA findings, and trade-offs. |
| Authentication | Firebase Auth; Go verifies Firebase ID tokens. (v0.1, unchanged) |
| Environments | `LOCAL` and `PRODUCTION/PILOT` only. (v0.1, unchanged) |
| API URL model | Keep the same-origin `/backend/*` abstraction. (v0.1, unchanged) |
| Deployment | Understand and perform a controlled manual backend deployment first; automate later. (v0.1, unchanged) |
| Cloudflare | Quick Tunnel for temporary local testing only; DNS/custom domain later. (v0.1, unchanged) |

### 3.1 Database hosting: Neon (supersedes the Cloud SQL D2 cost-gate decision)

**This section is superseded by two ADRs. Read both for the full rationale; this section is a condensed pointer, not a duplicate source of truth:**
- `docs/adr/ADR-001-use-neon-launch-postgresql-for-mvp-pilot.md` (2026-08-18) — Neon over Cloud SQL, region, Cloud Run colocation.
- `docs/adr/ADR-002-stage-neon-free-before-launch-upgrade.md` (2026-08-18) — **the initial D2 project is provisioned on the Free plan**, not Launch, for the current disposable-data internal-testing phase; Launch is a required upgrade gated on an explicit trigger (primarily: before real, non-recoverable athlete/coach data enters the system), not a day-one requirement.

**Current decision:** Neon PostgreSQL, `aws-ap-southeast-1` (Singapore) — **Free plan initially (ADR-002), Launch required before the trigger conditions in ADR-002 are met.** Cloud Run and its adjacent resources move to `asia-southeast1` to stay colocated (§3).

**Why it changed:** the prior Cloud SQL `db-g1-small` selection passed its D2 cost gate at ≈$28/month against a $100/month guardrail, but that is a **fixed, always-on** cost disproportionate to a mostly-idle, ≤50-user pilot. Neon Launch's usage-based, scale-to-zero pricing (compute $0.106/CU-hour at minimum 0.25 CU, storage $0.35/GB-month, no monthly minimum) is estimated at roughly $10–15/month for this workload — re-verify against Neon's calculator before provisioning, the same discipline previously applied to the Cloud SQL estimate below.

**Why Neon was previously rejected, and why that no longer applies:** the original rejection (recorded in the now-superseded text below) was a **latency** concern — Neon's nearest APAC region (Singapore) was far from `asia-east1`, where Cloud Run ran. That objection is resolved, not overridden, by moving Cloud Run to `asia-southeast1` alongside Neon (§3) — it was never a cost or capability objection.

**SLA correction found during re-evaluation:** Google's current Cloud SQL SLA text excludes not just shared-core instances but **all single-zone instances** from the Covered Service — *"Shared-core Instances, single-zone Instances, and read pools with 1 node are excluded from the Covered Service"* ([cloud.google.com/sql/sla](https://cloud.google.com/sql/sla)). The single-zone `db-g1-small` baseline therefore never had an SLA advantage over Neon to weigh against its fixed cost, correcting the shared-core-only framing below.

**Code portability confirmed by audit:** the only Cloud SQL-specific code is `isCloudSQLSocket()` in `apps/api/internal/db/dsn.go`; no connector dependency exists in `go.mod`; no code change is required to point at Neon. See ADR-001 for the full audit.

**Trade-offs accepted:** Taiwan→Singapore user latency if pilot users are Taiwan-based (moved from the API↔DB leg to the browser↔API leg — measure in D6, don't assume it away); Neon cold start on scale-to-zero; a second cloud provider (AWS-hosted Neon alongside GCP); reversibility is preserved either direction. Full detail in ADR-001.

<details>
<summary>Superseded text — the original D2 Cloud SQL cost-gate decision (2026-08-17), retained for history</summary>

**Result: PASSED (2026-08-17), with the baseline revised downward.** Approved ceiling USD 100/month — retained as an *approval guardrail, not an expected spend*. Selected configuration: **≈ USD 28/month**.

**Selected configuration:** `asia-east1`, PostgreSQL 16, Cloud SQL Enterprise edition, **`db-g1-small`** (shared-core, 1.7 GB RAM), single-zone, 10 GB PD-SSD with storage auto-growth, **automated backups and point-in-time recovery both enabled and mandatory**.

Backups and PITR were *not* weakened to reach this number. The shared-core audit confirmed both are fully supported on `db-g1-small` with no machine-type restriction.

**Cost basis.** Rates come from the live Cloud Billing Catalog API (`cloudbilling.googleapis.com`, service `9662-B51E-5089`) for `asia-east1`, effective 2026-08-17. SKU IDs are recorded so the estimate is reproducible:

| Component | SKU | Rate | Monthly (730 h) |
| --- | --- | --- | --- |
| `db-g1-small` instance | `D46D-EDAD-F725` | $0.035 / hour | $25.55 |
| PD-SSD storage (10 GB) | `9067-0A43-FDD8` | $0.17 / GiB-month | $1.70 |
| Backup / PITR storage | `2FAE-DAED-89EC` | $0.09 / GiB-month | ~$1–2 (variable) |
| **Total** | | | **≈ $28–29/month** |

**Tier comparison at the time of decision:**

| Tier | RAM | `max_connections` | Monthly | Outcome |
| --- | --- | --- | --- | --- |
| `db-f1-micro` | 0.6 GB | 25 | ≈ $10 | **Rejected** — see below |
| **`db-g1-small`** | **1.7 GB** | **50** | **≈ $28** | ✅ **Selected** |
| `db-custom-1-3840` | 3.75 GB | 100 | ≈ $52 | Deferred until triggers fire |

`db-f1-micro` was rejected on capacity, not price. With 25 `max_connections` (≈22 after superuser reservations) against a 14-connection budget, and only 0.6 GB RAM to hold `shared_buffers` plus 14 backends, it has minimal headroom and an out-of-memory event restarts the instance. The $18/month saving does not justify operating that close to the limit with real user data.

**Accepted trade-off: no SLA, burstable CPU.** Google documents `db-f1-micro` and `db-g1-small` as shared-core machine types outside the Cloud SQL SLA, intended for test and development. We consciously accept this for the pre-revenue pilot:

- The pilot is 2–3 coaches and ~30 athletes (≤50 users) with bursty, low-volume traffic; sustained CPU saturation is not the expected pattern.
- The architecture **already** accepts single-zone with no HA failover (§14), so this does not introduce a categorically new availability posture. It removes SLA credits and adds CPU throttling risk under sustained load.
- Data protection is unchanged: automated backups and PITR remain mandatory and are what actually protect against data loss.
- The dominant business risk at this stage is whether coaches adopt the product, not marginal availability nines.

**Upgrade path is an in-place tier change, not a provider migration.** Moving to `db-custom-1-3840` (or larger) later changes the `--tier` on the same Cloud SQL instance: same data, same DSN, same region, no `pg_dump`/restore and no cutover window. **The expected restart/downtime behaviour must be verified before performing the upgrade**, not assumed from this document.

**Evidence-based upgrade triggers.** Upgrade when measurement shows one of the following — explicitly *not* on a revenue or "first paying customer" milestone:

- Sustained CPU pressure or observed shared-core throttling under normal load.
- Sustained memory pressure, or any out-of-memory-driven instance restart.
- Connection saturation: usage approaching the 50-connection `max_connections` limit, or pool acquisition waits appearing under normal traffic.
- Database latency that is unacceptable for the core loop, attributable to the instance rather than the network path.
- A stated availability or SLA requirement that shared-core cannot satisfy.
- A materially increased workload (user count, concurrency, or data volume) beyond the pilot envelope this decision was sized for.

**Alternatives evaluated and rejected:**

- **Neon PostgreSQL** — rejected on region. Neon's Asia-Pacific regions are Singapore (`aws-ap-southeast-1`) and Sydney only; Taiwan, Tokyo, and Hong Kong are not offered. Taipei→Singapore is ~3,200 km, a ~32 ms round-trip physical floor and realistically 40–60 ms with routing plus a GCP→AWS cross-cloud hop, against ~1 ms for a same-region Cloud SQL Unix socket. The API issues several sequential statements per request, so a five-statement transaction moves from ~5 ms to 200–300 ms — a user-visible regression in the core logging loop. Neon Launch (≈ $7–15/month with scale-to-zero) is cheaper than the selected tier, but `db-g1-small` at ≈ $28/month retains same-region latency, the existing deployment architecture, and zero code change — which is judged the better trade at this scale. Neon remains the fallback if a future decision makes Cloud SQL untenable.
- **Cloudflare** — not a PostgreSQL option at all. D1 has SQLite semantics and would not support this schema's `uuid`/`timestamptz`/`numeric` types, partial indexes on `lower(name)`, or composite foreign keys; substituting it is precisely what `AGENTS.md` §5 forbids without an explicit architecture decision. Hyperdrive accelerates an existing PostgreSQL database from Cloudflare Workers and is irrelevant to a Go service on Cloud Run. Cloudflare's managed-PostgreSQL offering is a PlanetScale resale, i.e. a third provider carrying the same region question as Neon. §16 remains the full extent of Cloudflare's role.

**Lock-in assessment.** The decision is reversible, and that was verified rather than assumed. The codebase contains exactly one Cloud SQL-specific literal — the `/cloudsql/` prefix allowlist in `AssertSafeSSLMode` (`apps/api/internal/db/dsn.go`). There is no Cloud SQL connector dependency, no custom pgx dialer, no region literal in any Go file, and no `CREATE EXTENSION`, trigger, advisory lock, or `LISTEN`/`NOTIFY` in any migration. Migrating to another PostgreSQL host later is a configuration change plus a cutover window, not a rewrite; the real cost would be rebuilding the GCP-side configuration and repeating D2/D3, not moving the schema or data. **This lock-in assessment is what made ADR-001 possible to accept quickly** — the reversibility was verified in advance, not assumed at decision time.

**Deferred cost lever.** Committed-use discounts are 25% (1-year) and 52% (3-year) on vCPU and RAM, and apply to Enterprise edition — but **not to shared-core machine types**, so they are unavailable on `db-g1-small`. CUDs become relevant only if an upgrade trigger moves the pilot to dedicated-core; revisit then, not now. (Moot under the current Neon decision — CUDs are a Cloud SQL-specific lever.)

</details>

## 4. Frontend and network path

Production keeps the current request model:

```text
Browser → https://<vercel-host>/backend/* → Vercel rewrite → https://<cloud-run-host>/*
```

`apps/web/lib/api.ts` continues to send `Authorization: Bearer <Firebase ID token>` to `/backend/*`. Vercel's external rewrite proxies that request to Cloud Run while the browser remains same-origin.

Benefits:

- The browser has no cross-origin API call, so no production CORS policy is required for the normal application path.
- Existing client code and local routing stay stable.
- Firebase bearer-token forwarding is tested at one stable application URL.
- `BACKEND_BASE_URL` is server-side Vercel configuration; it is not exposed to browser code.

Requirements:

- Set Vercel production `BACKEND_BASE_URL` to the HTTPS Cloud Run service URL, with no trailing slash.
- Do not configure caching for `/backend/*`; external rewrites are proxy requests and API responses must remain user-specific.
- Explicitly test that Vercel forwards the `Authorization` header end-to-end.
- Do not set production values as Vercel Preview defaults. Preview deployments are not a staging environment and must not mutate production data.
- Future custom domains change the browser origin only; the `/backend` client contract remains unchanged.
- Measure the added latency of this hop. §15 requires cost to be measured rather than assumed; the same applies to round-trip time. The current implementation is a Next.js `rewrites()` **external rewrite** (`apps/web/next.config.ts`) — Vercel proxies it through its own routing/edge network rather than through a deployed Vercel Function, so there is no configurable "function region" to tune today. Measure the actual round-trip in D6 first; if it is poor, the available options are limited (Vercel project/region settings, or restructuring the proxy as a Function to gain a configurable execution region) and should be chosen from measured numbers, not assumed in advance.

Direct browser-to-Cloud-Run calls are deferred. They would require an explicit CORS allow-list and would expose a second API origin in client configuration without a current benefit.

## 5. Cloud Run API

Cloud Run is suitable for the existing Go API: it listens on `PORT`, exposes `/health` and `/ready`, accepts graceful shutdown, and has no VM-specific dependency. A future D1 container task must add `apps/api/Dockerfile` and a root `.dockerignore`, build from the repository context (`docker build -f apps/api/Dockerfile .`), and validate the image locally before cloud deployment.

### Invocation and application authorization

The Cloud Run service must permit unauthenticated **Cloud Run invocation** so Vercel can proxy browser traffic to it. This does not make protected application endpoints anonymous: the Go API remains responsible for verifying Firebase ID tokens and enforcing role/relationship authorization.

Do not try to protect the Cloud Run service itself with Cloud Run IAM while using browser Firebase tokens. Firebase ID tokens are application credentials, not Cloud Run invoker credentials. Keep only deliberately public operational endpoints such as `/health` minimal; all business routes retain Go authentication.

### The security boundary is the Go API, not Vercel

The Cloud Run service URL is publicly reachable by anyone who learns it. The Vercel rewrite is a convenience for the browser (same-origin, no CORS), **not** a security boundary: a client can call the Cloud Run host directly and bypass Vercel entirely. This is acceptable precisely because Firebase token verification and role/relationship authorization live in the Go API, which sees both paths identically.

Two consequences must be recorded rather than assumed:

- Nothing in v0.1/v0.2 provides rate limiting, at either layer. An unauthenticated caller can force token-verification work and consume Cloud Run instances up to the max-instance cap. This is an accepted controlled-pilot risk, bounded by the max-instance cap and the pilot's small user set.
- Any future protection (Cloud Armor, a shared secret header injected by the Vercel rewrite, WAF rules) must be applied at Cloud Run, not only at Vercel. See §17.

### Health endpoints and probes

The API exposes two distinct endpoints and they are not interchangeable:

| Endpoint | Meaning |
| --- | --- |
| `/health` | Process liveness only; deliberately does not touch PostgreSQL. |
| `/ready` | Re-pings PostgreSQL on every call (`handleReady` in `apps/api/cmd/api/main.go`) and returns 503 if it currently fails. It is a live check, not a one-time startup fact. |

Configure Cloud Run's probes explicitly instead of accepting its default TCP probe on `PORT`, which would report a process that cannot reach the database as healthy. Cloud Run's startup probe and container-level health checks are GA; a continuous, traffic-gating readiness probe is a Preview feature as of this writing — confirm current status before relying on it.

For the pilot, the explicit choice is: wire `/ready` as the **startup probe** only, gating the first traffic to a new revision. This is a deliberate scope limit, not an oversight — record it as such:

- **At boot**, `db.NewPool` in `apps/api/internal/db` pings the database and returns a fatal error on failure, so a revision that cannot reach the database on startup never receives traffic. This covers the common case (bad config, unreachable database at deploy time — Neon under the current decision, formerly Cloud SQL).
- **After startup**, a database outage mid-revision is *not* caught by a probe under this choice — the running instance keeps receiving traffic and individual requests fail with 5xx via normal error handling, rather than the instance being pulled from rotation. `/ready` still reports 503 correctly if polled manually or by an external monitor; it is just not wired as a continuous Cloud Run gate in v0.2.
- Evaluate the Preview readiness probe as a follow-up once it is confirmed stable (§17); it is deferred, not rejected, because relying on a Preview feature for the pilot's only failure-detection path is itself a risk.

### Initial scaling guardrails

Set these intentionally during D4 and revisit only with measured load:

| Setting | Initial value | Reason |
| --- | --- | --- |
| Minimum instances | `0` | Controlled pilot cost; accepts possible cold starts. |
| Maximum instances | `3` | Bounds database connections and surprise spend. |
| Concurrency | `20` | Modest concurrency for a small Go API; validate under pilot load. |
| Request timeout | Set explicitly after measuring normal longest request | Avoid relying on a console default. |

Cloud Run request-based services can scale to zero. When no instance is active, request CPU/memory charges stop; cold starts are the trade-off. Cloud Run is not the expected fixed-cost driver for this pilot.

## 6. Firebase production authentication and service identity

Use a dedicated, user-managed Cloud Run runtime service account. Let Firebase Admin obtain ADC from that Cloud Run service identity. The current `firebase.NewApp(... ProjectID ...)` initialization is compatible with this approach.

The runtime service account requires only the roles needed by the running API. **Under the current Neon decision (ADR-001), this no longer includes a Cloud SQL role**: Neon is reached over standard outbound TCP/TLS, not a Cloud SQL connector attachment, so there is no GCP-side database IAM grant to make. The runtime service account's remaining GCP-side need is:

- Secret Manager Secret Accessor, only for secrets mounted into the API (still includes `DATABASE_URL`, now a Neon connection string).

Create a separate migration-job service account with its own least-privilege database credential (a Neon role/password, granted at the database level, not GCP IAM) and only the cloud access it requires (Secret Manager access to read that credential). Do not rely on the default Compute Engine service account or broad Editor roles.

*(Historical note: the superseded Cloud SQL decision required `roles/cloudsql.client` here, to connect through the Cloud SQL connector. That grant is dropped, not merely unused, under the current decision.)*

Never commit, copy, mount, or bake a Firebase/GCP service-account JSON into the repository or container. Do not set `GOOGLE_APPLICATION_CREDENTIALS` in Cloud Run. Local development may use its existing safe local credential arrangement independently; its files remain outside version control.

In Firebase production setup, configure the production Firebase project/web app and ensure the Vercel hostname (and later custom hostname) is an authorized domain when Firebase Auth providers or email action flows require it. Google sign-in additionally requires the Google provider to be enabled under Authentication → Sign-in method, and the account-linking setting under Authentication → Settings to be **One account per email address**. That setting is what keeps an existing Gmail/password user on the same Firebase UID — and therefore the same `users.firebase_uid` and history — when they switch to Google; "Multiple accounts per email address" would mint a second Firebase identity and the invite flow would provision a duplicate `users` row. See `docs/tasks/2026-08-20-google-signin-account-continuity.md` §6. `NEXT_PUBLIC_FIREBASE_API_KEY` is a public Firebase web configuration value, not a server secret; restrict its API key and monitor quotas in Firebase/Google Cloud.

## 7. Neon database and connectivity

**Superseded by ADR-001 and ADR-002 (2026-08-18).** The database is **Neon PostgreSQL** in `aws-ap-southeast-1` (Singapore), not Cloud SQL — **Free plan initially, Launch required before ADR-002's trigger fires.** This section is rewritten to match; the prior Cloud SQL-specific connectivity text has been removed rather than retained as a toggle, since it described a GCP-managed connector mechanism (Unix socket, IAM-based attachment) that has no Neon equivalent — Neon is a standard TCP/TLS PostgreSQL endpoint, regardless of plan.

**Provision a Neon project on the Free plan for the current internal-testing phase** (ADR-002 — disposable test data, not real athlete records), in the `aws-ap-southeast-1` region, colocated with Cloud Run in `asia-southeast1` (§3). Free's 6-hour/1 GB-month PITR history does not meet this project's backup expectation for **real** data (ADR-001) — this is why the Launch upgrade is a required, triggered event (ADR-002 §"Upgrade trigger"), not an optional one. Do not treat Free as the permanent state; do not delay the Launch upgrade past its trigger.

Neon requires TLS on every connection; there is no non-TLS mode to reject the way Cloud SQL's `sslmode=disable` needed host-based gating. Use `sslmode=require` or `sslmode=verify-full` (Neon recommends `verify-full`) in the connection string, per [Neon's connection security docs](https://neon.com/docs/connect/connect-securely). `AssertSafeSSLMode` (`apps/api/internal/db/dsn.go`) already accepts any non-`disable` mode regardless of host — **no code change is required** for this; it was verified directly against Neon's DSN shape as part of ADR-001's code audit. The function's Cloud SQL Unix-socket allowance (`isCloudSQLSocket`, matching a `/cloudsql/` host prefix) becomes dead code under this decision; it is harmless to leave and optional to remove.

`DATABASE_URL` remains the application variable name and remains a Secret Manager-held secret. Its production value becomes Neon's issued connection string, e.g. `postgres://<user>:<password>@<endpoint>.<region>.aws.neon.tech/<db>?sslmode=require`. There is no GCP-side "attachment" step (no `--add-cloudsql-instances`, no Cloud SQL connector, no dedicated IAM role) — Cloud Run reaches Neon the same way any external HTTPS/TLS dependency is reached, over its default outbound networking. §6 records the resulting IAM simplification.

### Connection budget

`pgxpool.New`'s pinned pool configuration (`DefaultMaxConns` 4 for the API, `MaintenanceMaxConns` 2 for migrate/bootstrap — `apps/api/internal/db/db.go`) is unchanged by this decision; it is provider-agnostic. With Cloud Run maximum instances of three:

| Client | Connections |
| --- | --- |
| Cloud Run API (3 instances × pool `MaxConns` 4) | 12 |
| Migration **or** bootstrap job (`MaintenanceMaxConns` 2) | 2 |
| **Planned worst case** | **14** |

Neon Launch's default compute size supports at least this comfortably, but **verify Neon's actual `max_connections` (and note Neon also offers connection pooling via PgBouncer, not yet evaluated here) against the created project rather than assuming a figure carried over from the Cloud SQL estimate** — the Cloud SQL-specific `max_connections=50` figure previously recorded here was a Cloud SQL-derived number (from `db-g1-small`'s 1.7 GB RAM) and does not apply to Neon. Re-derive this when the Neon project is actually provisioned, and treat connection saturation as a trigger to revisit pool sizing regardless of provider (§3.1, ADR-001).

`pgxpool.New` without an explicit `Config` already applies pgx's own defaults for `MaxConnLifetime`, `MaxConnIdleTime`, and a periodic health check, so the pool is not entirely without eviction today. The requirement for D1b is not "add eviction that doesn't exist" but to **explicitly pin and verify** `MaxConns`, `MaxConnIdleTime`, and `MaxConnLifetime` for production rather than run on library defaults nobody has confirmed against the host database's own idle-connection behavior — under ADR-001 that is Neon's, not Cloud SQL's, and Neon's scale-to-zero/idle-suspend behavior is a materially different thing to verify against than Cloud SQL's always-on idle handling. Pin the values, then check under D6 load that Neon isn't closing or suspending connections faster than the pool retires them.

Also size the pool against the configured Cloud Run concurrency: at concurrency `20` and four connections per instance, up to sixteen in-flight requests can be waiting on a connection. That is acceptable for short CRUD queries but means database slowness turns into request queueing.

This queueing currently has no explicit upper bound. `main.go` does not set `http.Server.ReadTimeout`/`WriteTimeout`, and a handler's `r.Context()` is canceled on client disconnect or when the handler returns — not on a query simply taking too long. Cloud Run's own request timeout closes the client-facing connection when it expires, but that is not the same as a guarantee that the container stops the in-flight database work; whether it does depends on whether that closure is wired to cancel the request context. D1b should add an explicit deadline — a server-level request timeout, a per-handler `context.WithTimeout` around the database call, or both — so a slow query has a bounded worst case instead of an assumed one. Verify the chosen mechanism under D6 load rather than relying on incidental cancellation.

Do not scale Cloud Run above the agreed cap or raise the pool cap until connection usage, latency, and Neon's connection limits have been checked.

## 8. Configuration and secret inventory

No actual values belong in this document, source control, Docker image layers, logs, or frontend source maps.

| Variable / setting | Category | Production location | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | PUBLIC | Vercel production environment | Firebase web configuration. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | PUBLIC | Vercel production environment | Public Firebase API key; restrict it. |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | PUBLIC | Vercel production **and** Preview environments | Domain serving the Google sign-in popup handler (`<project>.firebaseapp.com`). Required for "Continue with Google"; unset locally, where the Auth Emulator serves its own handler. |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | LOCAL ONLY | Not set in Vercel production | Never point production browsers to an emulator. |
| `BACKEND_BASE_URL` | SERVER CONFIG | Vercel production environment | Cloud Run HTTPS URL; no trailing slash. |
| `DATABASE_URL` | SECRET | Secret Manager, injected into Cloud Run service and migration job | **Revised by ADR-001**: Neon connection string (`postgres://user:pass@<endpoint>.aws.neon.tech/db?sslmode=require`), not a Cloud SQL socket URL. |
| `FIREBASE_PROJECT_ID` | SERVER CONFIG | Cloud Run API service only; **not** the migration job | Production Firebase/GCP project ID; no credential JSON. The migration job does not authenticate users and must not require it — see §9. |
| `FIREBASE_AUTH_EMULATOR_HOST` | LOCAL ONLY | Not set in Cloud Run | Production must use Firebase's real token verification path. |
| `PORT` | PLATFORM CONFIG | Cloud Run supplies it | App default is `8080`; do not make it a secret. |
| ~~Cloud SQL instance connection name~~ | — | — | **Removed by ADR-001** — no GCP-side connector attachment exists for Neon; there is no connection-name value to configure. |
| Database migration credential | SECRET | Secret Manager, migration job only | Separate least-privilege DDL credential, now a Neon role/password rather than a Cloud SQL user. |
| API runtime database credential | SECRET | Secret Manager, API service only | Prefer a DML-only credential once D1b adds it. |

Use Secret Manager for secret material. When injecting a secret as an environment variable in Cloud Run, pin a numeric Secret Manager version rather than `latest`, then deliberately deploy a new revision when rotating it. Grant secret access to the exact runtime/job service account.

## 9. Schema migrations

Choose **an explicit Cloud Run migration Job** for this pilot.

The job uses the same immutable API image but a migration command/entrypoint. It runs one task with maximum retries set to `0`, uses the migration database credential, records applied migration versions/checksums, and exits. Run and verify it before directing production traffic to an API revision that requires the schema change.

This is intentionally not API startup migration: concurrent Cloud Run instances must never race to mutate production schema. It is also more explicit and observable than a hidden deploy-time side effect. Later CI/CD may invoke the exact same job after manual deployment has been understood.

### Required D1b migration tooling

The repository currently contains SQL migration files but no runner or schema-version tracking. D1b must add a reproducible migration command before production work begins. Its acceptance criteria include:

- ordered, transactional application where PostgreSQL supports it;
- an applied-version/checksum ledger;
- failure on changed historical migration content;
- a dry/local validation path against a clean PostgreSQL database;
- distinct API, migration, and bootstrap entrypoints;
- **per-entrypoint configuration requirements** (see below);
- bounded pool configuration including idleness and lifetime (see §7); and
- no automatic migration in API startup.

#### Per-entrypoint configuration

`config.Load` in `apps/api/internal/config/config.go` currently requires both `DATABASE_URL` and `FIREBASE_PROJECT_ID` and returns an error if either is missing. The migration job never verifies a user token and will not have `FIREBASE_PROJECT_ID` set (§8), so reusing this single loader would make the migration job fail to start for a variable it does not use.

Each entrypoint must therefore declare and validate only what it actually needs:

| Entrypoint | Required configuration |
| --- | --- |
| api | `DATABASE_URL`, `FIREBASE_PROJECT_ID` (`PORT` supplied by Cloud Run) |
| migrate | `DATABASE_URL` only |
| bootstrap | `DATABASE_URL`, plus its reviewed input manifest reference (§10) |

A single "everything is required" loader shared by all three is not acceptable. Validating configuration a component does not use converts an unused variable into a startup failure, and — worse in the other direction — encourages setting credentials on jobs that have no business holding them.

#### Repository structure

`main.go` currently sits at `apps/api/` with no `cmd/` directory, so "distinct entrypoints" is a module restructure, not a flag. D1b moves the API entrypoint to `apps/api/cmd/api` and adds `apps/api/cmd/migrate` and `apps/api/cmd/bootstrap`, leaving domain packages under `apps/api/internal` unchanged. D1b also extends the D1a Dockerfile to build all three binaries into the one immutable image; the Cloud Run service and each job then select among them by command, preserving the single-image decision above. Scope D1b estimates for this restructure — it touches the build, the Dockerfile, and every entrypoint's configuration path, not just the migration runner.

### Schema rollback posture

Production schema rollback is **forward-only** unless an explicitly reviewed recovery plan says otherwise. The existing `0001_init_schema.down.sql` drops all tables and must never be used as a normal production rollback. Use a compatible forward fix, or restore to a separate instance from point-in-time recovery when necessary.

## 10. Production bootstrap data

Schema migration, production bootstrap, and development fixtures are separate operations:

| Operation | Purpose | Production rule |
| --- | --- | --- |
| Schema migration | Creates/evolves tables, constraints, indexes | Migration job only. |
| Bootstrap | Creates intentional pilot records | Idempotent, reviewed job/command with an input manifest. |
| Development fixtures | Convenient local test data | Never copied wholesale to production. |

Initial pilot setup order:

1. Create or invite the pilot accounts in the production Firebase project.
2. Record the approved Firebase UIDs, names, and intended coach/athlete roles in a reviewed, non-secret bootstrap input.
3. Run an idempotent bootstrap operation that creates the corresponding `users` rows and approved `coach_athletes` relationships.
4. Verify each pilot user can authenticate and has only the intended relationship/access.

No system Exercise data is required merely to make the schema usable; create only intentionally approved exercises/workouts for the pilot. Bootstrap inputs must be auditable and must not contain passwords, ID tokens, service-account material, or arbitrary local fixtures.

## 11. First deployment workflow

Each item is a future, separately approved implementation/deployment task. Resource creation is not authorized by this document alone.

| Phase | Outcome and acceptance gate |
| --- | --- |
| D1a — container readiness | **Done.** `apps/api/Dockerfile` (multi-stage, `golang:1.26` builder → `gcr.io/distroless/static-debian12` runtime, `CGO_ENABLED=0`) and a root `.dockerignore` are in place; build context is the repository root (`docker build -f apps/api/Dockerfile .`). `.dockerignore` excludes `**/node_modules`, `apps/web/.next`, `apps/web/.next-mobile`, `apps/web/screenlog.*`, `.git`, `.env`, `.env.*`. Verified locally: image builds, container starts (`database connection verified` → `listening on :8080`), `/health` and `/ready` both return 200, and `SIGTERM` triggers graceful shutdown (`shutdown signal received`, clean exit within Cloud Run's grace period). Final image size ~54MB. D1b extends this Dockerfile to the migrate and bootstrap binaries once they exist. |
| D1b — production database tooling | **Done.** `apps/api/main.go` moved to `apps/api/cmd/api`; `apps/api/cmd/migrate` and `apps/api/cmd/bootstrap` added, all three built into the one D1a image (`apps/api/Dockerfile`). `internal/config` now exposes `LoadAPI`/`LoadMigrate`/`LoadBootstrap`, each validating only its entrypoint's variables (migrate/bootstrap never require `FIREBASE_PROJECT_ID`). `internal/db.NewPool` pins `MaxConns` (4 for api via `DefaultMaxConns`, 2 for migrate/bootstrap via `MaintenanceMaxConns`), `MaxConnIdleTime` (5m), and `MaxConnLifetime` (30m), and calls the new host-based `AssertSafeSSLMode` before connecting, refusing to start when `sslmode=disable` targets a host that is neither a `/cloudsql/` socket nor loopback. `cmd/api` adds an explicit request deadline (`http.TimeoutHandler`, 10s) plus `http.Server.ReadTimeout`/`WriteTimeout` as a transport-level backstop. `internal/migrate` embeds `apps/api/migrations/*.up.sql` (`migrations/embed.go`), applies them in order with a `schema_migrations` version/checksum ledger, and refuses to proceed if an already-applied migration's on-disk content has changed; verified against a clean local database in `internal/migrate/migrate_integration_test.go` (apply-from-empty, idempotent re-run, tampered-checksum refusal), all passing against the local Postgres 16 container. `internal/bootstrap` validates a reviewed JSON manifest (`DisallowUnknownFields`, role/relationship checks) and idempotently upserts `users`/`coach_athletes`; manually verified end-to-end against the local test database, including a no-op second run. Local Docker image builds all three binaries (~79.5MB); `/migrate` and `/bootstrap` run correctly via `--entrypoint` override, `/api` (default entrypoint) still serves `/health`/`/ready` as 200. |
| D1c — structured logging | **Done.** `apps/api/internal/logging` (new): JSON to stdout via `log/slog`, keys remapped to Cloud Logging's `severity`/`message`, `WARN`→`WARNING`. `logging.Middleware` (wired in `cmd/api`, outside `http.TimeoutHandler` so `X-Request-Id` survives the D1b request-timeout path) mints a request ID per request, echoes it as `X-Request-Id`, and logs one summary line per request at `INFO`/`WARNING`/`ERROR` by status class; successful `/health`/`/ready` polling is not logged, a failing `/ready` still is. `authn.WriteInternalError` replaced all 13 internal-error call sites that previously discarded `err` and logged nothing — every 500 now logs, correlated by `request_id` with its request's summary line, without changing the `{"error":{"code","message"}}` envelope (documented as an additive contract change in `docs/go-backend-api-contract-v0.1.md`, V0.8). Boot logs record port, `db_ping`, Firebase project ID, and a best-effort migration ledger version (`migrate.LatestAppliedVersion`; absent, not an error, if the ledger doesn't exist yet). Closed two DSN-leak paths in `internal/db`: an unparsable `DATABASE_URL` (`net/url.Parse` failure) and a syntactically-parseable-but-invalid one that reaches `pgxpool.ParseConfig`'s libpq keyword/value fallback — both previously able to print the DSN, password included, verbatim to stdout via `log.Fatal`; neither `AssertSafeSSLMode` nor `NewPool` now propagate the underlying parse error's text under any circumstance. `cmd/migrate`/`cmd/bootstrap` converted to the same JSON logger (no request IDs/middleware — non-HTTP jobs); bootstrap logs manifest **counts** only, never UIDs/names. Verified locally against the docker-compose Postgres: full `go test ./...` (unit + integration) green, plus manual runs of all three entrypoints' happy and fatal paths confirming valid one-object-per-line JSON, correct severity, and no credential leakage. §12's *Alerting* subsection and the related §13 checklist line are Cloud Monitoring configuration and remain deferred to D2/D4, not implementable locally. |
| D2 — GCP foundation + Neon project | **Superseded by ADR-001 and ADR-002 (2026-08-18).** The Cloud SQL cost gate that previously passed here (`db-g1-small`, ≈$28/month) is superseded, not merely re-priced — see §3.1/ADR-001. Target project is `dontworkout` (the existing Firebase project) for the GCP side; the database side is a separate Neon project in `aws-ap-southeast-1`, **provisioned on the Free plan for the current internal-testing phase (ADR-002)** — Launch is required before ADR-002's upgrade trigger (primarily: before real athlete/coach data enters the system), not a day-one requirement. Remaining: establish/confirm billing/IAM for GCP resources needed (Cloud Run, Artifact Registry, Secret Manager — **no Cloud SQL APIs/resources required**), create the Neon Free project and database, record its connection details for §7/§8, and track the ADR-002 upgrade trigger explicitly so the Launch upgrade isn't missed. |
| D3a — secrets and identities | Create Secret Manager entries (holding the Neon `DATABASE_URL`), the runtime and migration service accounts, and their least-privilege grants. **No `roles/cloudsql.client` grant** — see §6. No workload runs yet. |
| D3b — first image publish | Manually build and push the image to Artifact Registry. **Record the image digest**; every later phase references that digest. **This digest remains fully reusable under ADR-001** — the code audit in ADR-001 confirmed no Cloud SQL-specific compiled code exists in the built binaries, so no rebuild is required purely because the database host changed. |
| D3c — migration and bootstrap | Using the D3b digest, run the migration job and verify schema state against Neon; then run the approved bootstrap job (§10) and verify access boundaries. Also perform the one-time restore drill below, adapted to Neon's PITR mechanism (§14) rather than Cloud SQL's. |
| D4 — Cloud Run API | Deploy the API service **from the same D3b digest**, in **`asia-southeast1`** (§3), with public invocation, bounded scaling, secrets (Neon `DATABASE_URL`), explicit probes (§5), and ADC identity. **No Cloud SQL attachment step** — see §7. Validate logs/readiness/Firebase verification. |
| D5 — Vercel frontend | Connect `apps/web`, set production-only public Firebase config and `BACKEND_BASE_URL`, then deploy normally through Vercel Git integration. |
| D6 — production E2E | Test the complete Coach/Athlete core loop, authorization failures, refresh/reload, mobile browser path, logs, and persisted records. Measure and record Vercel→Cloud Run round-trip latency (§4) and observed cold-start behaviour. |
| D7 — custom domain/DNS | Only after D6 works on provider URLs, configure Vercel domain and Firebase authorized domains; Cloudflare may manage DNS. |
| D8 — CI/CD later | Automate the understood manual path: immutable image, explicit migration job gate, deploy, smoke test, and controlled rollback. |

### Why the image is published before the migration job

§9 requires the migration job to run the same immutable image as the API. The image must therefore exist before any job runs, which is why D3b sits between identity setup and the first workload. Deploy the API service (D4) from that same digest rather than rebuilding, so the schema that was migrated and the binary that serves traffic provably came from one build. Reference the digest, not a mutable tag: a tag can be repointed, and "which image is actually running" must stay answerable during an incident.

### One-time restore drill

D3c includes restoring from point-in-time recovery to a **separate temporary instance**, verifying the restored data, and then deleting that instance. Backups and PITR are enabled in D2, but a recovery path that has never been executed is an assumption, not a capability — and §14's incident posture depends on it working. Do this once, while there is no production data to lose and no incident in progress. Record the elapsed time; that number is the real recovery expectation.

## 12. Observability

The API currently logs with `log.Println`, which reaches Cloud Logging as unstructured text with no severity. Every entry then looks identical to a filter, so the checks §13 asks for — spotting credential leakage, connection saturation, or a failing token verification — would have to be done by eye. A pilot with real users needs the minimum below in place before D3c, not after an incident.

This is deliberately a floor, not an observability strategy. Distributed tracing, error aggregation, and dashboards are deferred (§17).

### Log format

- Write **JSON to stdout**, one object per line. Cloud Run collects stdout automatically; no logging agent or SDK is required.
- Include a `severity` field using Cloud Logging's severity names (`DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL`) so entries are filterable and errors are visibly errors.
- Include a request ID on every request-scoped entry, and echo it to the client via an `X-Request-Id` response header — not as a new field in the JSON body. The API's error envelope is a fixed contract (`authn.WriteError` in `apps/api/internal/authn/authn.go` writes exactly `{"error":{"code","message"}}`); adding a body field is an API contract change requiring its own review, which this document does not authorize. A response header carries the same debugging value without touching the contract.
- Log the start-of-life facts once at boot: resolved port, whether the database ping succeeded, the Firebase project ID, and the migration ledger version if applicable. These make "which revision is this and what does it think it is connected to" answerable without a redeploy.

### Never log

The following must not appear in any log line, at any severity, including error paths and panic handlers:

- `DATABASE_URL` or any component of it, especially the password;
- the `Authorization` header, or any Firebase ID token, in whole or in part;
- any Secret Manager value;
- full request bodies for authenticated endpoints, which carry athlete data.

Log the *shape* of a failure — endpoint, status, error class, request ID — not the credential that produced it. Error wrapping is the usual leak: a connection error that wraps the DSN will print the password when logged.

### Alerting

At least one alert must exist and must have been deliberately triggered once before the pilot opens, so it is known to actually deliver:

- elevated 5xx rate on the Cloud Run service, **or**
- database unavailability (Neon, under ADR-001) — Neon's monitoring/alerting mechanism differs from Cloud SQL's and should be confirmed when D2-equivalent work resumes, rather than assumed to be the same integration.

An alert that has never fired is in the same category as a backup that has never been restored.

## 13. Verification checklist

Before calling the first pilot deployment ready, verify:

- Cloud Run `/health` and `/ready` return as expected.
- A valid Firebase token succeeds through the Vercel `/backend` rewrite.
- Missing, invalid, and unauthorized tokens fail with the documented API status/behavior.
- Coach and athlete each can access only permitted records and relationships.
- A coach creates/schedules a workout; athlete opens it and records SetLogs; coach reviews results.
- Database writes persist after API revision replacement.
- Cloud Run and Neon logs show no credential values or unexpected connection saturation.
- Logs arrive in Cloud Logging parsed as JSON with a usable `severity`, and an error path is confirmed to surface as `ERROR` rather than `INFO` (§12).
- A request ID from the `X-Request-Id` response header can be used to locate that exact request in Cloud Logging, and the JSON error body remains unchanged (`{"error":{"code","message"}}`).
- At least one alert is configured **and has been deliberately triggered once** to confirm delivery (§12).
- The point-in-time-recovery restore drill has been completed against Neon's restore mechanism, its elapsed time recorded, and any temporary branch/project deleted (§11, §14).
- The API service and the migration job that ran against this database were deployed from the same image digest (§11).
- Vercel Preview has no production backend or production Firebase mutation path.
- Backup/PITR configuration, instance location, max instance cap, pool cap, connection idle/lifetime settings, image digest, and Secret Manager version pins are recorded in the deployment change record.

## 14. Rollback and incident posture

- **API:** move Cloud Run traffic back to the prior healthy revision. Keep the prior image/revision identifiable.
- **Frontend:** use Vercel's prior deployment rollback/redeployment controls.
- **Database:** do not run destructive down migrations. First stop harmful traffic, assess compatibility, apply a reviewed forward fix, or use **Neon's point-in-time restore** (branch-based, up to 7 days of history on Launch — ADR-001) to a separate branch/project for recovery. Validate before any controlled cutover. This replaces the superseded Cloud SQL PITR-to-separate-instance mechanism; confirm Neon's exact restore workflow when D3c-equivalent work resumes, since branch-based restore is mechanically different from Cloud SQL's instance-clone restore.
- **Secrets:** rotate by creating a new Secret Manager version, updating the pinned version in a new Cloud Run revision/job configuration, and verifying before disabling the old version.

The database has no high-availability failover under either the superseded Cloud SQL decision or the current Neon decision. This is an accepted controlled-pilot availability trade-off, not a claim of production-grade redundancy — see ADR-001 for the Neon-specific SLA/availability posture.

## 15. Cost guardrails

**Superseded by ADR-001 and ADR-002 (2026-08-18).** The database is no longer the fixed recurring Cloud SQL cost described below; it is Neon's usage-based, scale-to-zero pricing. The ≈$28/month Cloud SQL figure and its SKU-level basis (formerly recorded in §3.1) no longer apply. **The initial D2 project is on the Free plan (ADR-002) — effectively $0/month for the current internal-testing usage, within Free's limits** (100 CU-hours/month compute, 0.5 GB storage, 5 GB/month egress). A rough Launch-plan estimate of ≈$10–15/month for this workload (for when the ADR-002 upgrade trigger fires) is recorded in ADR-001 — **re-run this against Neon's own pricing calculator before that upgrade**, the same discipline previously applied to the Cloud SQL estimate; do not carry either estimate forward as a quote.

The **USD 100/month ceiling remains the approval guardrail** for total infra spend, not tied to any one provider; it is retained as a sanity check, not because a fresh cost-gate exercise against it is expected to be close for either option at this pilot's scale.

Re-run the Neon pricing exercise, and record a fresh estimate, whenever ADR-001's trigger conditions are met (sustained cost exceeding what Cloud SQL would have cost at actual usage, unacceptable cold-start latency, a stated SLA requirement, or materially increased workload) or the configuration otherwise changes.

Cloud Run has request-based CPU/memory pricing and can scale to zero with `min instances = 0`; it also has build, artifact storage, logging, and outbound internet traffic considerations. Cloud Run (`asia-southeast1`) to Neon (`aws-ap-southeast-1`) is now a **cross-cloud, same-region-pair** path rather than Cloud SQL's same-cloud Unix socket — it is not literally free intra-cloud traffic the way GCP-to-GCP was, and should be measured at D6 rather than assumed negligible. The Vercel-to-Cloud-Run proxy remains a separate external-traffic hop to measure independently (§4).

Confirm the applicable Vercel plan at provisioning time. Current Vercel plan eligibility and pricing can change; a commercial pilot may require a paid plan. Do not rely on historical price figures.

## 16. Cloudflare's limited role

Cloudflare Quick Tunnel is only temporary remote access to a developer Mac:

```text
iPhone → temporary HTTPS Cloudflare URL → local Next.js → local Go API → local PostgreSQL
```

It is not production infrastructure and is not an application runtime. Quick Tunnels are for development/testing and have service limitations.

There is one current local-auth caveat: a browser on an iPhone cannot reach `127.0.0.1:9099` on the developer Mac, and the current Firebase emulator configuration uses an HTTP emulator host. A Quick Tunnel for Next.js alone therefore does not make Firebase emulator authentication work remotely over HTTPS. Resolve that in a future, isolated local-testing task with either safe emulator tunneling/proxying or a non-production Firebase project; it does not affect the production architecture.

After D6, Cloudflare may manage DNS for a custom Vercel domain. Cloudflare Workers, Pages, and Containers are not part of this pilot's hosting.

## 17. Deferred items and change triggers

Revisit this architecture only when evidence requires it:

- **Neon cost or behavior fails to hold up** (sustained cost exceeding what Cloud SQL would have cost at actual measured usage, unacceptable cold-start latency in the core loop, or a stated availability/SLA requirement neither Neon nor single-zone Cloud SQL satisfies): revisit ADR-001. Its trade-offs and rollback path (§ "Rollback / migration path") are the starting point — the code portability audit there means switching back, or to a third provider, is a configuration change plus a data migration, not a rewrite. Do not repeat the full comparison from scratch; start from ADR-001's recorded reasoning and update only what evidence has changed.
- Availability requirements exceed a controlled pilot: consider a dedicated-core, HA-enabled option with real SLA coverage — under the current decision this means evaluating Neon's higher tiers or Cloud SQL Enterprise/Enterprise Plus with HA (recall neither single-zone Cloud SQL nor the current Neon tier carries an SLA — ADR-001).
- Private networking/compliance requirements: consider Neon's private networking options, or reconsider Cloud SQL private IP/VPC connectivity if that becomes the better fit.
- Media upload/video analysis: add object storage and signed-upload design; do not store media in PostgreSQL.
- Sustained load: adjust Cloud Run concurrency/max instances and pool sizes using measured database connections and latency.
- Repeatable releases: add CI/CD only after D1–D6 manual path is documented and understood.
- A true staging need: define isolated Firebase, API, and database resources; do not let Vercel Previews act as staging by accident.
- Abuse or unexplained traffic against the public Cloud Run URL: add rate limiting at Cloud Run — Cloud Armor, or a shared secret header injected by the Vercel rewrite and required by the API. Applying it only at Vercel would not help, since the Cloud Run host is directly reachable (§5).
- Debugging that outgrows single-request logs: add distributed tracing and error aggregation on top of the §12 floor.
- Measured Vercel→Cloud Run latency is poor at D6: investigate Vercel project/region configuration and whether restructuring the `/backend` proxy as a Vercel Function (for a configurable execution region) is warranted, before changing the application architecture (§4).

## 18. Official references

- [Cloud Run locations](https://cloud.google.com/run/docs/locations) and [Artifact Registry locations](https://cloud.google.com/artifact-registry/docs/repositories/repo-locations)
- [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity) and [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup)
- [Neon plans/pricing](https://neon.com/docs/introduction/plans), [Neon regions](https://neon.com/docs/introduction/regions), and [Neon connection security (sslmode/channel_binding)](https://neon.com/docs/connect/connect-securely)
- [Cloud Run autoscaling](https://cloud.google.com/run/docs/about-instance-autoscaling), [Cloud Run pricing](https://cloud.google.com/run/pricing), and [Cloud Run public access](https://cloud.google.com/run/docs/authenticating/public)
- [Cloud Run Secret Manager configuration](https://cloud.google.com/run/docs/configuring/services/secrets), [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), and [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), and [Cloudflare DNS](https://developers.cloudflare.com/dns/get-started/)
- **Superseded (Cloud SQL, retained for history):** [Cloud SQL PostgreSQL region availability](https://cloud.google.com/sql/docs/postgres/region-availability-overview), [Cloud Run to Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run), [Cloud SQL connection management](https://cloud.google.com/sql/docs/postgres/manage-connections), [Cloud SQL pricing](https://cloud.google.com/sql/pricing), [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator), [Cloud SQL instance settings](https://cloud.google.com/sql/docs/postgres/instance-settings), [Cloud SQL SLA](https://cloud.google.com/sql/sla)
