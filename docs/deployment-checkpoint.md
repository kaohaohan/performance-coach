# Deployment Checkpoint — Paused for Product Work

Status: **PAUSED**, 2026-08-17. Deployment work is intentionally on hold while the team returns to Coach/Athlete core-loop product implementation. This is a status record only — it does not modify or supersede `docs/deployment-architecture-v0.2.md`, which remains the sole canonical architecture/runbook source.

**Preview-backend validation environment, 2026-08-22** — this is a bounded, non-Production validation setup for `claude/workout-draft-persistence-edit-2m93wo`, not a resumption of the production rollout below. A dedicated Cloud Run service `performance-coach-api-staging` now runs in `asia-southeast1`, backed by the disposable Neon child branch `staging` (`br-gentle-mouse-aziy6y8w`). Its immutable image is `asia-east1-docker.pkg.dev/dontworkout/performance-coach/api@sha256:7b1da260ff07a8c18f113fee0bac5bbd42dce0040a335fe8ebe7fff802f9cde9` (source `1bff00b0bd9d07f955f16d75fe481990c39b0133`). Vercel has a Preview-only, branch-specific `BACKEND_BASE_URL` override for that feature branch; Production configuration and the existing `performance-coach-api` service/traffic were not changed. The staging database branch reuses the Firebase project for authentication, so it is not suitable for real-user data or a claim of full environment isolation.

**Database-hosting decision revised, 2026-08-18** — see `docs/adr/ADR-001-use-neon-launch-postgresql-for-mvp-pilot.md`. The database is now **Neon PostgreSQL in `aws-ap-southeast-1` (Singapore)**, not Cloud SQL, and Cloud Run relocates from `asia-east1` to **`asia-southeast1`** to stay colocated. The "What is done" and "Confirmed GCP state" sections below describe state as of the 2026-08-17 pause and are still accurate for what exists (D1a/D1b/D1c, the Artifact Registry image, the empty Cloud SQL/Secret Manager/service-account state) — nothing there needs correcting.

**Rollout staged further, 2026-08-18** — see `docs/adr/ADR-002-stage-neon-free-before-launch-upgrade.md`. The D2 project is provisioned on the **Free** plan for the current disposable-data internal-testing phase, not Launch. Launch is a **required** upgrade gated on an explicit trigger (primarily: before real, non-recoverable athlete/coach data enters the system) — see ADR-002's "Upgrade trigger" section. This is not a reversal of the "backups/PITR mandatory" principle in ADR-001/v0.2 — it defers Launch until that principle actually applies.

**⚠ This record is STALE as of 2026-08-21 — a backend is deployed and serving.** While manually testing a Vercel Preview, the Coach Calendar successfully loaded athletes, workouts, and scheduled workouts from the Go API. That is only possible if `BACKEND_BASE_URL` is set in Vercel to a reachable Go API — which directly contradicts "Cloud Run services/jobs: **none**" in "Confirmed GCP state at pause" below, and contradicts D4/D5 being listed as future work in the Resume Point.

The deployed build also **predates commit `ca2100b`**: `GET`/`PUT /api/v1/scheduled-workouts/{id}` come back as a bare `404` rather than this API's JSON error envelope. That distinction is diagnostic, not cosmetic — Go's `ServeMux` answers an unregistered pattern with `text/plain` "404 page not found" *before* auth middleware runs, whereas a registered route returns `{"error":{"code":"NOT_FOUND",…}}` as `application/json`. The frontend surfaced the generic `Request failed (404)`, i.e. a body it could not parse as the envelope, so the route is absent from the running build rather than the row being absent from the database. (Evidence is the Preview's error text plus a local reproduction of both 404 shapes; the deployed host was not probed directly.)

What is **not** established: where that API runs, which revision, which database it points at, or whether any of it matches the ADR-001/ADR-002 decisions. Do not infer any of that from this document.

**Treat "Confirmed GCP state at pause" and the Resume Point below as unverified history, not current state.** Re-run the Phase 0 read-only re-entry check (AGENTS.md §8) against real infrastructure before acting on either — the instruction to do so already existed at the end of this file; this notice exists because the stale numbers were read as current at least once and produced a wrong conclusion.

**Deployment ordering, from the same finding:** the Coach Calendar's Edit-assigned-workout flow calls `GET /api/v1/scheduled-workouts/{id}` and `PUT /api/v1/scheduled-workouts/{id}`. Shipping that frontend ahead of the API build that serves them puts a visibly broken **Edit** button in front of Coaches. The API must deploy first, or both together.

Only the **Resume Point** changes, replaced below.

## What is done

- **D1a** — Container readiness. `apps/api/Dockerfile` + root `.dockerignore`. Done.
- **D1b** — Production database tooling. `cmd/api` / `cmd/migrate` / `cmd/bootstrap` entrypoints, per-entrypoint config loaders, bounded pool config, host-based `sslmode` assertion. Done.
- **D1c** — Structured logging. JSON stdout logging, request IDs, credential-leak closures. Done.
- **D2 (superseded)** — The Cloud SQL cost gate recorded here at pause (`db-g1-small`, `asia-east1`, ≈$28/month against the $100/month guardrail) is **superseded by ADR-001** (2026-08-18): the database is now Neon Launch in `aws-ap-southeast-1`. No Cloud SQL instance was ever created, so nothing needs to be undone — see the revised Resume Point below.
- **Artifact Registry** — Repository exists: `asia-east1-docker.pkg.dev/dontworkout/performance-coach`.
- **D3b** — First image publish proven. Canonical immutable image reference:

  ```
  asia-east1-docker.pkg.dev/dontworkout/performance-coach/api@sha256:728fa3d46af09d966ff8796150c92471a18256f8429e0cccf11835b3ef9ea21f
  ```

  This digest must be used by D3c and D4 unless a new approved build supersedes it.

- **Git integration** — All of the above is committed and fast-forward-merged onto `main` at commit `d433923a35ce06b2dad3896b36c046f60fe72075` (local; not yet pushed to `origin/main` as of this checkpoint). `main`'s `apps/api/` tree is verified identical to the tree the D3b image was built from — no rebuild required when work resumes.

## Confirmed GCP state at pause (project `dontworkout`, region `asia-east1`)

- Billing linked; required D2 APIs enabled.
- Artifact Registry: image present as above.
- Cloud SQL instances: **none**.
- Service accounts: only the default Firebase Admin SDK SA and the default Compute Engine SA — no dedicated runtime/migration SAs created.
- Secret Manager: **empty**.
- Cloud Run services/jobs: **none**.

## Exact resume point (revised by ADR-001, 2026-08-18)

Resume at **Neon project creation** (the new D2), then proceed strictly in this order per the dependency chain in `docs/deployment-architecture-v0.2.md` §11:

1. **Neon project creation (D2)** — Neon **Free** plan for the current internal-testing phase (ADR-002), region `aws-ap-southeast-1` (Singapore), PostgreSQL 16; re-verify current Free-plan limits before creating; record the connection details. **Track the ADR-002 upgrade trigger from this point forward** — Launch is required before real, non-recoverable athlete/coach data enters the system, not an optional later step.
2. **D3a — identities & secrets** — dedicated runtime service account (**Secret Manager Secret Accessor only — no Cloud SQL Client role, per ADR-001/§6**) and migration service account (least-privilege DDL credential, granted as a Neon database role); Secret Manager entries for `DATABASE_URL` (Neon connection string, `sslmode=require`) and the migration credential.
3. **D3c — migration & bootstrap** — run against the D3b digest below (reusable unmodified, per the ADR-001 code audit); verify schema state against Neon; run the reviewed bootstrap manifest (§10); perform the one-time restore drill (§11, §14) using Neon's restore mechanism and record elapsed time.
4. **D4 — Cloud Run API** — deploy from the same D3b digest, **in `asia-southeast1`** (revised from `asia-east1`); no Cloud SQL attachment (none needed); public invocation, bounded scaling (min 0 / max 3 / concurrency 20), secrets, `/ready` as startup probe only, ADC identity.
5. **D5 — Vercel frontend** — connect `apps/web`, production-only public Firebase config + `BACKEND_BASE_URL` (now pointing at the `asia-southeast1` Cloud Run URL).
6. **D6 — production E2E** — full core-loop verification, latency/cold-start measurement (including Neon scale-to-zero cold start, and Taiwan-to-Singapore browser latency if pilot users are Taiwan-based — see ADR-001 trade-offs), checklist in §13.

## Explicit non-actions while paused

- No Neon, Cloud Run, Secret Manager, service account, or Job creation.
- No further changes to `docs/deployment-architecture-v0.2.md` or ADR-001 decisions (region, plan, phase order, etc.) without a recorded reason.
- No image rebuild — the recorded digest remains canonical and does not need to be regenerated for the resume to proceed; `main`'s `apps/api/` tree still matches its source, and the ADR-001 code audit confirmed nothing Cloud-SQL-specific is compiled into it.

When resuming, re-run the Phase 0 read-only re-entry check (AGENTS.md §8) against current GCP state before the first write operation, since time may have passed and state should be re-verified rather than assumed from this checkpoint.
