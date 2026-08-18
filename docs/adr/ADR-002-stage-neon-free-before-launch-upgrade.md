# ADR-002: Stage Neon Free Before the Launch Upgrade

Status: **Accepted**, 2026-08-18.

This ADR does not modify or reopen `docs/adr/ADR-001-use-neon-launch-postgresql-for-mvp-pilot.md`. ADR-001's core verdict — Neon over Cloud SQL, region `aws-ap-southeast-1` (Singapore), Cloud Run colocated in `asia-southeast1` — remains fully in effect and unchanged. This ADR narrows one thing ADR-001 left too blunt: **when** the Launch plan is actually required, versus when Neon's Free plan is a legitimate, cheaper starting point for the same architecture.

## What changed since ADR-001

ADR-001 mandated Launch from the very first project creation, reasoning that Free's restore/PITR window (6 hours, capped at 1 GB-month) doesn't meet the "backups/PITR mandatory" requirement the architecture carries forward from the superseded Cloud SQL decision.

That reasoning is correct **once real data is at stake**. It is not a reason to pay for Launch during a phase where the data in the database is disposable. The current phase — a handful of students running internal testing — is exactly that: the data is not yet real training history anyone would need to recover. Confirmed directly with the person running the pilot before writing this ADR, rather than assumed: **current testing data is disposable, not real athlete records.**

Paying for Launch's usage-based billing to protect data that doesn't need protecting yet is the same category of over-engineering the Founder Constraint (`AGENTS.md` §23) warns against — optimizing for a risk that doesn't exist yet, ahead of validating the product with real users.

This also resolves a separate, unrelated blocker: the previous session found the Neon account still reporting `plan: "free"` via the API even after Launch billing was enabled in the console, blocking D2 project creation. Re-verified again immediately before writing this ADR — still `plan: "free"`. Using Free as the deliberate starting point removes that blocker entirely rather than requiring it to be debugged first.

## Decision

**Provision the D2 Neon project on the Free plan**, same region and version as approved in ADR-001 (`aws-ap-southeast-1`, PostgreSQL 16). Upgrade to Launch is **required**, not optional, before any of the trigger conditions below are met — this is a staged rollout with a hard gate, not an open-ended deferral.

## Free plan facts (re-verified 2026-08-18, `neon.com/docs/introduction/plans`)

| Limit | Value | Behavior at the limit |
| --- | --- | --- |
| Compute | 100 CU-hours/project/month (≈400 hours at the minimum 0.25 CU), scale-to-zero after 5 min idle | Compute suspended until the next billing cycle or upgrade |
| Storage | 0.5 GB/project | Inserts/updates/deletes **fail** until space is freed or the plan is upgraded — a hard write block, not a soft warning |
| Network egress | 5 GB/month | Compute suspended until the next billing cycle or upgrade |
| PITR / restore history | 6 hours, capped at 1 GB-month | This is the gap ADR-001 flagged. It is real exactly when real data is at stake, and irrelevant otherwise. |

None of the compute, storage, or egress caps are anywhere close to being hit by a handful of internal-testing students exchanging structured workout/schedule/set-log data. The one limit that actually matters for this decision is PITR, and its relevance is entirely conditional on what's stored.

## Upgrade trigger — required before, not "whenever convenient"

Upgrade this project from Free to Launch **before** any of the following, whichever comes first:

1. **Real, non-recoverable athlete or coach data enters the system** — i.e., before pilot go-live with actual training records a coach or athlete would care about losing. This is the primary gate. It is a go-live precondition, not a "nice to have soon" — the moment real data starts accumulating, Free's 6-hour restore window is the live risk ADR-001 already correctly identified.
2. Usage approaches the 0.5 GB storage cap (measured, not assumed — check before it silently blocks writes).
3. Usage approaches the 100 CU-hours/month compute cap or the 5 GB/month network egress cap.
4. Any stated need for restore history beyond 6 hours arises for a reason other than #1.

Condition 1 is expected to fire first and is the one to actually plan around; 2–4 are safety nets in case usage grows in an unexpected shape before then.

## Reversibility / upgrade mechanics

Upgrading a Neon project's plan is an account/project-level billing change, not a data migration — same project, same connection endpoints, same data, no `pg_dump`/restore and no cutover window. This is not a new lock-in risk on top of what ADR-001 already established for Neon generally (the DSN-only, provider-agnostic code path documented there is unaffected by which Neon plan is active). Verify Neon's actual upgrade mechanics (any brief compute restart, if any) at the time the trigger fires, rather than assuming zero interruption from this document.

## Consequence

`docs/deployment-architecture-v0.2.md` and `docs/deployment-checkpoint.md` are updated to reflect Free as the initial D2 provisioning target, with an explicit pointer to this ADR's upgrade trigger, so a future reader does not mistake this for a reversal of the "backups/PITR mandatory" principle — it is a deferral until that principle actually applies.

## References

- [Neon plans/pricing](https://neon.com/docs/introduction/plans)
- `docs/adr/ADR-001-use-neon-launch-postgresql-for-mvp-pilot.md`
