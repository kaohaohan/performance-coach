# Deployment Architecture v0.2

Status: the v0.1 architecture below (hosting split, `asia-east1` colocation, Cloud SQL baseline, migration-job-only schema changes, forward-only rollback) remains **approved**. The v0.2 additions — phase reordering around the container image, per-entrypoint configuration, and the new Observability section (§12) — are **proposed**, pending review, because they introduce new acceptance criteria for D1b–D4 rather than only clarifying existing text. This document is the canonical deployment/runbook specification for future deployment tasks. It does not provision or deploy anything.

## 1. Scope and principles

The pilot architecture optimizes for a small real-user release: simple operations, correct production boundaries, controlled cost, and hands-on learning of Docker, Cloud Run, Cloud SQL, and production secrets. It preserves the current application split and does not add Kubernetes, Redis, a load balancer, VPC networking, replicas, HA, Terraform, or CI/CD in this architecture.

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
        | Cloud SQL connector / Unix socket
        v
Google Cloud SQL: PostgreSQL

Firebase Authentication supplies browser ID tokens.
GitHub remains source control.
```

Use `asia-east1` (Taiwan) for Artifact Registry, Cloud Run, Cloud Run Jobs, and Cloud SQL. The region is currently supported by each product; API and database must remain colocated. This avoids unnecessary latency and inter-region traffic.

### Decisions

| Decision | Choice (approved in v0.1, unchanged in v0.2) |
| --- | --- |
| Frontend | Vercel, rooted at `apps/web`. |
| API | Docker image on Cloud Run. |
| Database | Cloud SQL for PostgreSQL 16, Enterprise edition, single-zone, smallest suitable **dedicated-core** instance. |
| Authentication | Firebase Auth; Go verifies Firebase ID tokens. |
| Environments | `LOCAL` and `PRODUCTION/PILOT` only. |
| API URL model | Keep the same-origin `/backend/*` abstraction. |
| Deployment | Understand and perform a controlled manual backend deployment first; automate later. |
| Cloudflare | Quick Tunnel for temporary local testing only; DNS/custom domain later. |

Cloud SQL is the baseline, not a pre-approved purchasing decision. Before provisioning, price the exact selected `asia-east1` configuration in the Google Cloud Pricing Calculator. If it is disproportionate for the pilot, open a separate ADR for alternatives; do not silently substitute another database service.

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

- **At boot**, `db.NewPool` in `apps/api/internal/db` pings the database and returns a fatal error on failure, so a revision that cannot reach the database on startup never receives traffic. This covers the common case (bad config, unreachable Cloud SQL at deploy time).
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

The runtime service account requires only the roles needed by the running API, initially:

- Cloud SQL Client, to connect through the Cloud SQL connector.
- Secret Manager Secret Accessor, only for secrets mounted into the API.

Create a separate migration-job service account with its own least-privilege database credential and only the cloud access it requires. Do not rely on the default Compute Engine service account or broad Editor roles.

Never commit, copy, mount, or bake a Firebase/GCP service-account JSON into the repository or container. Do not set `GOOGLE_APPLICATION_CREDENTIALS` in Cloud Run. Local development may use its existing safe local credential arrangement independently; its files remain outside version control.

In Firebase production setup, configure the production Firebase project/web app and ensure the Vercel hostname (and later custom hostname) is an authorized domain when Firebase Auth providers or email action flows require it. `NEXT_PUBLIC_FIREBASE_API_KEY` is a public Firebase web configuration value, not a server secret; restrict its API key and monitor quotas in Firebase/Google Cloud.

## 7. Cloud SQL and database connectivity

Provision a PostgreSQL 16 Cloud SQL instance in `asia-east1` using Cloud SQL Enterprise, single zone, with automated backups and point-in-time recovery enabled. Do not use shared-core `db-f1-micro` or `db-g1-small` for a production pilot: Google documents them as test/development configurations without an SLA.

Use Cloud Run's built-in Cloud SQL connection configuration to attach the instance and connect through its Unix socket:

```text
/cloudsql/<GCP_PROJECT_ID>:asia-east1:<CLOUD_SQL_INSTANCE>
```

For this MVP, use Cloud SQL public IP plus the Cloud Run managed connector/socket path. This provides encrypted connector transport and avoids a Serverless VPC Access connector. Private IP/VPC networking is a deferred hardening option, not a prerequisite for this pilot.

`DATABASE_URL` remains the application variable name. Its production value is a secret and must be constructed for the Unix socket connection with the production database name, user, password, and `sslmode=disable` only when using the managed connector path. The connection mechanism—not a public TCP connection from application code—is responsible for the secure Cloud Run-to-Cloud SQL transport.

`sslmode=disable` is safe on the `/cloudsql/...` Unix socket path, where the transport never leaves the container and the connector supplies encryption. It is also safe against a local loopback PostgreSQL, which is what `.env.example` already uses (`localhost:5433`) — there is no network to protect between the API process and a database on the same machine. The risk is a *production* DSN that ends up pointed at a public TCP host with `sslmode=disable` still set, which would send credentials and data in plaintext.

The assertion D1b adds must therefore be host-based, not blanket: refuse to start only when `sslmode=disable` is set **and** the DSN host is neither a `/cloudsql/` socket path **nor** a loopback address (`localhost`, `127.0.0.1`). This rejects exactly the dangerous case — a leaked production DSN pointed at a public host — without breaking local development, which never had a network-facing DSN to leak.

### Connection budget

`pgxpool.New` currently uses defaults and has no explicit maximum. Before production deployment, D1b must add explicit bounded pool configuration. Initial target: at most four database connections per API instance. With Cloud Run maximum instances of three, the planned API budget is at most twelve pooled connections, plus one separately run migration job. Size the Cloud SQL instance and its `max_connections` allowance around all clients, not only API requests.

`pgxpool.New` without an explicit `Config` already applies pgx's own defaults for `MaxConnLifetime`, `MaxConnIdleTime`, and a periodic health check, so the pool is not entirely without eviction today. The requirement for D1b is not "add eviction that doesn't exist" but to **explicitly pin and verify** `MaxConns`, `MaxConnIdleTime`, and `MaxConnLifetime` for production rather than run on library defaults nobody has confirmed against Cloud SQL's own idle-connection behavior. Pin the values, then check under D6 load that Cloud SQL isn't closing connections faster than the pool retires them.

Also size the pool against the configured Cloud Run concurrency: at concurrency `20` and four connections per instance, up to sixteen in-flight requests can be waiting on a connection. That is acceptable for short CRUD queries but means database slowness turns into request queueing.

This queueing currently has no explicit upper bound. `main.go` does not set `http.Server.ReadTimeout`/`WriteTimeout`, and a handler's `r.Context()` is canceled on client disconnect or when the handler returns — not on a query simply taking too long. Cloud Run's own request timeout closes the client-facing connection when it expires, but that is not the same as a guarantee that the container stops the in-flight database work; whether it does depends on whether that closure is wired to cancel the request context. D1b should add an explicit deadline — a server-level request timeout, a per-handler `context.WithTimeout` around the database call, or both — so a slow query has a bounded worst case instead of an assumed one. Verify the chosen mechanism under D6 load rather than relying on incidental cancellation.

Do not scale Cloud Run above the agreed cap or raise the pool cap until connection usage, latency, and Cloud SQL limits have been checked.

## 8. Configuration and secret inventory

No actual values belong in this document, source control, Docker image layers, logs, or frontend source maps.

| Variable / setting | Category | Production location | Notes |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | PUBLIC | Vercel production environment | Firebase web configuration. |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | PUBLIC | Vercel production environment | Public Firebase API key; restrict it. |
| `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` | LOCAL ONLY | Not set in Vercel production | Never point production browsers to an emulator. |
| `BACKEND_BASE_URL` | SERVER CONFIG | Vercel production environment | Cloud Run HTTPS URL; no trailing slash. |
| `DATABASE_URL` | SECRET | Secret Manager, injected into Cloud Run service and migration job | Database username/password and socket URL. |
| `FIREBASE_PROJECT_ID` | SERVER CONFIG | Cloud Run API service only; **not** the migration job | Production Firebase/GCP project ID; no credential JSON. The migration job does not authenticate users and must not require it — see §9. |
| `FIREBASE_AUTH_EMULATOR_HOST` | LOCAL ONLY | Not set in Cloud Run | Production must use Firebase's real token verification path. |
| `PORT` | PLATFORM CONFIG | Cloud Run supplies it | App default is `8080`; do not make it a secret. |
| Cloud SQL instance connection name | SERVER CONFIG | Cloud Run Cloud SQL attachment/configuration | Not a password, but keep it out of browser variables. |
| Database migration credential | SECRET | Secret Manager, migration job only | Separate least-privilege DDL credential. |
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
| D1c — structured logging | Implement §12: JSON logs to stdout with `severity`, request IDs, and the redaction rules. Verify locally before any cloud phase, so D3c onward is observable. |
| D2 — GCP/Cloud SQL foundation | After cost approval, establish project/billing/IAM, Artifact Registry, Cloud SQL in `asia-east1`, backups/PITR, least-privilege identities, and a documented connection budget. |
| D3a — secrets and identities | Create Secret Manager entries, the runtime and migration service accounts, and their least-privilege grants. No workload runs yet. |
| D3b — first image publish | Manually build and push the image to Artifact Registry in `asia-east1`. **Record the image digest**; every later phase references that digest. |
| D3c — migration and bootstrap | Using the D3b digest, run the migration job and verify schema state; then run the approved bootstrap job (§10) and verify access boundaries. Also perform the one-time restore drill below. |
| D4 — Cloud Run API | Deploy the API service **from the same D3b digest** with Cloud SQL attachment, public invocation, bounded scaling, secrets, explicit probes (§5), and ADC identity; validate logs/readiness/Firebase verification. |
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
- Cloud SQL instance unavailability.

An alert that has never fired is in the same category as a backup that has never been restored.

## 13. Verification checklist

Before calling the first pilot deployment ready, verify:

- Cloud Run `/health` and `/ready` return as expected.
- A valid Firebase token succeeds through the Vercel `/backend` rewrite.
- Missing, invalid, and unauthorized tokens fail with the documented API status/behavior.
- Coach and athlete each can access only permitted records and relationships.
- A coach creates/schedules a workout; athlete opens it and records SetLogs; coach reviews results.
- Database writes persist after API revision replacement.
- Cloud Run and Cloud SQL logs show no credential values or unexpected connection saturation.
- Logs arrive in Cloud Logging parsed as JSON with a usable `severity`, and an error path is confirmed to surface as `ERROR` rather than `INFO` (§12).
- A request ID from the `X-Request-Id` response header can be used to locate that exact request in Cloud Logging, and the JSON error body remains unchanged (`{"error":{"code","message"}}`).
- At least one alert is configured **and has been deliberately triggered once** to confirm delivery (§12).
- The point-in-time-recovery restore drill has been completed, its elapsed time recorded, and the temporary instance deleted (§11).
- The API service and the migration job that ran against this database were deployed from the same image digest (§11).
- Vercel Preview has no production backend or production Firebase mutation path.
- Backup/PITR configuration, instance location, max instance cap, pool cap, connection idle/lifetime settings, image digest, and Secret Manager version pins are recorded in the deployment change record.

## 14. Rollback and incident posture

- **API:** move Cloud Run traffic back to the prior healthy revision. Keep the prior image/revision identifiable.
- **Frontend:** use Vercel's prior deployment rollback/redeployment controls.
- **Database:** do not run destructive down migrations. First stop harmful traffic, assess compatibility, apply a reviewed forward fix, or use Cloud SQL point-in-time recovery to a separate recovery instance. Validate before any controlled cutover.
- **Secrets:** rotate by creating a new Secret Manager version, updating the pinned version in a new Cloud Run revision/job configuration, and verifying before disabling the old version.

The initial single-zone database has no high-availability failover. This is an accepted controlled-pilot availability trade-off, not a claim of production-grade redundancy.

## 15. Cost guardrails

Cloud SQL is the likely material recurring cost because the instance runs continuously, with additional storage, backup, and network charges. Before D2, use the current Google Cloud Pricing Calculator for `asia-east1`, PostgreSQL 16, the intended Enterprise dedicated-core size, storage, backups/PITR, and estimated network traffic. Record the monthly estimate and a pilot spending limit before creating resources.

Cloud Run has request-based CPU/memory pricing and can scale to zero with `min instances = 0`; it also has build, artifact storage, logging, and outbound internet traffic considerations. Traffic from Cloud Run to Cloud SQL in the same region is the intended low-latency path; the Vercel-to-Cloud-Run proxy is external traffic and should be measured, not assumed free.

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

- Cloud SQL cost fails the D2 cost gate: write an ADR comparing managed PostgreSQL alternatives.
- Availability requirements exceed a controlled pilot: consider Cloud SQL HA, tested recovery exercises, and a higher database tier.
- Private networking/compliance requirements: consider Cloud SQL private IP and VPC connectivity.
- Media upload/video analysis: add object storage and signed-upload design; do not store media in PostgreSQL.
- Sustained load: adjust Cloud Run concurrency/max instances and pool sizes using measured database connections and latency.
- Repeatable releases: add CI/CD only after D1–D6 manual path is documented and understood.
- A true staging need: define isolated Firebase, API, and database resources; do not let Vercel Previews act as staging by accident.
- Abuse or unexplained traffic against the public Cloud Run URL: add rate limiting at Cloud Run — Cloud Armor, or a shared secret header injected by the Vercel rewrite and required by the API. Applying it only at Vercel would not help, since the Cloud Run host is directly reachable (§5).
- Debugging that outgrows single-request logs: add distributed tracing and error aggregation on top of the §12 floor.
- Measured Vercel→Cloud Run latency is poor at D6: investigate Vercel project/region configuration and whether restructuring the `/backend` proxy as a Vercel Function (for a configurable execution region) is warranted, before changing the application architecture (§4).

## 18. Official references

- [Cloud Run locations](https://cloud.google.com/run/docs/locations), [Cloud SQL PostgreSQL region availability](https://cloud.google.com/sql/docs/postgres/region-availability-overview), and [Artifact Registry locations](https://cloud.google.com/artifact-registry/docs/repositories/repo-locations)
- [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity) and [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup)
- [Cloud Run to Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run) and [Cloud SQL connection management](https://cloud.google.com/sql/docs/postgres/manage-connections)
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing), [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator), and [Cloud SQL instance settings](https://cloud.google.com/sql/docs/postgres/instance-settings)
- [Cloud Run autoscaling](https://cloud.google.com/run/docs/about-instance-autoscaling), [Cloud Run pricing](https://cloud.google.com/run/pricing), and [Cloud Run public access](https://cloud.google.com/run/docs/authenticating/public)
- [Cloud Run Secret Manager configuration](https://cloud.google.com/run/docs/configuring/services/secrets), [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), and [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), and [Cloudflare DNS](https://developers.cloudflare.com/dns/get-started/)
