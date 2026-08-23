# Task: Staging backend CI/CD

- Date opened: 2026-08-23
- Related contract sections: AGENTS.md §§7–10, 12–18, 21; `docs/deployment-architecture-v0.2.md` §§3, 5, 8–9, 11, 13–14
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger:
  - Vercel deploys the frontend from Git automatically, but no equivalent path rebuilds and deploys the Go API after a merge to lowercase `staging`.
  - The live `performance-coach-api-staging` service is therefore still serving revision `performance-coach-api-staging-00001-6hc` from image digest `sha256:7b1da260ff07a8c18f113fee0bac5bbd42dce0040a335fe8ebe7fff802f9cde9`, even though newer backend commits are present on `staging`.
  - Backend fixes can appear merged while the Vercel Preview continues calling old API code, making the frontend appear unable to use the merged backend behavior.
- Options considered:
  1. Continue manually building, pushing, and deploying the backend after each merge.
  2. Store a service-account JSON key in GitHub and deploy automatically after CI.
  3. Use GitHub OIDC with Google Cloud Workload Identity Federation (WIF), a dedicated least-privilege deploy service account, and an automatic staging-only deployment job.
  4. Automate both staging and Production in the same task.
- Trade-offs (per option):
  - Option 1 has the fewest platform changes but preserves the human-memory failure mode that caused the stale staging image.
  - Option 2 is mechanically simple but creates a long-lived credential that must be stored, rotated, and protected in GitHub. It is rejected because WIF is available and avoids this secret.
  - Option 3 requires one-time GCP IAM setup and a workflow change. It removes long-lived keys, can restrict trust to this repository and the lowercase `staging` ref, and directly fixes the reported staging failure mode.
  - Option 4 increases blast radius and mixes an automatic non-Production policy with a Production release policy that should require a separate approval and rollback decision.
- Selected option and why:
  - Select Option 3. It is the smallest secure change that makes merged staging backend code reach the staging Cloud Run service without relying on a person to remember a manual deploy.
  - Production deployment is explicitly excluded. It will be a separate task using a protected GitHub Environment or equivalent manual approval gate.
- Risks & unknowns:
  - There is no staging-specific Cloud Run migration Job. Automatically deploying an image that requires a new schema could make the API incompatible with the staging database.
  - The first version therefore fails closed when `apps/api/migrations/**` differs between the source SHA currently serving staging and the candidate SHA. It does not build, push, migrate, or deploy that commit. A dedicated staging migration identity, secret, Job, and gate remain a separate task.
  - A Cloud Run deployment must preserve the existing staging runtime identity, Secret Manager reference, Firebase configuration, resource limits, scaling caps, probe, and public-invoker policy. The workflow changes only the image/revision and traffic.
  - WIF and IAM changes can take several minutes to propagate, so the first authentication attempt may transiently fail even when configuration is correct.
  - The local `gh` authentication token is currently invalid. This does not block the selected design because provider and service-account identifiers are non-secret and may be referenced directly in the workflow; no GitHub secret is required.
  - The worktree contains an unrelated untracked `apps/web/ios/` directory. It must remain untouched and unstaged.
- Dependencies / blockers:
  - Existing Artifact Registry repository: `asia-east1-docker.pkg.dev/dontworkout/performance-coach`.
  - Existing Cloud Run service: `performance-coach-api-staging` in `asia-southeast1`.
  - Existing runtime service account: `performance-coach-api-staging@dontworkout.iam.gserviceaccount.com`.
  - Existing CI jobs `api` and `web` already run for pushes to lowercase `staging`.
  - The GCP project currently has no Workload Identity Pool and no dedicated GitHub deploy service account; both must be created once before enabling the workflow.

## 2. Technical Design

- Affected files/components:
  - `.github/workflows/ci.yml`
  - `.dockerignore`
  - `.gitignore`
  - `docs/tasks/2026-08-23-staging-backend-cicd.md`
  - `docs/deployment-checkpoint.md`
  - GCP project `dontworkout`: one WIF pool/provider, one deploy service account, and resource-scoped IAM bindings.
- GCP identity and authorization:
  - Create global Workload Identity Pool `github-actions` and provider `performance-coach`.
  - Map `google.subject`, `attribute.repository`, `attribute.ref`, and `attribute.repository_owner` from the GitHub OIDC assertion.
  - Require the provider attribute condition `assertion.repository == 'kaohaohan/performance-coach' && assertion.ref == 'refs/heads/staging'`.
  - Create keyless deploy service account `pc-github-staging-deploy@dontworkout.iam.gserviceaccount.com`. It is a deployment identity only and must not replace the Cloud Run runtime identity.
  - Allow only the `kaohaohan/performance-coach` repository principal set to impersonate the deploy service account with `roles/iam.workloadIdentityUser`; the provider condition additionally restricts admission to the lowercase `staging` ref.
  - Grant the deploy service account:
    - `roles/artifactregistry.writer` on Artifact Registry repository `performance-coach` in `asia-east1`;
    - `roles/run.developer` on Cloud Run service `performance-coach-api-staging` in `asia-southeast1`;
    - `roles/iam.serviceAccountUser` on runtime service account `performance-coach-api-staging@dontworkout.iam.gserviceaccount.com`.
  - Also grant `roles/run.developer` at project scope with an IAM condition matching only the full `performance-coach-api-staging` service resource name. This constrained project-level binding covers the Cloud Run deploy upsert permission path while preserving service-level scope; it must not be an unconditional project-wide grant.
  - Do not grant Owner, Editor, Cloud Run Admin, Secret Manager Secret Accessor, Production service access, or user-managed service-account keys.
- Workflow trigger and gating:
  - Add a `deploy-api-staging` job to the existing CI workflow.
  - Set `needs: [api, web]` and an explicit condition requiring a `push` event on `refs/heads/staging`. Pull requests never authenticate to GCP or deploy.
  - Give only this job `contents: read` and `id-token: write` permissions.
  - Checkout full history so the migration guard can compare the source SHA currently serving staging with `github.sha`, including migrations carried across an earlier blocked push.
  - Authenticate through WIF, identify the revision serving 100% traffic, and read its `commit-sha` label. The pre-CI revision falls back once to its recorded source `1bff00b0bd9d07f955f16d75fe481990c39b0133`; every workflow revision records its own label.
  - If the deployed SHA is invalid, absent from Git history, not an ancestor of the candidate, or differs under `apps/api/migrations/**`, stop with a clear error before build, push, or deployment.
- Image build and provenance:
  - Authenticate with `google-github-actions/auth@v3` through WIF, then configure the current `gcloud` CLI with `google-github-actions/setup-gcloud@v3`.
  - Add `gha-creds-*.json` to both `.gitignore` and `.dockerignore`. The auth action creates a short-lived credential file in the workspace; it must never enter Git history or the repository-root Docker build context.
  - Configure Docker authentication only for `asia-east1-docker.pkg.dev`.
  - Build from repository root with `docker build -f apps/api/Dockerfile`, tagging the image with the complete Git commit SHA.
  - Push exactly `asia-east1-docker.pkg.dev/dontworkout/performance-coach/api:${GITHUB_SHA}`.
  - Resolve the pushed tag to its Artifact Registry digest and pass `.../api@sha256:...` to Cloud Run. A mutable tag is never the deployment record.
- Deployment and state transitions:
  1. Current serving revision remains at 100% traffic while CI, migration guard, authentication, build, and push run.
  2. Deploy the digest as a candidate revision with a source-specific `candidate-<short-sha>` traffic tag and no normal traffic.
  3. Smoke-test the candidate-tag URL at `/health` and `/ready`, with bounded retry for Cloud Run startup.
  4. If both checks succeed, move 100% staging traffic to the candidate's explicit revision name, verify the normal serving URL, and remove the temporary tag.
  5. If either check fails, leave the existing serving revision at 100%, fail the job, and retain the candidate revision for diagnosis. No database or secret state is changed.
  - Deployment must target only project `dontworkout`, service `performance-coach-api-staging`, and region `asia-southeast1`.
  - The deploy command supplies only the immutable image, no-traffic/tag behavior, project, region, and quiet/non-interactive flags. It must not supply or overwrite environment variables, secrets, service account, ingress, scaling, CPU, memory, concurrency, or probes.
- Schema/API/frontend impact:
  - No schema, migration, API route, request/response, authorization, frontend state, or UI change.
  - The workflow only changes how already-tested backend commits reach staging.
- Backward compatibility and rollback:
  - Existing staging configuration and the previous healthy revision remain available.
  - Candidate smoke testing occurs before normal traffic changes, so a failed candidate requires no traffic rollback.
  - After promotion, an operator can restore a known prior revision with Cloud Run traffic management. Automated Production rollback is out of scope.
  - Production Cloud Run, Production Vercel variables, the parent Neon branch, and Production database credentials remain untouched.
- Verification:
  - Repository: YAML/workflow syntax validation where tooling is available, `git diff --check`, final diff/status review, and confirmation that `apps/web/ios/` is unstaged.
  - IAM: describe the WIF provider, deploy service account, and exact resource-level bindings; confirm there are no user-managed keys.
  - Authentication negative boundary: confirm the provider condition and workflow condition both restrict deployment to `kaohaohan/performance-coach` on `refs/heads/staging`.
  - First live run: push/merge the reviewed workflow to lowercase `staging`; confirm both CI jobs pass before deploy begins, image tag/digest match the merge SHA, the candidate `/health` and `/ready` checks pass, and Cloud Run serves the new revision.
  - Provenance: record the source SHA, immutable digest, revision, and successful smoke checks in `docs/deployment-checkpoint.md`.
  - Functional proof: verify a backend behavior introduced after the old `7b1d…cde9` digest is observable through the staging Vercel `/backend` proxy.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Commit the approved Task Doc.
  2. Create and verify the WIF pool/provider, keyless deploy service account, and least-privilege resource bindings.
  3. Add credential-file ignore rules and implement the staging deployment job.
  4. Run local/static verification and review the final diff.
  5. Merge/push through the normal branch workflow and observe the first staging deployment.
  6. Verify image/revision provenance, staging health, proxy behavior, and update the deployment record.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 — read-only inspection | Done | Confirmed stale staging revision/image, existing CI/Docker context, no WIF pool, and no staging migration Job. |
| Phase 1 — Task Doc | Done | Approved design documented and committed before implementation. |
| Phase 2 — WIF and least-privilege IAM | Done | Initial bindings plus a resource-conditioned project-level Cloud Run Developer binding verified; no user-managed keys or unconditional project-wide deploy role. |
| Phase 3 — workflow and ignore rules | Done | Added staging-only WIF deployment, cumulative migration guard, digest deployment, zero-traffic candidate smoke test, revision-pinned promotion, and credential exclusions. |
| Phase 4 — local/static verification | Done | Docker image build succeeded; YAML/dependency gate, ignore rule, cumulative migration guard, diff, and final worktree checks passed. |
| Phase 5 — first staging deployment | In Progress | Commits pushed to `feat/calendar-day-week-month`; PR creation through local `gh` is blocked by an invalid GitHub CLI token, so the workflow has not reached `staging`. |
| Phase 6 — live verification and deployment record | Not Started | Record SHA, digest, revision, smoke checks, and proxy proof. |

## 5. Outcome (filled at completion)

- Final status: In progress; waiting for the reviewed feature branch to merge into lowercase `staging`.
- Deviations from plan: The planned service account ID `performance-coach-github-staging` exceeded GCP's 30-character account-ID limit, so the equivalent keyless identity was created as `pc-github-staging-deploy`. The first deploy identity run showed the service-level Cloud Run Developer binding did not cover the deploy upsert path; a project-level binding constrained to the staging service resource is being added. No unconditional project-wide deploy role or Cloud Run Admin role is used.
- Follow-ups: Merge `feat/calendar-day-week-month` into `staging` and observe the first deployment; add a staging-specific migration identity, secret, Cloud Run Job, and explicit migration gate before allowing migration-bearing pushes to auto-deploy; design Production CI/CD separately with manual approval.
