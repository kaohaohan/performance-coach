# ADR-001: Use Neon Launch PostgreSQL for the MVP Pilot

Status: **Accepted**, 2026-08-18.

This ADR supersedes the database-hosting portion of the decision recorded in `docs/deployment-architecture-v0.2.md` §3.1/§7 (Cloud SQL `db-g1-small`, `asia-east1`). It does not reopen any other v0.2 decision (Vercel frontend, Firebase Auth, `/backend/*` rewrite model, migration-job-only schema changes, forward-only rollback posture, etc.), all of which remain approved and unchanged.

## Previous decision

Cloud SQL for PostgreSQL 16, Enterprise edition, single-zone, **`db-g1-small`** (shared-core, 1.7 GB RAM), in **`asia-east1`**, ≈ USD 28/month fixed, with mandatory automated backups and PITR. Passed the D2 cost gate against a USD 100/month approval guardrail on 2026-08-17 (`docs/deployment-architecture-v0.2.md` §3.1, prior revision). Neon was evaluated at that time and rejected — not on cost, but on region/latency: Neon's nearest APAC region was Singapore, and colocating Cloud Run in `asia-east1` with a database in Singapore was judged to introduce a user-visible latency regression in the core SetLog-logging loop.

## New decision

**Neon Launch PostgreSQL, `aws-ap-southeast-1` (Singapore)**, paired with moving the Cloud Run API service from `asia-east1` to **`asia-southeast1`** so the API and database remain colocated in the same region-pair. This resolves the latency objection that was the actual basis for the prior rejection, rather than overriding it.

## Workload assumption this decision is sized for

- ≤ 50 total users: 2–3 coaches, ~athletes bounded by that.
- Mostly idle, bursty traffic — not a sustained-load service. The core loop (create/schedule workout → athlete logs sets → coach reviews) does not imply continuous database activity between sessions.
- Pre-revenue pilot; no stated availability/SLA commitment to end users yet.

If any of these assumptions materially change (user count, sustained concurrency, an actual SLA requirement), this decision must be re-evaluated — see Rollback/migration path below, and the upgrade triggers this ADR carries forward from the superseded §3.1.

## Why the decision changed

The original Cloud SQL selection was cost-gate-driven: `db-g1-small` passed the USD 100/month guardrail at ≈$28/month, and that was accepted as reasonable at the time. Revisiting it now, ≈$28/month **fixed, always-on** cost is disproportionate for a workload that is mostly idle and capped at 50 users — the instance is billed continuously whether or not any coach or athlete is using the product in a given hour. Neon Launch's usage-based, scale-to-zero pricing model is a better fit for exactly this shape of traffic: near-zero cost during idle periods, cost only accrues during actual use.

This is a cost/operational-fit correction, not a reversal of the original engineering judgment — the latency concern that drove the original Neon rejection is independently resolved by relocating Cloud Run (see below), so the two decisions don't conflict.

## Official Cloud SQL shared-core / single-zone SLA limitations (re-verified against current docs)

Fetched live from Google Cloud documentation on 2026-08-18:

- **`instance-settings` doc**, verbatim: *"The `db-f1-micro` and `db-g1-small` machine types aren't included in the Cloud SQL SLA... These machine types are configured to use a shared-core CPU, and are designed to provide low-cost test and development instances only... Don't use them for production instances."* ([docs.cloud.google.com/sql/docs/postgres/instance-settings](https://docs.cloud.google.com/sql/docs/postgres/instance-settings))
- **Cloud SQL SLA**, verbatim: *"Shared-core Instances, single-zone Instances, and read pools with 1 node are excluded from the Covered Service."* ([cloud.google.com/sql/sla](https://cloud.google.com/sql/sla))

This second point is a correction to what the superseded §3.1 recorded: it framed the SLA gap as a shared-core-specific trade-off. In fact **all single-zone Cloud SQL instances are excluded from the SLA, dedicated-core included.** The evidence-based "upgrade to dedicated-core" trigger carried in the prior decision would not, by itself, restore SLA coverage — high availability would also be required. This does not change today's decision (single-zone was already accepted for other reasons), but it should be corrected wherever the codebase's documentation described the SLA gap as shared-core-only.

Net effect: Cloud SQL `db-g1-small` had no SLA advantage over Neon Launch to weigh against its fixed cost. Both are non-SLA options at this pilot's scale.

## Neon usage-based + scale-to-zero model (fetched live, 2026-08-18)

- **Launch plan pricing**: no monthly minimum. Compute **$0.106/CU-hour** (minimum compute size 0.25 CU = 0.25 vCPU / 1 GB RAM, autoscaling up to 16 CU). Storage **$0.35/GB-month**. ([neon.com/docs/introduction/plans](https://neon.com/docs/introduction/plans))
- **Scale-to-zero**: enabled by default after 5 minutes of inactivity (can be disabled per project). Compute billing stops while scaled to zero.
- **Point-in-time restore**: Launch provides up to 7 days of history, billed separately at $0.20/GB-month — meaningfully longer than the Free plan's 6-hour/1 GB-month cap. Launch, not Free, is the plan that satisfies this project's backup/PITR expectation (`AGENTS.md` §14, superseded v0.2 §11).
- **Rough cost estimate for this workload** (not a priced quote — must be re-verified against Neon's calculator before provisioning, same discipline the superseded §3.1 applied to Cloud SQL): at, say, 2 active hours/day and minimum compute size, compute cost is on the order of ~$6/month; storage for a pilot-scale schema is well under 1 GB. Total realistically **≈$10–15/month**, materially under Cloud SQL's fixed ≈$28/month, and the gap widens further the more idle time the pilot actually has.

## PostgreSQL portability findings from the code audit

A direct code audit (not an assumption) confirmed the codebase has almost no Cloud SQL-specific surface:

- The **only** Cloud SQL-specific code is `isCloudSQLSocket()` in `apps/api/internal/db/dsn.go` (matches a `/cloudsql/` host prefix) and its one test case in `dsn_test.go`. It becomes dead code under Neon — harmless to leave, optional to remove.
- `apps/api/go.mod` has **no Cloud SQL connector dependency** — no `cloudsqlconn`, no custom pgx dialer. The `cloud.google.com/go/*` indirect packages present are pulled in transitively by the Firebase Admin SDK, unrelated to the database connection path.
- No region literal (`asia-east1`) appears in any `.go` file outside a test DSN string.
- `config.LoadAPI/LoadMigrate/LoadBootstrap`, `db.NewPool`, and `AssertSafeSSLMode`'s general logic are all driven purely by the `DATABASE_URL` string contents; none of them know or care which provider issued the DSN.
- Neon mandates TLS (`sslmode=require` or `verify-full` on a standard `postgres://` DSN). `AssertSafeSSLMode` only special-cases `sslmode=disable`; any non-disable mode already passes through unchanged regardless of host — **no code change required** for Neon's TLS requirement.

**Conclusion: no application code change is required to switch database hosts.** This is a configuration/infrastructure change only (`DATABASE_URL` secret value, Cloud Run deploy flags, IAM grants, region). See the Technical Design section of the corresponding task doc, when one is created, for the itemized change list; the short version: drop `--add-cloudsql-instances` and the `roles/cloudsql.client` IAM grant, set `DATABASE_URL` to Neon's connection string, move Cloud Run region.

## Cloud Run moves to asia-southeast1

Cloud Run relocates from `asia-east1` to **`asia-southeast1`** (Singapore) to stay colocated with Neon's `aws-ap-southeast-1` database. This is the change that neutralizes the original latency-based rejection of Neon: the prior analysis measured a ~40–60 ms round-trip penalty for a `asia-east1` API talking to a Singapore database across a multi-statement transaction; colocating both in the Singapore region-pair removes that penalty rather than accepting it.

Artifact Registry may move with it or stay in `asia-east1` — image pulls happen at deploy time, not per-request, so this is not latency-sensitive. This ADR does not decide that; record whichever choice is made when D3b-equivalent work resumes.

## Trade-offs (explicit, not hidden)

- **Taiwan → Singapore user latency.** If the pilot's actual coaches/athletes are physically in Taiwan, moving the API from `asia-east1` to `asia-southeast1` adds browser-to-Cloud-Run latency that did not exist before (Vercel-to-Cloud-Run is already a measured hop per v0.2 §4; this changes what "nearby" means for that hop). This is the mirror image of the latency concern this ADR resolves for the *API-to-database* leg — it does not eliminate cross-region latency, it moves which leg carries it. If actual pilot users are Taiwan-based, measure real round-trip latency in D6 before treating this as a non-issue; it is an accepted, not a disproven, cost of this decision.
- **Neon cold start / scale-to-zero.** A database that has scaled to zero incurs a cold-start delay (typically low single-digit seconds) on the next connection. This is a new failure/latency mode Cloud SQL `db-g1-small` did not have (it runs continuously). For a mostly-idle pilot this is an accepted trade for the cost savings, but it should be measured under D6-equivalent verification, and scale-to-zero can be disabled per-project on Launch if it proves disruptive (at the cost of losing the biggest source of savings).
- **Cross-provider dependency.** The stack now depends on two cloud providers (GCP for Cloud Run/Firebase/Secret Manager/future GCS, AWS-hosted Neon for the database) instead of one. This adds a second vendor to track for outages, billing, and support, and means the "colocated in one cloud" simplicity described in the original v0.1/v0.2 architecture no longer holds at the infrastructure level (application architecture — API/DB separation — is unaffected).
- **Future migration back to Cloud SQL remains possible.** Per the code audit above, the only provider-specific code is the one `/cloudsql/` prefix check. Migrating back (or to another PostgreSQL host) is a `DATABASE_URL`/IAM/deploy-flag change plus a data migration (`pg_dump`/restore or equivalent) and a cutover window — not an application rewrite. Nothing in this decision is irreversible.

## Future video/object storage remains independent

This decision is scoped to the relational database only. Future video/audio/image assets remain planned for object storage (`AGENTS.md` §4, v0.2 target architecture) and **may still use Google Cloud Storage** regardless of where PostgreSQL lives — object storage has no dependency on the database provider, and GCS is not being reconsidered by this ADR. If GCS is used, its region should be chosen for its own access pattern (likely alongside Cloud Run in `asia-southeast1`), independently of this decision.

## Rollback / migration path

This decision is reversible in either direction:

- **Roll back to Cloud SQL:** re-provision a Cloud SQL instance (`asia-east1` or `asia-southeast1`), migrate data via `pg_dump`/restore or logical replication, point `DATABASE_URL` at the new instance, restore the `roles/cloudsql.client` IAM grant and `--add-cloudsql-instances` deploy flag, cut over during a maintenance window. The one `/cloudsql/` code path already exists and does not need to be re-added.
- **Move to a different PostgreSQL host entirely:** same shape of change — `DATABASE_URL`, IAM, deploy flags — since no code depends on Neon specifically either.
- **Trigger conditions to revisit this decision**, carried forward from the superseded §3.1 in spirit: sustained Neon compute cost exceeding Cloud SQL's fixed cost at actual observed usage; cold-start latency proving unacceptable for the core loop; a stated availability/SLA requirement neither current option satisfies (in which case the real fix is Cloud SQL Enterprise/Enterprise Plus with HA, not merely switching providers); or a materially increased workload beyond the ≤50-user pilot envelope this ADR is sized for.

## References

- [Neon plans/pricing](https://neon.com/docs/introduction/plans)
- [Neon regions](https://neon.com/docs/introduction/regions)
- [Neon connection security (sslmode/channel_binding)](https://neon.com/docs/connect/connect-securely)
- [Cloud SQL instance settings — shared-core statement](https://docs.cloud.google.com/sql/docs/postgres/instance-settings)
- [Cloud SQL SLA — Covered Service exclusions](https://cloud.google.com/sql/sla)
