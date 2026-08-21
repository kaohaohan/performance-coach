# Engineering Maturity Gap Analysis

Status: **assessment only** — this document provisions nothing and changes no behavior. It records where the project actually stands as of 2026-08-17, so that scope decisions are made against evidence rather than impression.

Every claim below cites a file path or a measurable fact in the repository. Where something is missing, this document says missing rather than planned, unless a phase in `deployment-architecture-v0.2.md` already owns it.

---

## 1. Purpose and Assessment Basis

This project is built primarily through AI-assisted development under the contract in `AGENTS.md`. That creates two distinct maturity questions, and they are not the same question:

1. **Process maturity** — is the development workflow itself sound? Are analysis and decisions durable artifacts rather than chat transcripts?
2. **Engineering maturity** — does the resulting system have the automation, verification, and operability that any production-bound codebase needs?

The project is strong on the first and weak on the second. That asymmetry is the central finding of this document, and it is a predictable consequence of an MVP that has prioritized correctness of the domain model over automation of the delivery path.

Assessment basis:

- The four-step development cycle the contract targets: feasibility analysis → technical design → task breakdown → progress tracking (`AGENTS.md` §9)
- Ordinary engineering baselines: automated verification, continuous integration, containerization, deployability, observability
- The MVP scope boundaries in `docs/mvp-specification.md` — a gap inside deferred scope is not a defect

---

## 2. Current State

Three levels: **Present** (exists and works), **Partial** (exists but does not deliver its intended value), **Absent** (does not exist).

### 2.1 Development Process

| Capability | Level | Evidence |
|---|---|---|
| Feasibility analysis stage | Present | `AGENTS.md` §9, `docs/tasks/_template.md` §1 |
| Technical design stage | Present | `docs/tasks/_template.md` §2 |
| Task breakdown / sizing | Present | `AGENTS.md` §7 (S/M/L/XL, ≤5 files per task, full-stack phase split) |
| Progress tracking | Present | `docs/tasks/_template.md` §4, referenced by `AGENTS.md` §21 |
| Phase gate before editing | Present | `AGENTS.md` §8 — read-only Phase 0, explicit approval required |
| Session/model discipline | Present | `AGENTS.md` §10 — high-effort planning, low-effort execution, separate sessions |
| Documentation system | Present | 5 documents in `docs/` (~3,480 lines) plus `AGENTS.md` (~760 lines) |
| Document lifecycle states | Present | `deployment-architecture-v0.2.md` carries explicit approved/proposed status |
| Architecture Decision Records | Absent | No `docs/adr/`. Rationale is embedded in prose and code comments, recoverable but not indexed |
| Task Docs in practice | Partial | The requirement and template exist; `docs/tasks/` contains only `_template.md`. Not yet exercised on a real task |

The process layer is the project's strongest asset and exceeds what most MVPs carry. The one structural gap is ADRs: decisions such as "authorization in the service layer rather than middleware" and "404 instead of 403 for cross-tenant session access" are real architectural choices with real rationale, currently discoverable only by reading the code that implements them.

### 2.2 Verification

| Capability | Level | Evidence |
|---|---|---|
| Go unit tests | Present | 16 tests across `internal/prescription`, `internal/db`, `internal/bootstrap`, `cmd/api` |
| Go integration tests | **Partial** | 5 files, ~1,624 lines, covering exercise, workout, scheduledworkout, workoutsession, migrate — **all skipped unless `TEST_DATABASE_URL` is set** |
| Auth package tests | **Absent** | `internal/authn` — Firebase token verification and the middleware guarding every `/api/v1/*` route — has no test file |
| HTTP handler tests | Partial | `cmd/api/main.go` is 753 lines of handlers; `main_test.go` covers only request-struct decoding. No `httptest` coverage |
| Frontend tests | Absent | No jest/vitest/playwright config, no test files, no test script in `apps/web/package.json` |
| End-to-end tests | Absent | Exists only as manual deployment phase D6 |
| Go lint config | Absent | No `.golangci.yml`. `go vet` is available but not enforced |
| Frontend lint | Present | `apps/web/eslint.config.mjs`, run via `npm run lint` |
| Pre-commit hooks | Absent | No husky, no lint-staged, no `.pre-commit-config.yaml` |

Test code is roughly **2,183 lines against ~4,100 lines of production Go** — a healthy ratio on paper. The problem is not volume, it is execution: a bare `go test ./...` runs 16 unit tests and skips everything that touches the database. The integration suite is the most valuable testing asset in the repository and it does not run by default anywhere.

### 2.3 Automation and Delivery

| Capability | Level | Evidence |
|---|---|---|
| Continuous integration | **Absent** | No `.github/`, no `cloudbuild.yaml`, no `Makefile`, no shell scripts anywhere |
| API containerization | Present | `apps/api/Dockerfile` — multi-stage, distroless, three binaries, ~79.5MB |
| Web containerization | Absent | No Dockerfile under `apps/web` (not required for a Vercel target) |
| Local dev environment | Partial | `docker-compose.yml` provides Postgres 16 only; API and web run on the host |
| Migration tooling | Present | `cmd/migrate` + `internal/migrate` with a `schema_migrations` checksum ledger that refuses to proceed if an applied migration's content changed |
| Seed/bootstrap tooling | Present | `cmd/bootstrap` + `internal/bootstrap`, manifest-driven with `DisallowUnknownFields`, idempotent upserts |
| Deployed environment | **Absent** | Phases D2–D8 unstarted. Nothing runs anywhere but localhost. No live URL |
| Infrastructure as code | Absent | No Terraform/Pulumi. Deployment is documented prose, executed by hand |
| Kubernetes | Absent | Deliberate — see §5 |

### 2.4 Operability

| Capability | Level | Evidence |
|---|---|---|
| Health endpoints | Present | `GET /health` (static), `GET /ready` (pings the pool) in `cmd/api/main.go` |
| Graceful shutdown | Present | SIGTERM handling, verified in phase D1a |
| Connection pool tuning | Present | `db.NewPool` — MaxConns 4/2 by entrypoint, idle 5m, lifetime 30m |
| Request timeouts | Present | `http.TimeoutHandler` 10s plus server Read/Write timeouts |
| SSL mode safety | Present | Host-based `AssertSafeSSLMode`, unit-tested |
| Structured logging | **Absent** | 9 `log.Println`/`Printf` calls total. Reaches Cloud Logging as unstructured text with no severity. Owned by unstarted phase D1c |
| Request/access logging | Absent | No middleware |
| Metrics | Absent | No Prometheus, no OpenTelemetry instrumentation |
| Error tracking | Absent | No Sentry or equivalent |
| Frontend observability | Absent | No analytics, no error boundary reporting |

### 2.5 Product Completeness

The core loop is **roughly 85–90% functional end to end**: create exercise → build workout with planned sets → schedule to athletes → athlete opens Today → start session → log planned and extra sets → complete → coach reviews. Every link has schema, service, handler, and UI.

| Gap | Level | Evidence |
|---|---|---|
| User / relationship creation | **Absent from the product** | `internal/athlete` exposes only `ListForCoach`. Users and coach-athlete links exist solely via the offline `cmd/bootstrap` CLI reading a hand-edited manifest |
| Coach review depth | Partial | Single-session detail view only. No history, aggregate, or progress view |
| Set log correction | Absent | No edit or delete after write (`mvp-specification.md` Story 6) |
| PWA capability | **Absent despite the label** | No `manifest.json`, no service worker, no PWA plugin in `next.config.ts`. It is a mobile-styled web app |
| AI/LLM features | Absent | Zero integration. No SDK in `go.mod` or `package.json`. Voice and video remain spec-only |
| Frontend structure | Partial | No shared component directory, no state library. `app/coach/calendar/page.tsx` is 871 lines |

---

## 3. Gaps and Their Consequences

Ordered by how soon each one bites.

**1. No CI — nothing verifies anything automatically.**
The integration suite is the best evidence that this system works, and no mechanism guarantees it still passes. Every green run is a manual, local, unrecorded event. The longer this persists, the more likely it becomes that the suite has silently rotted, and the less anyone will trust it enough to run it. This gap also compounds every other testing gap below it: adding tests without CI adds assets nobody executes.

**2. Integration tests skip by default.**
`go test ./...` returning green currently means "16 unit tests passed," which is a materially weaker statement than it appears. Anyone — including a future session of this project — can reasonably read a green run as validation it does not provide.

**3. `internal/authn` is untested.**
It verifies Firebase ID tokens and gates every authenticated route. It is simultaneously the most security-sensitive package and the only major one with no tests at all. A regression here fails open or fails closed across the entire API, and nothing would catch it.

**4. Nothing is deployed.**
No live environment means no URL to demonstrate, no production-shaped feedback, and a growing set of unvalidated assumptions in `deployment-architecture-v0.2.md`. Deployment risk does not decrease while deferred; it accumulates. Phases D2–D5 are the smallest path to retiring it.

**5. The product cannot onboard its own users.**
Creating a coach, an athlete, or the relationship between them requires operator access to run a CLI against a hand-edited manifest. The core loop therefore cannot be started by anyone who is not the developer. This is *scoped as deferred* in `mvp-specification.md` and is a legitimate decision — but it means the system cannot yet be handed to a real user or demonstrated from a cold start, which is precisely what `AGENTS.md` §21 says this repository exists to do.

**6. Unstructured logging.**
Once deployed, every log line lands in Cloud Logging as severity-less text. The first production incident is the worst possible time to discover there is no way to filter for errors or correlate a request.

**7. The PWA claim is unsupported.**
Documentation describes a PWA; the implementation has no manifest and no service worker. Either the capability or the claim should change. Unsupported claims in documentation erode trust in the documentation that *is* accurate — and this repository's documentation is otherwise its strongest asset.

**8. An 871-line page component.**
`app/coach/calendar/page.tsx` holds month-grid rendering, athlete selection, workout assignment, inline workout building, and session start. It works, but it is the file where the next frontend bug will be hardest to isolate.

---

## 4. Priorities

**P0 — restore the meaning of "it works"**

- **(a) GitHub Actions CI.** Postgres service container, `TEST_DATABASE_URL` set so integration tests actually execute, plus `go vet ./...`, `npm run lint`, `npm run build`. This single change converts ~1,624 lines of existing integration tests from dormant to load-bearing. Highest return of anything in this document.
- **(b) Tests for `internal/authn`.** Valid token, expired token, unknown UID, malformed header, missing header. Small surface, disproportionate risk.
- **(c) Deploy — phases D2 through D5.** GCP foundation, secrets, image publish, migration run, Cloud Run, Vercel. Produces a live URL and converts deployment assumptions into facts.

**P1 — make the loop startable and keep it that way**

- **(d) Minimal athlete onboarding.** The smallest API plus UI that lets a coach add an athlete without CLI access. This is a scope change and must go through `AGENTS.md` §6 and §9 first.
- **(e) One Playwright end-to-end happy path.** Login → schedule → athlete logs a set → coach reviews. One test that proves the whole chain is worth more than broad shallow coverage.
- **(f) `.golangci.yml`** wired into CI.

**P2 — operability and structure**

- **(g)** Split `app/coach/calendar/page.tsx` into a shared component layer.
- **(h)** Phase D1c structured logging with `slog`, JSON handler, severity, request IDs.
- **(i)** Either implement the PWA (manifest + service worker) or correct the claim in the docs.

The ordering is deliberate: P0(a) first because every later testing investment is worth less without it.

---

## 5. Deliberate Non-Goals

These are absent by decision, not by oversight. Recording them here prevents them from being re-litigated as gaps.

**Kubernetes.** The deployment target is Cloud Run — a serverless container runtime that supplies scheduling, scaling, and rollout natively. Adding K8s would introduce cluster lifecycle management, node operations, and manifest sprawl for an MVP with a single stateless service. Revisit only if multi-service orchestration or a non-managed runtime becomes necessary.

**Microservices.** The API is a modular monolith with package-per-domain boundaries (`internal/exercise`, `internal/workout`, `internal/scheduledworkout`, `internal/workoutsession`, `internal/prescription`). These boundaries are enforced in code and would be the natural seams if extraction were ever needed. Splitting now would add network calls, distributed transactions, and deployment coordination to a system that has neither the scale nor the team size to require them. The boundaries are the valuable part; the process separation is not.

**Infrastructure as code.** Deferred until the manual deployment path is executed and understood at least once. `deployment-architecture-v0.2.md` phase D8 states this explicitly: automate the path you have walked, not the one you have imagined. Codifying unverified infrastructure produces confident, wrong automation.

**AI features.** Voice logging and video analysis are specified but unimplemented, deliberately behind core-loop stability (`AGENTS.md` §3). The architecture reserves the seam — `AGENTS.md` §16 requires AI output to pass through the same validation and business logic as manual input, with no separate write path — so this is an extension point, not a rewrite.

**Organizations, programs, calendar hierarchy, supersets.** Explicitly out of scope in `mvp-specification.md` and `AGENTS.md` §3, and absent from the schema by intent (`migrations/0001_init_schema.up.sql` header).

**Set log editing and deletion.** Deferred, but with a caveat worth stating: this interacts with the prescription-versus-actual separation in §5 of `AGENTS.md`. Whenever it is implemented, it must preserve the invariant that historical performance data is never silently altered.

---

## 6. Summary

The project has an unusual profile: **process and domain modeling are ahead of delivery automation.** The data model correctly separates prescription from actual performance and freezes a snapshot at scheduling time so template edits cannot corrupt training history. The migration ledger refuses to run against tampered migrations. Authorization decisions are deliberate down to the choice of status code. The documentation system carries lifecycle states.

Against that, there is no CI, the best tests do not run by default, the most security-sensitive package is untested, and nothing is deployed.

The gap is narrower than it looks, because the expensive part — knowing what to build and modeling it correctly — is done. P0(a) alone, a single CI workflow, converts a large existing body of dormant verification into continuous verification. That is the highest-leverage change available to this project today.
