# Deployment Architecture v0.1

Status: approved target architecture for a controlled production pilot. This document is the canonical deployment/runbook specification for future deployment tasks. It does not provision or deploy anything.

## 1. Scope and principles

The pilot architecture optimizes for a small real-user release: simple operations, correct production boundaries, controlled cost, and hands-on learning of Docker, Cloud Run, Cloud SQL, and production secrets. It preserves the current application split and does not add Kubernetes, Redis, a load balancer, VPC networking, replicas, HA, Terraform, or CI/CD in v0.1.

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

| Decision | v0.1 choice |
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

Direct browser-to-Cloud-Run calls are deferred. They would require an explicit CORS allow-list and would expose a second API origin in client configuration without a current benefit.

## 5. Cloud Run API

Cloud Run is suitable for the existing Go API: it listens on `PORT`, exposes `/health` and `/ready`, accepts graceful shutdown, and has no VM-specific dependency. A future D1 container task must add a production Dockerfile and `.dockerignore`, build from the repository context, and validate the image locally before cloud deployment.

### Invocation and application authorization

The Cloud Run service must permit unauthenticated **Cloud Run invocation** so Vercel can proxy browser traffic to it. This does not make protected application endpoints anonymous: the Go API remains responsible for verifying Firebase ID tokens and enforcing role/relationship authorization.

Do not try to protect the Cloud Run service itself with Cloud Run IAM while using browser Firebase tokens. Firebase ID tokens are application credentials, not Cloud Run invoker credentials. Keep only deliberately public operational endpoints such as `/health` minimal; all business routes retain Go authentication.

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

For this MVP, use Cloud SQL public IP plus the Cloud Run managed connector/socket path. This provides encrypted connector transport and avoids a Serverless VPC Access connector. Private IP/VPC networking is a deferred hardening option, not a v0.1 prerequisite.

`DATABASE_URL` remains the application variable name. Its production value is a secret and must be constructed for the Unix socket connection with the production database name, user, password, and `sslmode=disable` only when using the managed connector path. The connection mechanism—not a public TCP connection from application code—is responsible for the secure Cloud Run-to-Cloud SQL transport.

### Connection budget

`pgxpool.New` currently uses defaults and has no explicit maximum. Before production deployment, D1b must add explicit bounded pool configuration. Initial target: at most four database connections per API instance. With Cloud Run maximum instances of three, the planned API budget is at most twelve pooled connections, plus one separately run migration job. Size the Cloud SQL instance and its `max_connections` allowance around all clients, not only API requests.

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
| `FIREBASE_PROJECT_ID` | SERVER CONFIG | Cloud Run service and migration job configuration if needed | Production Firebase/GCP project ID; no credential JSON. |
| `FIREBASE_AUTH_EMULATOR_HOST` | LOCAL ONLY | Not set in Cloud Run | Production must use Firebase's real token verification path. |
| `PORT` | PLATFORM CONFIG | Cloud Run supplies it | App default is `8080`; do not make it a secret. |
| Cloud SQL instance connection name | SERVER CONFIG | Cloud Run Cloud SQL attachment/configuration | Not a password, but keep it out of browser variables. |
| Database migration credential | SECRET | Secret Manager, migration job only | Separate least-privilege DDL credential. |
| API runtime database credential | SECRET | Secret Manager, API service only | Prefer a DML-only credential once D1b adds it. |

Use Secret Manager for secret material. When injecting a secret as an environment variable in Cloud Run, pin a numeric Secret Manager version rather than `latest`, then deliberately deploy a new revision when rotating it. Grant secret access to the exact runtime/job service account.

## 9. Schema migrations

Choose **an explicit Cloud Run migration Job** for v0.1.

The job uses the same immutable API image but a migration command/entrypoint. It runs one task with maximum retries set to `0`, uses the migration database credential, records applied migration versions/checksums, and exits. Run and verify it before directing production traffic to an API revision that requires the schema change.

This is intentionally not API startup migration: concurrent Cloud Run instances must never race to mutate production schema. It is also more explicit and observable than a hidden deploy-time side effect. Later CI/CD may invoke the exact same job after manual deployment has been understood.

### Required D1b migration tooling

The repository currently contains SQL migration files but no runner or schema-version tracking. D1b must add a reproducible migration command before production work begins. Its acceptance criteria include:

- ordered, transactional application where PostgreSQL supports it;
- an applied-version/checksum ledger;
- failure on changed historical migration content;
- a dry/local validation path against a clean PostgreSQL database;
- distinct API, migration, and bootstrap entrypoints; and
- no automatic migration in API startup.

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
| D1a — container readiness | Add Dockerfile and `.dockerignore` for `apps/api`; build and run locally; `/health` works in the container. |
| D1b — production database tooling | Add bounded `pgxpool` configuration plus explicit migration/bootstrap entrypoints; prove migrations from a clean local database. |
| D2 — GCP/Cloud SQL foundation | After cost approval, establish project/billing/IAM, Artifact Registry, Cloud SQL in `asia-east1`, backups/PITR, least-privilege identities, and a documented connection budget. |
| D3 — secrets, migration, bootstrap | Create Secret Manager entries, configure identities, run migration job, then approved bootstrap job; verify database state and access boundaries. |
| D4 — Cloud Run API | Manually build/publish image and deploy API with Cloud SQL attachment, public invocation, bounded scaling, secrets, and ADC identity; validate logs/readiness/Firebase verification. |
| D5 — Vercel frontend | Connect `apps/web`, set production-only public Firebase config and `BACKEND_BASE_URL`, then deploy normally through Vercel Git integration. |
| D6 — production E2E | Test the complete Coach/Athlete core loop, authorization failures, refresh/reload, mobile browser path, logs, and persisted records. |
| D7 — custom domain/DNS | Only after D6 works on provider URLs, configure Vercel domain and Firebase authorized domains; Cloudflare may manage DNS. |
| D8 — CI/CD later | Automate the understood manual path: immutable image, explicit migration job gate, deploy, smoke test, and controlled rollback. |

## 12. Verification checklist

Before calling the first pilot deployment ready, verify:

- Cloud Run `/health` and `/ready` return as expected.
- A valid Firebase token succeeds through the Vercel `/backend` rewrite.
- Missing, invalid, and unauthorized tokens fail with the documented API status/behavior.
- Coach and athlete each can access only permitted records and relationships.
- A coach creates/schedules a workout; athlete opens it and records SetLogs; coach reviews results.
- Database writes persist after API revision replacement.
- Cloud Run and Cloud SQL logs show no credential values or unexpected connection saturation.
- Vercel Preview has no production backend or production Firebase mutation path.
- Backup/PITR configuration, instance location, max instance cap, pool cap, and Secret Manager version pins are recorded in the deployment change record.

## 13. Rollback and incident posture

- **API:** move Cloud Run traffic back to the prior healthy revision. Keep the prior image/revision identifiable.
- **Frontend:** use Vercel's prior deployment rollback/redeployment controls.
- **Database:** do not run destructive down migrations. First stop harmful traffic, assess compatibility, apply a reviewed forward fix, or use Cloud SQL point-in-time recovery to a separate recovery instance. Validate before any controlled cutover.
- **Secrets:** rotate by creating a new Secret Manager version, updating the pinned version in a new Cloud Run revision/job configuration, and verifying before disabling the old version.

The initial single-zone database has no high-availability failover. This is an accepted controlled-pilot availability trade-off, not a claim of production-grade redundancy.

## 14. Cost guardrails

Cloud SQL is the likely material recurring cost because the instance runs continuously, with additional storage, backup, and network charges. Before D2, use the current Google Cloud Pricing Calculator for `asia-east1`, PostgreSQL 16, the intended Enterprise dedicated-core size, storage, backups/PITR, and estimated network traffic. Record the monthly estimate and a pilot spending limit before creating resources.

Cloud Run has request-based CPU/memory pricing and can scale to zero with `min instances = 0`; it also has build, artifact storage, logging, and outbound internet traffic considerations. Traffic from Cloud Run to Cloud SQL in the same region is the intended low-latency path; the Vercel-to-Cloud-Run proxy is external traffic and should be measured, not assumed free.

Confirm the applicable Vercel plan at provisioning time. Current Vercel plan eligibility and pricing can change; a commercial pilot may require a paid plan. Do not rely on historical price figures.

## 15. Cloudflare's limited role

Cloudflare Quick Tunnel is only temporary remote access to a developer Mac:

```text
iPhone → temporary HTTPS Cloudflare URL → local Next.js → local Go API → local PostgreSQL
```

It is not production infrastructure and is not an application runtime. Quick Tunnels are for development/testing and have service limitations.

There is one current local-auth caveat: a browser on an iPhone cannot reach `127.0.0.1:9099` on the developer Mac, and the current Firebase emulator configuration uses an HTTP emulator host. A Quick Tunnel for Next.js alone therefore does not make Firebase emulator authentication work remotely over HTTPS. Resolve that in a future, isolated local-testing task with either safe emulator tunneling/proxying or a non-production Firebase project; it does not affect the production architecture.

After D6, Cloudflare may manage DNS for a custom Vercel domain. Cloudflare Workers, Pages, and Containers are not part of v0.1 hosting.

## 16. Deferred items and change triggers

Revisit this architecture only when evidence requires it:

- Cloud SQL cost fails the D2 cost gate: write an ADR comparing managed PostgreSQL alternatives.
- Availability requirements exceed a controlled pilot: consider Cloud SQL HA, tested recovery exercises, and a higher database tier.
- Private networking/compliance requirements: consider Cloud SQL private IP and VPC connectivity.
- Media upload/video analysis: add object storage and signed-upload design; do not store media in PostgreSQL.
- Sustained load: adjust Cloud Run concurrency/max instances and pool sizes using measured database connections and latency.
- Repeatable releases: add CI/CD only after D1–D6 manual path is documented and understood.
- A true staging need: define isolated Firebase, API, and database resources; do not let Vercel Previews act as staging by accident.

## 17. Official references

- [Cloud Run locations](https://cloud.google.com/run/docs/locations), [Cloud SQL PostgreSQL region availability](https://cloud.google.com/sql/docs/postgres/region-availability-overview), and [Artifact Registry locations](https://cloud.google.com/artifact-registry/docs/repositories/repo-locations)
- [Cloud Run service identity](https://cloud.google.com/run/docs/securing/service-identity) and [Firebase Admin SDK setup](https://firebase.google.com/docs/admin/setup)
- [Cloud Run to Cloud SQL for PostgreSQL](https://cloud.google.com/sql/docs/postgres/connect-run) and [Cloud SQL connection management](https://cloud.google.com/sql/docs/postgres/manage-connections)
- [Cloud SQL pricing](https://cloud.google.com/sql/pricing), [Google Cloud Pricing Calculator](https://cloud.google.com/products/calculator), and [Cloud SQL instance settings](https://cloud.google.com/sql/docs/postgres/instance-settings)
- [Cloud Run autoscaling](https://cloud.google.com/run/docs/about-instance-autoscaling), [Cloud Run pricing](https://cloud.google.com/run/pricing), and [Cloud Run public access](https://cloud.google.com/run/docs/authenticating/public)
- [Cloud Run Secret Manager configuration](https://cloud.google.com/run/docs/configuring/services/secrets), [Next.js rewrites](https://nextjs.org/docs/app/api-reference/config/next-config-js/rewrites), and [Vercel rewrites](https://vercel.com/docs/routing/rewrites)
- [Firebase API keys](https://firebase.google.com/docs/projects/api-keys), [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/), and [Cloudflare DNS](https://developers.cloudflare.com/dns/get-started/)
