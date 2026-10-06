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
      coach_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
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
  - Validation: trim; non-empty; length ≤ 300; parse with `net/url`; scheme `https`; host one of `youtube.com`, `www.youtube.com`, `m.youtube.com`, `youtu.be`; otherwise `400 INVALID_ARGUMENT`. Clearing is `DELETE` only.
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
| 1. Contract and schema docs | Not Started | |
| 2. Migration `0013` | Not Started | |
| 3. API set/clear | Not Started | |
| 4. Read paths | Not Started | |
| 5. Frontend | Not Started | |
| 6. Staging verification | Not Started | |

Status values: `Not Started`, `In Progress`, `Blocked`, `Done`.

## 5. Outcome (filled at completion)

- Final status:
- Deviations from plan:
- Follow-ups:
  - Confirm with a read-only query whether production catalog rows have `youtube_url` at all; if not, decide whether to seed defaults there.
  - Editing description and image per Coach is out of scope.
  - Ship in the release after the current staging → production release.
