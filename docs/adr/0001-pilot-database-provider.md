# ADR 0001 — Pilot database provider: Neon instead of Cloud SQL

- Status: Accepted
- Date: 2026-08-18
- Supersedes: the Cloud SQL database decision in `docs/deployment-architecture-v0.2.md` §3 and §7
- Scope: the controlled pre-revenue pilot only. This ADR does not change the hosting split, the migration-job-only schema rule, or the forward-only rollback posture.

## Context

v0.2 §3 approved "Cloud SQL for PostgreSQL 16, Enterprise edition, single-zone, smallest suitable dedicated-core instance" in `asia-east1`, and §7 required automated backups plus point-in-time recovery.

§15 required pricing the exact configuration before D2, and §17 named the change trigger this ADR responds to:

> "Cloud SQL cost fails the D2 cost gate: write an ADR comparing managed PostgreSQL alternatives."

The priced pilot baseline came to approximately **USD 28–29/month**, billed continuously whether or not anything connects. The pilot is pre-revenue with one to two active users during initial validation and a target of at most fifty. The cost is disproportionate to the value being validated, so the D2 cost gate fails.

Two further facts shaped the decision:

- **The cost is entirely Cloud SQL, not Cloud Run.** At `min-instances=0` with pilot traffic, Cloud Run falls inside its free allowances and contributes approximately nothing. Removing Cloud Run would have saved nothing while discarding the completed D1a/D1b/D3b work.
- **The stated `db-g1-small` baseline contradicted §7**, which explicitly prohibits shared-core instances for a production pilot on the grounds that Google documents them as test/development configurations without an SLA. Moving off Cloud SQL makes that contradiction moot rather than requiring it to be resolved.

## Decision

1. **Use Neon** (managed serverless PostgreSQL) as the pilot database, in its Singapore region (`ap-southeast-1`).
2. **Start on the Free plan.** Upgrade to the Launch plan when the database first holds real, non-replaceable user data.
3. **Relocate Cloud Run from `asia-east1` to `asia-southeast1` (Singapore)** so the API and database stay colocated, preserving the §3 colocation principle. Neon has no Taiwan region; Singapore is its only Asian region.
4. **Keep the API on Cloud Run.** Compute does not move to Railway, Render, or Supabase.
5. **Revisit Cloud SQL** when scale or revenue justify a continuously-running managed instance. This is an explicitly expected future migration, not a permanent rejection.

## Alternatives considered

Priced 2026-08. All figures are estimates for this pilot's usage profile and must be re-verified before provisioning per §15.

| Option | Est. monthly | PITR / restore window | Asia region | Keyless GCP auth | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Cloud Run + Neon Free** | **USD 0** | 6 hours | Singapore | Yes (ADC) | **Chosen — starting point** |
| **Cloud Run + Neon Launch** | **~USD 3.5–7** | 7 days | Singapore | Yes (ADC) | **Chosen — upgrade target** |
| Cloud Run + Cloud SQL `db-g1-small` | ~USD 28–29 | 7 days | asia-east1 | Yes (ADC) | Fails the D2 cost gate |
| Cloud Run + Cloud SQL `db-f1-micro` | ~USD 8–10 | 7 days | asia-east1 | Yes (ADC) | Cheaper, but still continuous billing and still shared-core against §7 |
| Railway (API + Postgres) | ~USD 7–12 | ~4 weeks | Singapore | **No** | Best PITR, but see "Why compute stays on Cloud Run" |
| Render (API + Postgres) | ~USD 14+ | Higher tiers only | Singapore | **No** | Free Postgres expires after 30 days and has no backups |
| Aiven Free | USD 0 | Included, retention unpublished | "Asia Pacific" area only, cannot pin Singapore | Yes (ADC) | Cannot guarantee colocation; `max_connections=20`, no pooling |
| Supabase Free | USD 0 | **None** | Singapore | Yes (ADC) | No backups; pauses after 7 idle days; overlaps existing Firebase Auth |
| Xata / Tiger Cloud | — | — | **No Asia region** | — | Excluded on region |

### Why compute stays on Cloud Run

Moving the Go API off Google Cloud looked attractive on price but fails on identity.

`apps/api/internal/authn/authn.go` initializes the Firebase Admin SDK as `firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID})` with no credential option, then calls `app.Auth(ctx)`. This depends entirely on Application Default Credentials. On Cloud Run, ADC is supplied by the metadata server through the attached runtime service account, with no key material anywhere. On Railway, Render, or any non-GCP host there is no metadata server, and `app.Auth(ctx)` fails with `google: could not find default credentials`. The only remedy is injecting a Firebase service-account JSON, which §6 explicitly forbids:

> "Never commit, copy, mount, or bake a Firebase/GCP service-account JSON into the repository or container."

The same problem would recur for the deferred video/object-storage work: an API outside GCP needs a long-lived static key to reach GCS, where an API on Cloud Run needs none. Trading workload identity for a permanent static credential is a security downgrade, not an equivalent swap, and it would be paid twice.

Separately, the cost argument for moving compute did not hold. Railway bills continuously for resident CPU and memory and does not scale to zero, and its practical floor is a USD 5/month plan fee. Cloud Run and Neon both genuinely scale to zero. For a workload idle most of the day, the scale-to-zero pairing is structurally cheaper, not more expensive.

## Consequences

### Positive

- Pilot database cost drops from ~USD 28–29/month to USD 0, then to roughly USD 3.5–7/month once real data justifies the Launch plan.
- **No application code changes.** `internal/db.AssertSafeSSLMode` is host-based and accepts Neon's `sslmode=require` unchanged; `internal/config`, `internal/migrate`, and `internal/bootstrap` require only `DATABASE_URL`. `go.mod` is untouched — pgx v5 supports SNI natively, and the project never depended on a Cloud SQL connector library.
- **The D3b image digest remains valid.** No rebuild, no republish.
- Neon Free to Launch is a plan change on the same project, not a data migration, so the upgrade carries no downtime or cutover risk.
- Removing the Cloud SQL attachment also removes `roles/cloudsql.client` from both service accounts, shrinking the IAM surface.

### Negative

- **Reduced restore window while on Free.** Neon's Free plan retains 6 hours of history against the 7-day target in §7. This is an accepted, time-boxed downgrade: it applies only while the database holds test data the founder created, and it ends at the Launch upgrade. Until then, take a manual `pg_dump` before any risky operation.
- **Stacked cold starts.** Neon suspends compute after 5 minutes idle and Cloud Run scales to zero, so the first request after an idle period pays both. Measure this in D6 rather than assuming it is acceptable.
- **Cross-cloud data path.** Compute runs on Google Cloud while Neon runs on AWS infrastructure, both in Singapore. Same city, different provider — measure the actual latency in D6.
- **Vendor concentration risk.** Neon is a younger provider (now Databricks-owned). Mitigated by low lock-in: the schema is plain SQL migrations and the exit path is `pg_dump`.
- Free plan storage is capped at 0.5 GB, which is ample for the pilot but is a ceiling to watch.

### Migration path back to Cloud SQL

Deliberately kept cheap, because this is expected to happen:

1. Provision the Cloud SQL instance in the then-current region.
2. `pg_dump` from Neon, restore into Cloud SQL.
3. Re-point the `DATABASE_URL` secret at the `/cloudsql/...` socket path with `sslmode=disable` — already an accepted host for `AssertSafeSSLMode`.
4. Re-add the Cloud SQL attachment and `roles/cloudsql.client` to the Cloud Run service and jobs.
5. Redeploy from the then-current image digest. No application code change is required in either direction.

## Open items

- Neon's Free-plan compute allowance (100 CU-hours/month) and Launch pricing were read from public pricing pages in 2026-08. §15 still requires confirming current figures against the provider's own pricing at provisioning time.
- The Launch upgrade trigger — "first real user data" — is a judgement call the founder makes, not an automated threshold.
