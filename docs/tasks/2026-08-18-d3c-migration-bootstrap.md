# Task: D3c Neon migration and bootstrap execution

- Date opened: 2026-08-18
- Related contract sections: AGENTS.md §§7–10, 12–15, 17–18, 21; `docs/deployment-architecture-v0.2.md` §§7–11, 13–14; D3a Task Doc
- Size (S/M/L/XL, per AGENTS.md §7): L

## 1. Feasibility Analysis

- Problem / trigger:
  - D3a has provisioned the separated Neon identities, full DATABASE_URL secrets, and secret-scoped GCP service accounts. The Neon PostgreSQL 16 database is empty and unmigrated; D3c must establish the schema using the immutable D3b image before any API workload can run.
  - Bootstrap is a distinct, reviewed operation. No approved production manifest of Firebase UIDs, names, roles, and coach-athlete relationships exists yet.
- Options considered:
  1. Run migrations from API startup.
  2. Run the migration binary manually from a developer workstation.
  3. Run an explicit one-task Cloud Run Job from the published immutable image, then use a separate bootstrap Job.
- Trade-offs (per option):
  - Option 1 risks concurrent schema mutation by API instances and violates the approved deployment architecture.
  - Option 2 avoids Cloud Run Job setup but would bypass the dedicated workload identity and would not prove the deployed image can migrate the target database.
  - Option 3 adds explicit job configuration, but gives a single observable, retry-bounded migration workload using the exact image intended for the API and the least-privilege migration identity.
- Selected option and why:
  - Select Option 3. Create and run a separate Cloud Run migration Job, then verify its ledger and checksums. Bootstrap follows only after an approved manifest is supplied. This preserves the API/migration separation and matches the deployment architecture.
- Risks & unknowns:
  - `0002_planned_set_prescription` is self-transactional; the migration runner records its ledger checksum after its own transaction commits. A failed ledger insert after that commit requires investigation and a reviewed recovery plan rather than a blind rerun.
  - Bootstrap cannot run until its reviewed input is available. It must never substitute local fixtures or unreviewed identities.
  - The API image currently performs a best-effort `schema_migrations` lookup at startup while the runtime role intentionally lacks access. This must be removed before D4 rather than granting runtime access to the migration ledger.
- Dependencies / blockers:
  - D3a Gates 1–7 are complete. The migration secret version is enabled and the migration service account has only secret-level access.
  - Cloud Run is enabled in `dontworkout`; the active deployment principal can attach the migration service account.
  - The migration execution gate requires explicit approval. Bootstrap is blocked until a reviewed production manifest is supplied.

## 2. Technical Design

- Affected files/components:
  - Cloud Run Job configuration only in later approved gates.
  - Neon `neondb` schema and `schema_migrations` ledger only when the migration Job is explicitly executed.
  - No API contract, frontend, image, or application-code change is part of D3c migration/bootstrap execution.
- Data flow:
  1. Cloud Run starts the migration Job in `asia-southeast1` from the pinned immutable image.
  2. The Job runs `/migrate` as `performance-coach-migrate@dontworkout.iam.gserviceaccount.com`.
  3. Cloud Run resolves Secret Manager version `1` of `performance-coach-migrate-database-url` into `DATABASE_URL` using that service identity; the secret value is never retrieved by deployment tooling, written to a file, or logged.
  4. `/migrate` connects over Neon TLS to the direct endpoint and applies the embedded SQL migrations with `MaintenanceMaxConns=2`.
  5. The migration ledger records applied versions and SHA-256 checksums. A later read-only verification compares it with this pinned image's embedded migration content.
  6. A separate `/bootstrap` Job may run only after a reviewed manifest is supplied; it uses the same migration identity and direct endpoint, but receives `BOOTSTRAP_MANIFEST_PATH` from a reviewed non-secret manifest delivery mechanism.
- Job configuration:
  - Region: `asia-southeast1`.
  - Image: `asia-east1-docker.pkg.dev/dontworkout/performance-coach/api@sha256:728fa3d46af09d966ff8796150c92471a18256f8429e0cccf11835b3ef9ea21f`.
  - Migration command: `/migrate`.
  - Migration service account: `performance-coach-migrate@dontworkout.iam.gserviceaccount.com`.
  - Migration secret environment variable: `DATABASE_URL` from `performance-coach-migrate-database-url:1`.
  - One task and zero retries.
  - No Cloud SQL attachment, Cloud SQL connector, `roles/cloudsql.client`, service-account JSON key, or `GOOGLE_APPLICATION_CREDENTIALS`.
- Schema changes:
  - `/migrate` creates `schema_migrations` and applies the already-embedded `0001_init_schema` and `0002_planned_set_prescription` migrations. No down migration is an approved production rollback mechanism.
  - Expected ledger rows:
    - `0001_init_schema` — `fe0652588f240d4fad75eda040a870b033ac076c553348a850f942732f11774c`
    - `0002_planned_set_prescription` — `f4e52124f7038410ced16d426323f74523814f4efc75825f3b2f25635cd087aa`
- State transitions:
  - Neon schema: empty/unmigrated -> migration Job running -> both migrations and matching ledger rows verified.
  - Bootstrap: blocked without approved manifest -> reviewed manifest supplied -> separate bootstrap Job runs and is verified.
  - API database role: schema-only access -> after successful D3c and separately approved D3a follow-up, exact application-table DML access; it continues to have no `schema_migrations` access.
- Backward compatibility / data backfill:
  - The target database is empty, so `0002` has no legacy records to backfill. Its preflight and verification blocks remain part of the canonical migration sequence.
  - The same immutable digest must later be used for D4; no rebuild is authorized by this task.

## 3. Estimate

- Size: L
- Sub-task breakdown (required for L/XL, per AGENTS.md §7):
  1. Record D3c plan and reconcile completed D3a progress.
  2. Create the migration Cloud Run Job with the pinned image, dedicated service account, version-pinned secret, one task, and zero retries.
  3. Execute the migration Job once and inspect non-secret job logs/status.
  4. Verify `schema_migrations`, schema objects, and the two exact checksums read-only.
  5. Obtain and review the production bootstrap manifest, then configure and execute a separate bootstrap Job.
  6. Verify bootstrap rows/access boundaries, then separately approve API DML grants and the pre-D4 startup-ledger removal.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Gate 1 — read-only D3c preflight | Done | Canonical image exists; Neon PostgreSQL 16 capability and empty schema verified; migration secret/identity path and Cloud Run prerequisites checked without reading a secret value. |
| Gate 2 — Task Docs | Done | This D3c Task Doc created and D3a tracker reconciled; documentation-only gate. |
| Gate 3 — create migration Job | Not Started | Pinned digest, `/migrate`, migration SA, secret version `1`, one task, zero retries, no Cloud SQL attachment. |
| Gate 4 — execute and verify migration | Not Started | Run once; verify schema, ledger rows, and exact checksums without reading secrets. |
| Gate 5 — bootstrap manifest review | Blocked | Requires approved production Firebase UIDs, names, roles, and coach-athlete relationships. |
| Gate 6 — bootstrap Job and verification | Blocked | Depends on Gate 5; uses `/bootstrap` separately from migration. |
| Post-D3c API DML grants | Not Started | Separate approved D3a follow-up; retain no `schema_migrations` privilege. |
| Pre-D4 startup-ledger removal | Not Started | Small API code task; remove runtime `schema_migrations` lookup rather than grant SELECT. |

## 5. Outcome (filled at completion)

- Final status: In progress; documentation and read-only preflight are complete only.
- Deviations from plan: None.
- Follow-ups:
  - Do not run bootstrap until its reviewed production manifest is approved.
  - Do not deploy D4 until API table DML is granted and the startup-ledger lookup is removed.
