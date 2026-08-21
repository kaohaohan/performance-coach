# Task: D3a Neon identities and database secrets

- Date opened: 2026-08-18
- Related contract sections: AGENTS.md §§8–10, 12–15, 17–18, 21; `docs/deployment-architecture-v0.2.md` §§6–9, 11; ADR-001; ADR-002
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger:
  - D2 has provisioned the production/pilot Neon project, while D3a identities, database roles, Secret Manager secrets, and IAM bindings do not yet exist.
  - The initial `neondb_owner` password was printed into an earlier AI tool transcript. It must be treated as exposed and rotated before it is used for any workload.
  - The API and maintenance workloads need separate database and GCP identities so the API cannot perform DDL and neither workload receives unrelated cloud permissions.
- Phase 0 findings:
  - Repository `main` is 12 commits ahead of `origin/main`. Pre-existing modifications to `AGENTS.md` and `apps/web/tsconfig.json`, plus untracked `docs/engineering-maturity-gap-analysis.md` and `docs/tasks/_template.md`, are unrelated and must remain untouched.
  - GCP account `haohan920@gmail.com` is active on project `dontworkout`; the Cloud Run region default is unset.
  - Secret Manager is empty. No dedicated API or migration/bootstrap service account exists. No `roles/cloudsql.client` binding was found.
  - The canonical D3b image remains present and unchanged at `asia-east1-docker.pkg.dev/dontworkout/performance-coach/api@sha256:728fa3d46af09d966ff8796150c92471a18256f8429e0cccf11835b3ef9ea21f`.
  - Neon project `performance-coach-mvp` (`purple-term-41387441`) is on the Free plan in AWS Singapore (`aws-ap-southeast-1`) with PostgreSQL 16, one default `main` branch, default database `neondb`, and default owner `neondb_owner`.
  - The primary Neon compute is 0.25 CU, scales to zero after the Free-plan default of five minutes, and supports both direct and pooled connections. The API will use the pooled endpoint; migration/bootstrap will use the direct endpoint.
  - `neondb_owner` is the only current database role. Its last-update time matches creation, confirming the exposed credential has not been rotated.
- Options considered:
  1. Use `neondb_owner` directly for migration/bootstrap and create the API role through the Neon Console, CLI, or API.
  2. Use `neondb_owner` only as a bootstrap authority, then create dedicated API and migration roles through SQL.
  3. Share one database credential and one GCP service account between all workloads.
- Trade-offs (per option):
  - Option 1 is operationally smaller, but retains the database owner credential in GCP and Neon grants `neon_superuser` membership to roles created through the Console, CLI, or API. That cannot satisfy the runtime least-privilege requirement.
  - Option 2 adds one controlled SQL bootstrap step, but keeps the owner credential out of workload configuration, permits ordinary PostgreSQL roles without `neon_superuser`, and creates a clear DDL/DML boundary.
  - Option 3 has the fewest resources, but allows an API compromise to mutate schema and violates the approved identity separation.
- Selected option and why:
  - Select Option 2. Rotate `neondb_owner`, use it only in a non-logging in-memory bootstrap process, and create `performance_coach_migrate` and `performance_coach_api` with SQL. Store only the two dedicated role DSNs in Secret Manager and assign each to a dedicated GCP service account.
- Risks & unknowns:
  - The installed Neon CLI/API transport must be inspected immediately before any password reset. The reset API returns plaintext password material and asynchronous operations; no command may expose the response in stdout, stderr, shell history, logs, or files.
  - Gate 2 pinned `neonctl` 2.39.0 in a temporary directory. Its generic `api` command can call the documented password-reset route and writes a successful JSON response, including any password field, to stdout. It must therefore be used only in a closed pipe to an in-memory consumer, without `--include`; a mock response verified that stderr is empty on the successful path when `--no-analytics --no-color` are set. A non-2xx API response can copy the server message to stderr, so the consumer must not pass a password in a request body or arrange for secret-bearing error messages.
  - `neonctl connection-string` is prohibited for the real operation because it prints a full DSN to stdout. `neonctl psql` normally invokes native `psql` with the DSN as a process argument, which is also prohibited. The later credential gate must force the CLI's embedded psql implementation with `--fallback` and stream SQL through stdin; it must not put generated role passwords in `-c` arguments.
  - `neonctl auth` persists OAuth credentials in its configured credentials file. It was not needed for Gate 2 and was not run. Before a real credential operation, choose an approved authentication source that does not put a token in command arguments, transcript output, or a temporary file.
  - The schema does not exist until D3c. D3a can create and restrict the API login role, but exact table-level DML grants can only be applied after the migration creates the tables and before D4 deploys the API.
  - The current API performs a best-effort `schema_migrations` lookup at startup. Because `performance_coach_api` will intentionally have no privilege on that table, the current image will log a permission warning while continuing startup. Do not change code in D3a; resolve this as an explicit follow-up decision before D4.
  - The default Compute Engine service account currently has broad project Editor access. D3a will not use it; changing that unrelated existing binding is outside this task.
- Dependencies / blockers:
  - Each write gate requires separate user approval.
  - Gate 2 must establish and verify a non-printing Neon authentication/output path before any credential operation.
  - D3c must complete successfully before the API table-level grants can be finalized.
  - No migration, bootstrap, Cloud Run service, or Cloud Run Job may run during D3a.

## 2. Technical Design

- Affected files/components:
  - Repository: this Task Doc only during Gate 1.
  - Neon project `purple-term-41387441`, main branch, database `neondb` in later approved gates.
  - GCP Secret Manager and IAM in project `dontworkout` in later approved gates.
  - No application, migration, image, API-contract, schema, frontend, or deployment change is part of D3a.
- Identity and privilege design:
  - `performance_coach_migrate` is a SQL-created login role for migration and bootstrap. It must not be a member of `neon_superuser` and must not have `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`. It receives `CONNECT` on `neondb` and `USAGE, CREATE` on schema `public`. Objects created by the migration runner, including `schema_migrations`, are owned by this role. It uses the direct Neon endpoint.
  - `performance_coach_api` is a SQL-created login role for API runtime. It must not be a member of `neon_superuser` and must not have `SUPERUSER`, `CREATEDB`, `CREATEROLE`, `REPLICATION`, or `BYPASSRLS`. It receives `CONNECT` on `neondb` and `USAGE`, but not `CREATE`, on schema `public`. It uses the pooled Neon endpoint.
  - After D3c creates the schema, grant `performance_coach_api` only `SELECT, INSERT, UPDATE, DELETE` on the application tables `users`, `coach_athletes`, `exercises`, `workouts`, `workout_exercises`, `workout_exercise_set_overrides`, `scheduled_workouts`, `scheduled_workout_exercises`, `scheduled_workout_planned_sets`, `workout_sessions`, and `set_logs`.
  - Do not grant the API role `TRUNCATE`, `REFERENCES`, `TRIGGER`, schema DDL, sequence privileges, or any privilege on `schema_migrations`. Future migrations must explicitly grant DML on each new application table rather than using a broad default privilege that would include the migration ledger.
- Secret design:
  - `performance-coach-api-database-url` contains a full pooled `DATABASE_URL` for `performance_coach_api`.
  - `performance-coach-migrate-database-url` contains a full direct `DATABASE_URL` for `performance_coach_migrate` and is shared only by the migration/bootstrap workload identity.
  - DSNs use TLS and are constructed with a URL builder so usernames and generated passwords are correctly encoded. Credential material must flow only in process memory and through `gcloud secrets versions add ... --data-file=-` stdin.
  - Credentials and DSNs must never appear in an AI transcript, stdout/stderr, shell history, process arguments, environment dumps, temporary files, documentation, git, or logs. Shell tracing must remain disabled. Secret payload verification is forbidden; verify only version metadata.
- GCP identity and IAM design:
  - `performance-coach-api@dontworkout.iam.gserviceaccount.com` receives secret-level `roles/secretmanager.secretAccessor` only on `performance-coach-api-database-url`.
  - `performance-coach-migrate@dontworkout.iam.gserviceaccount.com` receives secret-level `roles/secretmanager.secretAccessor` only on `performance-coach-migrate-database-url` and is used by both migration and bootstrap jobs.
  - The deployment principal may receive resource-level `roles/iam.serviceAccountUser` on those service accounts when required for later Cloud Run attachment.
  - Neither service account receives `roles/cloudsql.client`, project Editor, project-wide Secret Accessor, or a service-account JSON key.
- Credential data flow:
  1. Authenticate to Neon through a verified non-printing transport.
  2. Reset `neondb_owner`; consume its returned plaintext password only in memory and wait for all reset operations to finish.
  3. Connect to the direct endpoint with the rotated owner credential.
  4. Generate both custom-role passwords cryptographically in memory and create both roles with SQL, not the Neon Console/CLI/API role-creation operation.
  5. Apply the initial database/schema privileges and verify both roles lack `neon_superuser` membership and prohibited attributes.
  6. Construct direct and pooled DSNs in memory and stream each directly to its Secret Manager secret version over stdin.
  7. Discard credential material and verify only non-secret metadata and boolean privilege checks.
- State transitions:
  - `neondb_owner`: exposed credential -> reset in progress while old credential remains temporarily valid -> reset operations complete and old credential invalid -> rotated owner credential discarded from the deployment process.
  - Custom roles: absent -> SQL-created and restricted -> migration role DDL-ready; API role login/schema-restricted -> API role gains exact table DML only after D3c.
  - Secrets: absent -> empty secret containers -> one enabled credential version each.
  - Service accounts: absent -> created without keys -> each bound only to its matching secret.
- Backward compatibility:
  - D3a does not modify the database schema or application contracts.
  - The canonical D3b image digest remains unchanged and will be reused by D3c and D4 unless a separately approved build supersedes it.
  - No live workload currently consumes the exposed owner credential, so rotation does not require a workload cutover.
- Planned approval gates:
  1. Create and commit this Task Doc only.
  2. Install/pin and authenticate the Neon CLI or equivalent approved transport; inspect exact reset stdout/stderr and response behavior without rotating or creating credentials.
  3. Create the two empty Secret Manager secret containers.
  4. Create the two dedicated GCP service accounts without keys.
  5. Apply secret-scoped and service-account-scoped IAM bindings, with no Cloud SQL role.
  6. In one credential-safe operation, rotate `neondb_owner`, create the two SQL roles, apply pre-schema privileges, and add both Secret Manager versions.
  7. Verify Neon role attributes/memberships, endpoint selection, GCP IAM, and secret version metadata without retrieving secret values.
  8. After separately approved D3c migration, grant the API role exact application-table DML and verify no `schema_migrations` access before D4.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Persist the approved design and gates in this Task Doc.
  2. Establish and inspect the credential-safe Neon command transport.
  3. Create GCP secret containers and dedicated identities in separately approved gates.
  4. Apply narrowly scoped IAM bindings.
  5. Perform the atomic owner rotation, SQL role creation, and secret-version write.
  6. Verify identity, privilege, endpoint, and non-secret secret-version state.
  7. Finalize API table DML after D3c and decide the `schema_migrations` startup-warning behavior before D4.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 read-only reconciliation | Done | Repository, GCP, Artifact Registry, Neon project, branch, compute, database, and role metadata reconciled without reading credentials. |
| Gate 1 — Task Doc | Done | This document is the only approved repository change. |
| Gate 2 — Neon transport inspection | Done | Pinned `neonctl` 2.39.0 in a temporary directory. Mocked the generic reset API route: successful response is stdout-only and can be parsed downstream; error messages are stderr. No Neon authentication or mutation occurred. |
| Gate 3 — Secret containers | Done | Created `performance-coach-api-database-url` and `performance-coach-migrate-database-url` with automatic replication; both began empty. |
| Gate 4 — Service accounts | Done | Created the dedicated API and migration service accounts without user-managed keys or project IAM roles. |
| Gate 5 — IAM bindings | Done | Granted `roles/secretmanager.secretAccessor` only at each matching secret resource; no `roles/cloudsql.client`. |
| Gate 6 — Credential rotation, SQL roles, secret versions | Done | Rotated the exposed owner credential; SQL-created restricted `performance_coach_migrate` and `performance_coach_api`; added one full DATABASE_URL version to each matching secret through an in-memory/stdin-only pipeline. |
| Gate 7 — D3a verification | Done | Read-only verification confirmed role attributes/memberships, direct-versus-pooled endpoint construction, one enabled secret version each, scoped IAM, and no user-managed keys. |
| Post-D3c API table grants | Not Started | D3c dependency; must complete before D4. |
| Pre-D4 `schema_migrations` warning decision | Not Started | No code change approved in D3a. |

## 5. Outcome (filled at completion)

- Final status: D3a pre-D3c identity, credential, Secret Manager, IAM, and read-only verification gates are complete. The post-D3c API table-DML grant remains pending by design.
- Deviations from plan: Gate 2 found no dedicated reset subcommand in `neonctl` 2.39.0; the supported path is the generic `neonctl api` command. The later credential gate must use the embedded psql fallback, not native `psql` or `connection-string`.
- Follow-ups:
  - After D3c migration, grant `performance_coach_api` exact table-level DML only; retain no privilege on `schema_migrations`.
  - Resolve the intentional API denial of `schema_migrations` against the current best-effort startup lookup before D4, without broadening runtime database privileges by default.
