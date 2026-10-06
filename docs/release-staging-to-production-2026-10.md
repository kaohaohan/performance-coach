# Release checklist: staging → production (2026-10)

Status: **not started**. Nothing here has been run against production.

Scope: everything on `staging` that is not on `main` (30 commits as of `ccaad04`). Production is a separate runtime: Vercel Production (`dontworkout.vercel.app`) → Cloud Run `performance-coach-api` → Neon `main`. See `docs/deployment-targets.md` and `docs/ios-release-runbook.md` (Public App Store 1.0) for the full production rules.

## What this release contains

- RPE → RIR rename across DB, API and UI (migration `0011`, changes existing data).
- Training history: `GET /training-log`, Exercise Progress page, LAST/PR cards in sessions.
- Coach Progress Overview: `GET /athletes/{athleteId}/progress-overview`.
- Exercise Progress UI work (comparison table, collapsed paginated history).
- Migration `0012` (index on `workout_sessions`).
- Backend: 26 files changed. Web-only fixes are mixed in.

This is a full-stack release (database, API, web), not a web-only one.

## A. Confirm before anything is touched

| # | Check | Why | Done |
| --- | --- | --- | --- |
| A1 | Production Neon is on migration `0010` (`SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1;`) | Migrations must apply in order; a different starting point changes the plan | [x] 2026-10-06: `0010_reps_increment_amount` |
| A2 | Neon plan for production (Free or Launch) | Free has only a 6-hour restore window; ADR-002 gate | [x] 2026-10-06: **Free** (6-hour restore window) |
| A3 | Is any iOS build that sends `rpe` already installed on real devices (TestFlight or App Store)? | The API renames `rpe` → `rir`; an old app would break | [x] 2026-10-06: students use the iOS app. The app is a WKWebView that loads `https://dontworkout.vercel.app` (URL baked at Archive, runbook says store build is 1.0 (4)), so web code updates for everyone when `main` deploys; no old binary sends `rpe`. Still to confirm: installed build is 1.0 (4) and targets production. |
| A4 | A restore point exists: Neon branch or snapshot of production taken just before migrating | `0011` rewrites data; rollback needs somewhere to go back to | [x] 2026-10-06 rehearsal: Neon branch `pre-release-2026-10-06` created from `main`. **Create a fresh one on release day**; this one will not contain data written after today. |
| A5 | Latest `staging` CI is green and the staging site was used with the new build | The same SHA is what goes to production | [ ] |

Real students are on production, so: release outside their training hours, tell them to fully close and reopen the app afterwards, and keep the A4 backup until the release is verified.

## B. Release (order matters)

1. [ ] Run migrations `0011`, `0012` on production Neon.
2. [ ] Verify with `apps/api/migrations/verify_0011_rpe_to_rir.sql`.
3. [ ] Deploy production Cloud Run API from the staging-verified build. CI deploys only staging on push to `staging`; production is a manual step.
4. [ ] Check `/health` on the production API and read its startup log (`migration_version` should be `0012...`).
5. [ ] Merge `staging` → `main` (updates the Vercel Production frontend).

Keep steps 1–5 close together: with the new schema and the old API (or the new web and the old API) production breaks.

## C. Verify after release

- [ ] Log in to `dontworkout.vercel.app` as a Coach; open Exercise Progress and the athlete Progress Overview.
- [ ] Schedule and log a session with RIR; confirm it saves.
- [ ] Cloud Run logs show no new 5xx.
- [ ] Vercel Production env vars and Firebase authorized domain unchanged (runbook steps 4–5).

## D. Rollback notes

- Web: Vercel can roll back to the previous production deployment.
- API: redeploy the previous Cloud Run revision.
- Database: `0011` has a down migration, but restore from the A4 branch if data looks wrong.

## Record

| Item | Value |
| --- | --- |
| Staging SHA released | |
| Production migration before / after | |
| Cloud Run revision | |
| Date / who | |
