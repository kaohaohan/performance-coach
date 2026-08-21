# Task: Isolated staging backend for Workout Draft/Edit Preview acceptance

- Date opened: 2026-08-21
- Related contract sections: AGENTS.md §§6–10, 12–15, 21; `docs/deployment-architecture-v0.2.md` §§3–4, 7–13; ADR-001; ADR-002; `docs/deployment-checkpoint.md`
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger:
  - The Workout Draft/Edit feature branch already contains the backend routes required by Edit Assigned Workout:
    - `GET /api/v1/scheduled-workouts/{id}`
    - `PUT /api/v1/scheduled-workouts/{id}`
  - The Vercel Preview is still reaching an older deployed API build where those patterns are not registered, so Edit receives a bare router-level 404 before authentication/business logic can run.
  - Phase 0 inspection reported that Vercel currently shares one `BACKEND_BASE_URL` across Production and Preview, the reachable backend predates the new routes, and there is no isolated Preview API/database path.
  - The source branch `claude/workout-draft-persistence-edit-2m93wo` is at `ffb324e`; `staging` already contains that product code through merge commit `5e7e3b4`. This task is therefore a deployment/isolation task, not a reimplementation of the GET/PUT API.
  - `docs/deployment-checkpoint.md` is explicitly stale regarding current deployed infrastructure and must not be used as proof of present Cloud Run, Neon, or Vercel state.
- Options considered:
  1. Replace the currently serving API with a build from the feature branch and let Preview continue sharing it.
  2. Create an isolated non-Production backend path: Neon child branch + staging-only database secret/identity + separate Cloud Run service + branch-specific Vercel `BACKEND_BASE_URL`.
  3. Point Vercel Preview at a developer-machine/local tunnel while testing Edit.
- Trade-offs (per option):
  - Option 1 is the smallest operationally, but it makes Preview acceptance mutate the currently serving backend and preserves the exact environment-coupling that caused the ambiguity. It is rejected because the user explicitly requested a non-Production test path and AGENTS.md §15 forbids modifying production cloud resources without explicit production authorization.
  - Option 2 creates more resources and requires coordinated Neon/GCP/Vercel configuration, but it gives the Preview an independently identifiable backend and database, makes rollback trivial (remove the branch override or delete staging resources), and allows the exact feature-branch image to be tested before any later production decision. This is selected.
  - Option 3 avoids cloud provisioning, but it is not durable, is sensitive to laptop/network state, does not reproduce Cloud Run identity/secret/runtime behavior, and is unsuitable as the shared staging path after the code is merged. It is rejected.
- Selected option and why:
  - Select Option 2. Build an immutable API image from the feature branch, deploy it as `performance-coach-api-staging` in `asia-southeast1`, connect it to a Neon child branch named `staging`, and override `BACKEND_BASE_URL` only for the feature branch's Vercel Preview. After acceptance, the same staging API may serve the `staging` frontend branch.
  - This deliberately introduces a non-Production acceptance environment even though `docs/deployment-architecture-v0.2.md` currently lists only LOCAL and PRODUCTION/PILOT. For this task it is a scoped test-environment exception, not a silent redefinition of production topology. If staging becomes a permanent release tier, record that separately in the canonical deployment architecture/ADR rather than normalizing the exception through implementation alone.
- Risks & unknowns:
  - All reported cloud state must be re-verified immediately before writes; the checkpoint is stale and no prior transcript is sufficient authority for current resource state.
  - The Neon project was reported to have only the `main` branch. A child branch copies the parent's schema/data and roles at branch creation, but the actual staging runtime role, grants, endpoint, and password behavior must be verified without printing credentials.
  - The current project is still in ADR-002's disposable internal-testing phase. Do not copy real/non-recoverable athlete or coach data into a test branch after the Launch-plan upgrade trigger is reached; revisit the staging data strategy first.
  - The current API service is demonstrably using some working database/identity path, but the exact current revision, database, secret, and IAM bindings were not established by the stale checkpoint. Do not reuse a secret or service account merely by guessing its role from its name.
  - Firebase authentication may remain shared for this acceptance environment because the feature under test is backend scheduling/edit behavior, but the database must remain isolated. This means the same Firebase user can resolve to a copied staging `users` row; verify the required test identities exist after branch creation.
  - A branch-specific Vercel variable takes effect only after a new Preview deployment. The Production-scoped `BACKEND_BASE_URL` must remain unchanged.
  - The new API image must be deployed by immutable digest. A mutable tag is only a build/push handle, never the deployment identity recorded as the accepted revision.
- Dependencies / blockers:
  - User approval for this Task Doc is required before implementation, per AGENTS.md §§8–10.
  - Working authenticated access is required for Neon, GCP project `dontworkout`, Artifact Registry, Cloud Run, Secret Manager/IAM, and the Vercel project.
  - `go test ./...` for `apps/api` must pass from the exact feature-branch source before image publication.
  - No production Cloud Run service, Production Vercel environment variable, production database branch, or `main` branch may be changed by this task.

## 2. Technical Design

- Affected files/components:
  - Repository:
    - `docs/tasks/2026-08-21-staging-backend-deployment.md`
    - `docs/deployment-checkpoint.md` only if final verified infrastructure facts need to replace/extend its stale warning after implementation.
  - Neon project `performance-coach-mvp`:
    - new child branch `staging`, created from the current internal-testing `main` branch after read-only verification.
  - GCP project `dontworkout`:
    - Artifact Registry: a new API image built from feature-branch source and recorded by digest.
    - Secret Manager: staging-only database URL secret; never reuse or overwrite the production/runtime secret.
    - IAM: staging API identity receives access only to the staging database secret and only the minimum permissions required to run the service.
    - Cloud Run: new service `performance-coach-api-staging` in `asia-southeast1`.
  - Vercel:
    - branch-specific Preview `BACKEND_BASE_URL` for `claude/workout-draft-persistence-edit-2m93wo`.
    - after acceptance, the `staging` frontend branch may be pointed at the same staging API without changing Production scope.
- Data flow:
  1. Run the backend test suite against the exact feature-branch checkout.
  2. Reconcile current Neon/GCP/Vercel state read-only and record only non-secret identifiers needed for the deployment.
  3. Create Neon child branch `staging` from `main`. Confirm schema/data presence and the intended runtime role/grants on the child branch without retrieving or logging secret payloads.
  4. Create or rotate staging-only runtime credentials as needed and stream the resulting pooled staging `DATABASE_URL` directly into a staging Secret Manager secret. Do not print, persist, or copy the DSN through chat/log files.
  5. Use a dedicated staging runtime service account where feasible; grant it secret-level `roles/secretmanager.secretAccessor` only on the staging database secret. Do not add Cloud SQL roles or service-account keys.
  6. Build `apps/api/Dockerfile` from the feature branch using the repository's required build context, push to the existing Artifact Registry repository, and capture the immutable image digest.
  7. Deploy `performance-coach-api-staging` from that digest in `asia-southeast1`, using the staging runtime identity, staging `DATABASE_URL`, the existing Firebase project ID, min instances `0`, max instances `3`, concurrency `20`, and public invocation consistent with the existing same-origin Vercel proxy architecture.
  8. Verify the staging service before connecting Vercel:
     - `/health` returns 200.
     - `/ready` returns 200 after database connectivity is established.
     - an unauthenticated request to `GET /api/v1/scheduled-workouts/{id}` reaches the registered route/auth layer (JSON 401 envelope), proving the old router-level bare 404 is gone.
     - the same registration check applies to `PUT /api/v1/scheduled-workouts/{id}`.
  9. Set `BACKEND_BASE_URL` only for the feature branch's Preview environment to the new Cloud Run staging URL, then redeploy that Preview so the value takes effect.
  10. Run authenticated Preview acceptance. The user owns the final UI acceptance decision for Edit Assigned Workout / Save Changes.
  11. After acceptance, merge only the new task/deployment records or fixes from this source branch into `staging`; do not merge to `main`. Point the `staging` frontend branch at the same staging API if it is not already using a dedicated staging/custom environment.
- API changes:
  - None in this task. The required GET/PUT route implementations are already present in the feature branch and already merged into `staging` product code.
  - Verification explicitly distinguishes an unregistered router-level 404 from the API's JSON error envelope; the acceptance condition is that requests reach the registered route and normal auth/business logic.
- State transitions:
  - Preview backend routing: shared/unknown old backend -> branch-specific `performance-coach-api-staging`.
  - Neon: `main` only -> `main` plus isolated `staging` child branch.
  - Cloud Run: no known isolated staging service -> verified `performance-coach-api-staging` revision pinned to the feature-branch image digest.
  - Vercel feature Preview: shared `BACKEND_BASE_URL` -> feature-branch override -> redeployed Preview consuming staging API.
  - Source control: feature branch remains the acceptance branch -> after user acceptance, its new deployment records/fixes are merged into `staging`; `main` remains untouched.
- Frontend state/UI impact:
  - No frontend code change is planned. The Preview's existing Edit button should stop failing at route lookup once its backend base URL points to the new service.
  - Existing Draft/Resume/Save Draft behavior remains unchanged and should be regression-tested on the same Preview.
- Backward compatibility / data backfill:
  - Production/Pilot is untouched; no cutover occurs.
  - No schema migration or data backfill is required for GET/PUT Scheduled Workout in this task.
  - The staging branch begins as an isolated copy of the current internal-test branch and diverges independently after creation.
  - Rollback is configuration/resource based: restore the feature Preview's prior branch-specific variable state (or remove the override) and stop/delete staging resources after verification. Never roll back by mutating production data.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Commit this Task Doc on the feature branch.
  2. Re-run read-only cloud re-entry checks and backend tests against the exact branch.
  3. Provision the isolated Neon staging branch, staging secret, and least-privilege runtime identity.
  4. Build/push the exact branch API image and record its immutable digest.
  5. Deploy and verify the separate Cloud Run staging API.
  6. Apply the branch-specific Vercel backend override and redeploy Preview.
  7. Run authenticated Preview acceptance for Draft regressions and Edit/Save Changes.
  8. After user acceptance, merge only this task's new deployment records/fixes into `staging`; leave `main` and Production unchanged.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Feature branch contains GET/PUT; old reachable API lacks those patterns; shared Preview backend path and stale deployment checkpoint identified in the preceding inspection. GitHub reconciliation confirms source `ffb324e` and `staging` merge `5e7e3b4`. |
| Gate 1 — Task Doc | Done | This document is the only repository write authorized by the user's `批准 Phase 1` approval. |
| Gate 2 — exact-branch tests + cloud re-entry | Not Started | Re-verify current Neon, GCP, Artifact Registry, Cloud Run, Secret Manager/IAM, and Vercel state before any cloud mutation. |
| Gate 3 — isolated Neon/secret/runtime identity | Not Started | Staging-only resources; no production secret or DB mutation. |
| Gate 4 — immutable API image | Not Started | Build from exact feature branch; deploy by digest. |
| Gate 5 — Cloud Run staging API | Not Started | `asia-southeast1`; verify health/readiness and route registration before Vercel cutover. |
| Gate 6 — Vercel feature-branch override | Not Started | Preview only; requires redeploy; Production scope unchanged. |
| Gate 7 — authenticated Preview acceptance | Not Started | Draft regression plus Edit Assigned Workout / Save Changes. |
| Gate 8 — post-acceptance merge to `staging` | Not Started | Only after user approval; no `main` merge. |

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
