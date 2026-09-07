# Task: Exercise media attributes (description, YouTube, image key)

- Date opened: 2026-09-07
- Related contract sections: AGENTS.md §4 (object storage), §5 (do not implement future entities until required), §6 (API contract change must be explicit); `docs/go-backend-api-contract-v0.1.md` §3.2/§7.3; `docs/tasks/2026-09-07-exercise-catalog-baseline.md`
- Size (S/M/L/XL, per AGENTS.md §7): **L** when picked up (schema + repository + API + frontend; split per the sub-tasks below)

Do not start implementation until this task is explicitly picked up. Identity (`exercises.name` in English) is frozen by `docs/tasks/2026-09-07-exercise-catalog-baseline.md` and must not be reopened here.

## 1. Feasibility Analysis

- Problem / trigger: Founder wants SYSTEM exercises to carry a description, an optional YouTube link, and an optional image. Current Exercise is `{ id, name, owner_coach_id, created_at }` and `GET /api/v1/exercises` returns `{ id, name, scope }`.
- Options considered:
  1. Stuff cues into `name` or a free-text blob on the row.
  2. Nullable columns on `exercises`: English `description`, `youtube_url`, object-storage image key. SYSTEM first. Display-map for description if zh-TW is needed; URLs and images are language-agnostic.
  3. New `VideoAsset` / `exercise_media` domain, or `WorkoutItem.VIDEO` on the catalog.
- Trade-offs (per option):
  - Option 1 corrupts identity and search.
  - Option 2 is the smallest contract change that matches AGENTS.md (Postgres holds structured data and keys; binaries live in object storage).
  - Option 3 implements a future entity and conflates a rest/note/video *workout block* (§7.3) with an Exercise attribute.
- Selected option and why: **Option 2**, recorded as the baseline on 2026-09-07. Do not implement `VideoAsset`. Do not snapshot description/video onto `scheduled_workout_exercises` unless a later product decision needs “what the cue was on that date.”
- Risks & unknowns: Object-storage bucket, signed-URL, and upload path do not exist yet. Private-exercise media is out of the first implementation. Description i18n can start as a display map (same pattern as names) and move to `exercise_translations` only if a second locale or API-delivered names become real.
- Dependencies / blockers: Catalog baseline lock. Object storage provision (not in this doc). Must not share a PR with catalog-growth row appends.

## 2. Technical Design

- Affected files/components (when implemented): new migration on `exercises`; Go exercise repository/handler; `GET /api/v1/exercises` response; Exercise Library (and later Calendar picker) UI; optional seed columns for description/YouTube.
- Data flow: Coach opens a SYSTEM exercise → API returns English `name` plus nullable attributes → UI paints `localizeExerciseName(name)` and shows description/media. Workout create/schedule still sends English `name`.
- Schema changes (approved shape, not yet migrated):

```text
exercises.description    text null   -- English source
exercises.youtube_url    text null
exercises.image_object_key text null -- object storage; never a bytea
```

SYSTEM rows first. Do not put these fields on `workout_exercises` (prescription) or on snapshot tables in V0 of this task.

- API changes (must update `docs/go-backend-api-contract-v0.1.md` before coding): extend `GET /api/v1/exercises` (and likely the single-resource shape if one is added) with optional `description`, `youtubeUrl`, `imageUrl` or `imageObjectKey`. No change to `POST /workouts` exercise identity (`name`). Authorization unchanged (Coach-only list).
- Frontend state/UI impact: Exercise Library can show a detail/cue surface. Do not add edit/archive, tags, or categories in this task unless a later revision expands scope.
- Backward compatibility / data backfill: all new columns nullable; existing 134 rows stay valid with nulls. Seed may later include description/YouTube text; images are uploaded assets referenced by key, not SQL binaries.

## 3. Estimate

- Size: **L**
- Sub-task breakdown (when picked up):
  1. Contract update for `GET /exercises` optional fields
  2. Migration + repository
  3. Handler / API
  4. Frontend Exercise Library display (SYSTEM)
  5. Object-storage upload path (if images ship in the same epic; otherwise image key stays null and YouTube/description ship first)

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Feasibility + design | Done | Baseline lock 2026-09-07 |
| Contract update | Not Started | Picked up separately |
| Migration + repository | Not Started | |
| Handler / API | Not Started | |
| Frontend display | Not Started | |
| Object-storage upload | Not Started | May split to its own task |

## 5. Outcome

- Final status: **Not implemented.** Design recorded so a later session does not invent a second identity or a VideoAsset table.
- Deviations from plan: none.
- Follow-ups: start at sub-task 1 when explicitly picked up. Update `docs/mvp-specification.md` Exercise Library bullets when this becomes user-visible scope.
