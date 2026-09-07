# Task: Freeze the Exercise catalog baseline (English identity)

- Date opened: 2026-09-07
- Related contract sections: AGENTS.md §4 (architecture boundaries, object storage), §5 (Prescription vs Actual, future entities), §6 (API contract), §19 (documentation); `docs/go-backend-api-contract-v0.1.md` §3.2/§7.3/§7.4; `docs/database-schema-relationships.md` §4; `docs/tasks/2026-09-07-exercise-library-i18n.md`
- Size (S/M/L/XL, per AGENTS.md §7): **S** (documentation lock only; no schema, API, or seed-row change)

Audited source of truth: `staging` @ `32b2c76` (PR #20 merged). Staging SYSTEM catalog is **134/134** with `apps/api/seeds/system_exercises_v1.sql`.

Trigger: after display-only zh-TW names shipped, the founder asked to grow the shared catalog and later attach images, descriptions, and YouTube links — without reopening whether `exercises.name` should become Chinese.

## 1. Feasibility Analysis

- Problem / trigger: The i18n work proved `name` is identity. Growing the catalog or attaching media will fight that identity if someone stores Chinese SYSTEM names, puts cues inside `name`, or treats YouTube as a `WorkoutItem.VIDEO`.
- Options considered:
  1. Reopen identity: store Chinese names, or introduce `exercise_translations` before adding rows or media.
  2. Freeze English `name` + seed + display map as the baseline; grow the catalog by appending the seed and the map together; attach media later as nullable attributes on `exercises` (object-storage key for images).
  3. Build a CMS / VideoAsset domain now so media and names land together.
- Trade-offs (per option):
  - Option 1 blocks catalog growth on an XL contract change the founder already rejected for i18n.
  - Option 2 lets more English SYSTEM rows ship in a data-only PR, and keeps media a separate contract change.
  - Option 3 is out of MVP scope (AGENTS.md §3, `VideoAsset` is a future entity) and delays user-visible catalog growth.
- Selected option and why: **Option 2**, founder-approved 2026-09-07. English identity stays. Catalog growth and media must not share a task.
- Risks & unknowns: Catalog growth is blocked until the founder provides a name list. Media is not this slice.
- Dependencies / blockers: `docs/tasks/2026-09-07-exercise-library-i18n.md` (display map + seed completeness tests) is Done on staging.

## 2. Technical Design

### Locked decisions (do not reopen)

- **`name` is identity, in English.** `UNIQUE INDEX unique_system_exercise_name ON exercises (lower(name)) WHERE owner_coach_id IS NULL`. Find-or-create and Calendar `buildExercisesPayload` send `name`, never `exerciseId`.
- **zh-TW is display-only.** `apps/web/lib/i18n/exercise-names.ts` keyed by `lower(name)`. Coach-private names (including Chinese) render unchanged.
- **Seed is the catalog source of truth.** `apps/api/seeds/system_exercises_v1.sql` is a manual idempotent `ON CONFLICT DO NOTHING` data seed, not wired into `cmd/migrate`. `exercise-names.test.ts` fails CI on a missing translation, a dead key, copy-pasted English, an unparseable row, or two exercises sharing one Chinese name.
- **Snapshots stay frozen English.** History reads `scheduled_workout_exercises.exercise_name`. A later translation or YouTube link must not rewrite past sessions.
- **Media is not identity.** Do not put description, image, or YouTube into `name`. Do not store image binaries in PostgreSQL. Contract §7.3 `WorkoutItem.VIDEO` is a workout-block type, not an Exercise attribute.

### How to add more SYSTEM exercises (catalog growth)

Same PR, then run the seed once against staging (safe to re-run):

1. Append English rows to `apps/api/seeds/system_exercises_v1.sql` (unique under `lower(name)`; keep the VALUES-line parser valid).
2. Add the matching zh-TW line in `apps/web/lib/i18n/exercise-names.ts` (brand/person stay English).
3. Update `docs/tasks/2026-09-07-exercise-library-i18n.md` §6 only for names that need founder sign-off.

Do **not** `INSERT` only in Neon. Do **not** create Chinese SYSTEM rows. `POST /api/v1/exercises` remains the private one-off escape hatch.

Implementation of those appends is **Blocked** on a founder-provided English name list. Filed as the tracker row below; do not invent names.

### Media (not this slice)

Filed separately: `docs/tasks/2026-09-07-exercise-media-attributes.md`. Nullable `description` / `youtube_url` / object-storage image key on `exercises`, SYSTEM first, API contract change. No `VideoAsset` domain.

- Schema changes: none in this task.
- API changes: none in this task. Canonical wording is updated so the seed is no longer described as unimplemented.
- Backward compatibility: documentation only.

## 3. Estimate

- Size: **S**
- Sub-task breakdown: not required.

## 4. Progress Tracker

| Phase / Sub-task | Status | Notes |
| --- | --- | --- |
| Lock English identity + seed + display map in canonical docs | Done | mvp-spec, frontend-ui-spec, API contract §3.2, schema §4 |
| Catalog-growth runbook | Done | Process above; no rows appended |
| Append seed + zh-TW for a founder name list | Blocked | No list provided 2026-09-07 |
| Re-run seed on staging + verify staging alias | Blocked | Follows the append PR |
| Media attributes | Not Started | `docs/tasks/2026-09-07-exercise-media-attributes.md` |

## 5. Outcome

- Final status: **Done** for the documentation lock. Catalog growth and media remain follow-ups.
- Deviations from plan: none. No seed rows and no schema/API implementation, matching “catalog growth is data; media is a contract change” and “when a founder name list exists.”
- Follow-ups: founder name list → append PR; media task when picked up.
