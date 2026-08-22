# Task: Preview backend for scheduled-workout editing

- Date opened: 2026-08-21
- Related contract sections: AGENTS.md §§6–10, 12–18, 21; `docs/go-backend-api-contract-v0.1.md` §3.5; `docs/deployment-architecture-v0.2.md` §§4–9, 11–14
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger:
  - The feature branch `claude/workout-draft-persistence-edit-2m93wo` contains the Coach-only `GET` and `PUT /api/v1/scheduled-workouts/{id}` implementation, contract, and integration tests, but its Vercel Preview currently proxies to the older production Cloud Run revision `performance-coach-api-00002-hsf`.
  - That revision uses image tag `coachsignup-d2fc71b`, which predates the scheduled-workout detail/update implementation. The registered-route diagnostic is therefore a bare `text/plain` 404 rather than the API JSON envelope.
  - Vercel currently scopes `BACKEND_BASE_URL` and all Firebase web configuration to both Production and Preview. There is no branch-specific backend override, dedicated preview Cloud Run service, or dedicated preview database branch.
  - The user wants to validate Edit Assigned Workout on the feature Preview before accepting the incremental work into `staging`; no Production deployment is authorized.
- Options considered:
  1. Deploy the feature image as a new revision of the existing `performance-coach-api` service and move its normal traffic to it.
  2. Deploy a tagged/no-traffic revision on the existing service while continuing to use the production Neon branch.
  3. Create a dedicated Neon child branch and a dedicated `performance-coach-api-staging` Cloud Run service, then point only the feature Git branch's Vercel Preview at that service.
  4. Create a fully separate Firebase project, Neon project, Cloud Run service, and Vercel staging project.
- Trade-offs (per option):
  - Option 1 is operationally shortest, but changes the only live backend and its Production callers before Preview acceptance. It violates the requested preview-first rollout and is rejected.
  - Option 2 isolates API traffic but not data. A Preview test could still mutate the production database, which violates `docs/deployment-architecture-v0.2.md` §4/§13 and is rejected.
  - Option 3 isolates API traffic and PostgreSQL writes while reusing the existing Firebase identity provider. It adds a small number of bounded staging resources, preserves the current browser accounts for testing, and lets the feature Preview be verified without Production traffic or data mutation. It is not a fully isolated long-lived staging environment because Firebase remains shared.
  - Option 4 gives the strongest isolation, but requires new Firebase configuration, authorized domains, test identities, bootstrap manifests, and likely a separate Vercel project. That is disproportionate to validating two already-implemented endpoints and should be a separately approved staging-platform task.
- Selected option and why:
  - Select Option 3. It is the smallest approach that fixes the actual 404 while keeping Production API traffic and post-fork database writes untouched.
- Risks & unknowns:
  - The Neon project is on the Free plan and its `main` branch is not protected. Neon documents that child branches copy databases and roles and, for an unprotected parent, retain the role passwords. The staging connection uses a branch-specific host and a separate GCP secret, but the copied API-role password remains valid on the parent branch. No credential may be printed, logged, placed in a command argument, written to a file, or surfaced in an AI transcript. Strong credential isolation requires a protected parent, a separately created restricted child role, or a separate project and remains follow-up work before real-user data.
  - Creating a child branch copies the current data snapshot. Writes after the fork are isolated, but existing rows are present in staging. This is acceptable only while the database contains disposable internal-test data. If real or non-recoverable athlete/coach data has entered the system, stop and reassess before branch creation.
  - Firebase remains shared. Firebase tokens are accepted by both services, while authorization and application data remain isolated by the branch-specific database. This tactical setup must not be described as a fully isolated staging environment.
  - The current production API service uses concurrency 80 and a default TCP startup probe, while the canonical target is concurrency 20 with explicit readiness behavior. The new staging service will use the canonical bounded configuration; changing the production service is outside this task.
  - The current production API service and migration job use different image digests. This task has no schema change and must not run the production migration job. The staging branch is cloned after the existing schema is present, and its ledger/table state must be checked before serving traffic.
  - Vercel environment-variable changes apply only to deployments built after the change. A branch redeploy is required after adding the branch-specific override.
- Dependencies / blockers:
  - Neon Console access is available and currently shows one `main` branch in project `performance-coach-mvp` (`purple-term-41387441`).
  - GCP account `haohan920@gmail.com` is active for project `dontworkout`; Cloud Run, Cloud Build, Artifact Registry, Secret Manager, and the existing workload identities are visible.
  - Vercel project access is available for `kaohaohans-projects/performance-coach`.
  - Transferring a branch-specific database DSN into GCP Secret Manager requires an action-time confirmation because it transmits sensitive credential material between services. The value must remain opaque throughout the operation.

## 2. Technical Design

- Affected files/components:
  - Repository:
    - `docs/tasks/2026-08-21-preview-backend-for-scheduled-workout-edit.md`
    - `docs/deployment-checkpoint.md`
  - Neon project `performance-coach-mvp`: new child branch `staging` from `main`.
  - GCP project `dontworkout`:
    - new Secret Manager secret `performance-coach-staging-api-database-url`;
    - new service account `performance-coach-api-staging@dontworkout.iam.gserviceaccount.com`;
    - new Cloud Run service `performance-coach-api-staging` in `asia-southeast1`;
    - one immutable API image in the existing `asia-east1-docker.pkg.dev/dontworkout/performance-coach/api` repository.
  - Vercel project `kaohaohans-projects/performance-coach`: a Preview-only, Git-branch-specific `BACKEND_BASE_URL` override for `claude/workout-draft-persistence-edit-2m93wo`.
- Data flow:
  1. The browser loads the Vercel deployment for `claude/workout-draft-persistence-edit-2m93wo`.
  2. Next.js rewrites `/backend/*` to the branch-specific `BACKEND_BASE_URL`.
  3. The dedicated public Cloud Run staging service receives the request and applies the existing Firebase authentication and Go authorization middleware.
  4. The service connects with the least-privilege `performance_coach_api` role to the Neon `staging` branch through the branch-specific pooled endpoint stored in its dedicated Secret Manager secret.
  5. Production Vercel deployments continue using the existing `BACKEND_BASE_URL`; the existing `performance-coach-api` service continues receiving 100% of its unchanged traffic.
- Image build and provenance:
  - Run the relevant Go tests before building.
  - Build from the exact pushed feature-branch commit with the existing successful Cloud Build pattern: `docker build -f apps/api/Dockerfile -t <immutable-tag> .`.
  - Use a tag containing the source short SHA, then record and deploy the returned immutable digest rather than relying on the mutable tag.
  - Do not run a migration job: this change adds routes/business logic but no migration files or schema requirements beyond the cloned parent state.
- Neon branch and credential flow:
  - Create child branch `staging` from current `main` only after confirming the source contains disposable internal-test data.
  - Confirm the child has `neondb`, the expected schema/ledger, and the existing restricted `performance_coach_api` role.
  - Obtain the child branch's pooled endpoint/DSN without emitting it. Stream the branch-specific DSN directly into version 1 of `performance-coach-staging-api-database-url`; never retrieve the secret afterward. Verification is limited to secret-version metadata and successful `/ready`.
  - No production secret version is modified, disabled, copied to a file, or displayed.
- GCP identity and Cloud Run configuration:
  - Create `performance-coach-api-staging` without user-managed keys.
  - Grant it `roles/secretmanager.secretAccessor` only on `performance-coach-staging-api-database-url`; do not grant project-wide Secret Accessor, Editor, Cloud SQL roles, or access to the production database secret.
  - Deploy `performance-coach-api-staging` in `asia-southeast1` from the recorded digest with:
    - public Cloud Run invocation, while all business routes remain protected by Firebase auth;
    - `FIREBASE_PROJECT_ID=dontworkout`;
    - `DATABASE_URL` pinned to secret version `1`;
    - min instances `0`, max instances `1`, concurrency `20`;
    - CPU `1`, memory `512Mi`, port `8080`;
    - explicit HTTP startup probe to `/ready`;
    - no Production traffic, migration command, or Cloud SQL attachment.
- Vercel state:
  - Preserve the existing Production and general Preview variables.
  - Add the staging Cloud Run URL as `BACKEND_BASE_URL` only for Preview deployments of `claude/workout-draft-persistence-edit-2m93wo`.
  - Trigger one new deployment of that branch after the override exists. Do not promote it to Production.
  - After user acceptance, add or move the same override to lowercase `staging` as a separately verified configuration step; the original feature code is already present there from merge commit `5e7e3b4`.
- API changes:
  - None in this task. The approved contract and implementation already exist on the feature branch.
  - Smoke tests use response shape to prove registration: an unauthenticated request to each new route must return the JSON authentication envelope, not Go `ServeMux`'s bare `text/plain` 404.
- Frontend state/UI impact:
  - No new UI code. The existing Edit button can load and save a scheduled-workout snapshot once the branch Preview reaches the new staging backend.
- Backward compatibility / rollback:
  - Production frontend configuration, Production Cloud Run traffic, and the parent Neon branch remain unchanged.
  - Roll back the Preview by removing/undoing the feature-branch Vercel override and redeploying the prior Preview.
  - The staging service can be set to receive no callers without deleting it. Deleting the Cloud Run service, secret, service account, or Neon branch requires separate explicit approval.
- Verification:
  - Repository: relevant scheduled-workout integration tests, `go test ./...`, `go vet ./...`, `git diff --check`, and final diff/status review.
  - Cloud Build: success plus recorded source SHA and image digest.
  - Cloud Run direct: `/health` 200, `/ready` 200, route-registration 401 JSON checks, expected `X-Request-Id`, and no credential values in logs.
  - Vercel Preview: Authorization header survives `/backend` rewrite; Coach-owned unsessioned ScheduledWorkout loads and updates; malformed input, non-owner/not-found, and started-session conflict behavior match the API contract.
  - Data isolation: a Preview edit changes only the Neon `staging` child branch and does not change the parent branch.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Persist and approve this Task Doc on the feature Preview branch.
  2. Run local backend verification from the exact feature commit.
  3. Create and verify the isolated Neon child branch.
  4. Create the staging Secret Manager secret and service account with resource-scoped IAM.
  5. Build, publish, and record the immutable feature image digest.
  6. Deploy and smoke-test the dedicated Cloud Run staging API.
  7. Configure the feature-branch Vercel override, redeploy, and verify the end-to-end proxy path.
  8. Update deployment records and hand the Preview to the user for acceptance.
  9. After acceptance, merge only the incremental branch commits into `staging` and configure its Preview to use the verified staging API.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 read-only inspection | Done | Confirmed endpoint code, old live image, Vercel Production/Preview variable sharing, one Neon main branch, and absence of staging API/database resources. |
| Phase 1 — Task Doc | Done | Design and approval gates recorded in an isolated worktree on `claude/workout-draft-persistence-edit-2m93wo`. |
| Phase 2 — Local backend verification | Done | Scheduled-workout tests, full `go test ./...`, and `go vet ./...` passed against a freshly migrated isolated local database. |
| Phase 3 — Neon staging branch | Done | Created persistent child `staging` (`br-gentle-mouse-aziy6y8w`) from `main`; verified copied roles and current schema tables. |
| Phase 4 — GCP staging secret and identity | Done | Created secret `performance-coach-staging-api-database-url`, keyless runtime SA, resource-scoped Secret Accessor grant, and opaque DSN version 1. |
| Phase 5 — Immutable image build | Done | Cloud Build `dd4d7bbd-07c9-4a08-a3b6-448ee49635db` built source `1bff00b0bd9d07f955f16d75fe481990c39b0133`; deployed digest `sha256:7b1da260ff07a8c18f113fee0bac5bbd42dce0040a335fe8ebe7fff802f9cde9`. |
| Phase 6 — Cloud Run staging API | Done | Deployed `performance-coach-api-staging` revision `performance-coach-api-staging-00001-6hc` in `asia-southeast1`; `/health`, `/ready`, and unauthenticated registered-route JSON 401 checks passed. No Production service or traffic changes. |
| Phase 7 — Vercel feature-branch wiring | Done | Preview-only branch override deployed on `f08675c`; its `/backend/api/v1/scheduled-workouts/{id}` proxy returned the staging API's JSON 401 authentication envelope and request ID, not the legacy bare 404. |
| Phase 8 — End-to-end verification and records | In Progress | Cloud and proxy smoke tests passed; authenticated Coach acceptance (load, save, validation/authorization behavior, and staging-only data change) remains. |
| Phase 9 — Incremental staging merge | Not Started | Only after user confirms Preview acceptance. |

## 5. Outcome (filled at completion)

- Final status: In progress.
- Deviations from plan: None yet.
- Follow-ups: Full Firebase isolation remains a separate staging-platform task before this environment is used with real-user data.
