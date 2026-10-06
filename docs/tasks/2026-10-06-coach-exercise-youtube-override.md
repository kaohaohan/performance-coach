# Task: Coach-specific exercise YouTube link

- Date opened: 2026-10-06
- Related contract sections: AGENTS.md §§4, 5, 6, 7, 9, 14; `docs/go-backend-api-contract-v0.1.md` §3.2 (exercises), the Today and session responses that carry `youtubeUrl`; `docs/database-schema-relationships.md`; `docs/tasks/2026-09-07-exercise-media-attributes.md`
- Size (S/M/L/XL, per AGENTS.md §7): L
- Depends on: `docs/tasks/2026-09-07-exercise-media-attributes.md` (media columns and read path, already deployed)

## 1. Feasibility Analysis

- Problem / trigger:
  - An Athlete taps "watch demo" and gets a YouTube video the Coach never chose. The only source of `exercises.youtube_url` is the manual demo seed `apps/api/seeds/system_exercises_v1.sql` (Back Squat and Bench Press). Production likely has none of it; the staging seed is the likely origin.
  - A Coach cannot change it: there is no update route for exercises, `POST /exercises` accepts only `name`, and the contract says media is maintained out of band.
  - SYSTEM exercises are one row shared by every Coach, so editing that row would change every Coach's Athletes.
- Options considered:
  1. Coach edits the shared SYSTEM row directly.
  2. Coach edits only exercises the Coach created (private); SYSTEM exercises stay read-only.
  3. Per-Coach override: a new join table `coach_exercise_media(coach_id, exercise_id, youtube_url)`; the catalog value stays the default.
- Trade-offs:
  - Option 1 needs no schema change, but a second Coach would overwrite the first, and one Coach's edit changes another Coach's Athletes.
  - Option 2 is the safest and smallest, but does not fix Bench Press, which is a SYSTEM exercise.
  - Option 3 needs one migration and three read-path joins, but keeps the shared row untouched and matches the relational rule in AGENTS.md §5 (join table, not shared mutable state).
- Selected option and why: **Option 3** (founder decision, 2026-10-06: each Coach sets their own).
- Risks & unknowns:
  - **Three read paths** return `youtubeUrl` (`exercise.go`, `scheduledworkout.go`, `workoutsession.go`); missing one shows the wrong video in that screen.
  - **Which Coach's override applies to an Athlete's screen:** the Coach who scheduled that workout (`scheduled_workouts.coach_id`). An Athlete with two Coaches therefore sees each Coach's own video on that Coach's workouts.
  - **Account deletion** (`internal/accountdeletion`) must be checked for the new table; `ON DELETE CASCADE` is the intent.
  - **URL validation** lives in Go only (the DB has no check on `youtube_url`). Pasted URLs are untrusted input: allow only `https` and YouTube hosts.
  - **Production data:** production probably has no catalog videos at all (to be confirmed by a read-only query). That is a data task, not part of this code.
- Dependencies / blockers: none. Do **not** bundle this into the current staging → production release: it adds migration `0013`. Ship it in the following release.

## 2. Technical Design

- Affected files/components:
  - Docs: `docs/go-backend-api-contract-v0.1.md`, `docs/database-schema-relationships.md`, `docs/frontend-ui-spec.md` (Exercise Library row).
  - DB: `apps/api/migrations/0013_coach_exercise_media.{up,down}.sql`, `verify_0013_coach_exercise_media.sql`.
  - API: `apps/api/internal/exercise/exercise.go` (set, clear, list join), `apps/api/cmd/api/main.go` (routes and handlers), `internal/scheduledworkout/scheduledworkout.go` and `internal/workoutsession/workoutsession.go` (read joins), `internal/accountdeletion` (if it lists tables explicitly).
  - Web: `apps/web/app/coach/exercises/page.tsx`, `apps/web/lib/i18n/messages/{en,zh-TW}/coach.ts`.
- Data flow: Coach saves a link → `PUT /exercises/{id}/media` → validated and upserted per `(coach_id, exercise_id)`. Reads return `COALESCE(override, exercises.youtube_url)`. `DELETE` removes the override, returning to the catalog default.
- Schema changes (migration `0013`):

  ```sql
  CREATE TABLE coach_exercise_media (
      coach_id    uuid NOT NULL REFERENCES users(id),
      exercise_id uuid NOT NULL REFERENCES exercises(id) ON DELETE CASCADE,
      youtube_url text NOT NULL,
      created_at  timestamptz NOT NULL DEFAULT now(),
      updated_at  timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (coach_id, exercise_id)
  );
  ```

  Down migration drops the table. No existing data is touched.
- API changes (contract change, §6; update the contract before coding):
  - `PUT /api/v1/exercises/{exerciseId}/media`, body `{ "youtubeUrl": string }` → `200` with the exercise as listed (`id`, `name`, `scope`, `description?`, `youtubeUrl`, `imageObjectKey?`).
  - `DELETE /api/v1/exercises/{exerciseId}/media` → `204`.
  - Authorization: Coach only; the exercise must be visible to the caller (SYSTEM, or owned by the caller). Another Coach's private exercise or an unknown id → `404`, indistinguishable. Athlete → `403`. No auth → `401`.
  - Validation (YouTube-only is deliberately temporary; founder wants other video platforms possible later, so the allowed hosts live in one Go constant and widening it is a one-line change plus tests): trim; non-empty; length ≤ 300; parse with `net/url`; scheme `https`; host one of `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`; otherwise `400 INVALID_ARGUMENT`. Clearing is `DELETE` only.
  - Read changes (response shape unchanged): `GET /exercises` uses the caller's override; Today and session responses use the override of the Coach who scheduled the workout.
- State transitions: none.
- Frontend state/UI impact: an "edit video" action on each exercise card with an input (prefilled), Save, and Use default. Reuses `apiFetch`, existing error policy and card styling. zh-TW strings must differ from en (i18n test).
- Backward compatibility / data backfill: additive. No override row means today's behaviour. No backfill.

## 3. Estimate

- Size: L (about 6–8 h)
- Sub-task breakdown (AGENTS.md §7; stop and confirm after each):
  1. Contract and schema docs.
  2. Migration `0013` (+ down, verify script); apply to a clean local database.
  3. API: service, handlers, routes, integration tests.
  4. Three read paths with LEFT JOIN, tests.
  5. Frontend editor and i18n.
  6. End-to-end verification on staging (migrate, then API, then web).

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Phase 0 inspection | Done | Findings in section 1 |
| Task Doc | Done | This file |
| 1. Contract and schema docs | Done | Contract V0.14 note, §3.2 PUT/DELETE, read rules, permission row; schema table and DDL. Marked approved, not implemented. Committed locally, not pushed |
| 2. Migration `0013` | Done | up/down/verify written; applied to an empty scratch DB `performance_coach_migrate_test`, verified, down and up again; `go test ./internal/migrate` passes. Deviation recorded below |
| 3. API set/clear | Done | `PUT/DELETE /exercises/{id}/media`, `exercise.ValidateVideoURL/SetVideoURL/ClearVideoURL`, `GET /exercises` override join (moved here from step 4: PUT returns the listed shape), `accountdeletion.pruneOwnedData` removes the Coach's rows. Allowed hosts in one map `allowedVideoHosts`. go vet, gofmt, full `go test ./...` pass on an isolated DB |
| 4. Read paths | Done | Today (`scheduledworkout.go`) and session (`workoutsession.go`) now `COALESCE(scheduling coach override, catalog)` via `scheduled_workouts.coach_id`. Tests: two Coaches schedule the same exercise for one Athlete; another Coach's override does not leak. Full `go test ./...` passes |
| 5. Frontend | Done | `VideoEditor` in `app/coach/exercises/page.tsx` (Add/Edit video, Save, Use default, Cancel; reloads the list after a change); 5 en/zh-TW keys; UI spec row updated. `npm test` 226 pass, eslint and tsc clean. Not yet seen in a browser |
| 6. Staging verification | In Progress | 2026-10-06: image built with Cloud Build (a93ca7f); `performance-coach-migrate-staging` job applied `0013` (staging was at `0012`); API revision 00215 deployed no-traffic, smoke-tested, promoted, labelled `commit-sha=a93ca7f`; pushed to `staging`, CI (api, web, deploy api staging) green, Vercel deployed. Remaining: founder checks in the browser that a Coach can set a video and the Athlete sees it |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
  - `coach_id` has **no** `ON DELETE CASCADE` (the plan said cascade). The existing migrate test `TestAccountDeletionMigration0004RoundTrip` forbids any cascade from `users`: users are tombstoned, never deleted, and account deletion prunes owned data explicitly. So the cleanup moves into `accountdeletion.pruneOwnedData` (sub-task 3). `exercise_id` keeps `ON DELETE CASCADE` (only references `exercises`).
  - Added a `CHECK (length(btrim(youtube_url)) > 0)` so an empty row cannot exist even if the API check is bypassed.
- Follow-ups:
  - **Fixed by migration `0014_grant_coach_exercise_media_runtime`** (grants DML to `performance_coach_api` when that role exists; skipped locally). A GRANT run from the Neon SQL editor did nothing because the table is owned by `performance_coach_migrate` and a non-owner GRANT only warns. Original note — **missed in the plan:** a new table needs `GRANT SELECT, INSERT, UPDATE, DELETE ... TO performance_coach_api` (D3a rule: migrations must grant DML on each new table). Staging returned 500 on session, Today and library until the grant was run by hand in Neon on 2026-10-06. Production needs the same grant after `0013`. Consider a guarded grant inside migrations so this cannot be forgotten.
  - Staging migrations are still manual (the CI guard refuses a deploy that changes migrations). Procedure used: Cloud Build the image from `apps/api` at the commit, point `performance-coach-migrate-staging` at the digest, run it, deploy the same digest to `performance-coach-api-staging` as a no-traffic tagged revision labelled with the full `commit-sha`, smoke `/health` `/ready`, promote, then push `staging`. Worth writing into `docs/deployment-targets.md`.
  - The staging migrate role password had rotated, so its Secret Manager value was stale (versions 5–8 were wrong or exposed; 9 is current). The password shown once in the chat was reset.
  - Confirm with a read-only query whether production catalog rows have `youtube_url` at all; if not, decide whether to seed defaults there.
  - Editing description and image per Coach is out of scope.
  - Ship in the release after the current staging → production release.
