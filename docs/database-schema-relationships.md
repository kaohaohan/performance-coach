# DontWorkout — Database Schema & Relationships

Status: **Current scalar schema + approved V0.1 planned-set target schema; migration pending**

Purpose: Define the PostgreSQL data model, table responsibilities, foreign keys, cardinality, and integrity constraints for the MVP. Endpoint behavior stays in the Go Backend API Contract.

## 1. Core ERD

```
User (Coach) ──< Workout ──< WorkoutExercise >── Exercise
      │
      ├──< CoachInviteCode
      │
      └──< CoachAthlete >── User (Athlete)

Workout
  ├──< WorkoutExercise ──< WorkoutExerciseSetOverride
  │
  └──< ScheduledWorkout ──< ScheduledWorkoutExercise ──< ScheduledWorkoutPlannedSet
                                  │                           │
                                  └──────────────< SetLog >────┘
                           │
                           └──1:1── WorkoutSession
```

More explicitly:

```
users
  ├──< coach_athletes >── users
  ├──< coach_invite_codes
  ├──< workouts
  ├──< exercises (owner_coach_id nullable)
  ├──< set_logs (logged_by_user_id)
  └──1:0..1── account_deletion_jobs

workouts
  └──< workout_exercises >── exercises
         └──< workout_exercise_set_overrides
  └──< scheduled_workouts

scheduled_workouts
  ├──< scheduled_workout_exercises
  └──1:1── workout_sessions

workout_sessions
  └──< set_logs

scheduled_workout_exercises
  └──< scheduled_workout_planned_sets
  └──< set_logs

scheduled_workout_planned_sets
  └──< set_logs (nullable reference; null = EXTRA)
```

Redeeming a `coach_invite_codes` row inserts a `coach_athletes` row. The invite row itself is never consumed, decremented, or referenced from `coach_athletes` — it stays reusable until it expires or is revoked.

## 2. Table Summary

| Table | Important fields | Relationship | Responsibility |
| --- | --- | --- | --- |
| `users` | `id`, `firebase_uid`, `name`, `role`, `deleted_at` | Root entity | Application identity. Firebase authenticates the user; this row determines internal identity and role. `deleted_at` non-null is a tombstone: login identity is gone; the row remains so historical FKs stay valid. Display name becomes `Deleted Coach` or `Deleted Athlete`. |
| `account_deletion_jobs` | `user_id`, `original_firebase_uid`, `apple_refresh_token`, `firebase_deleted_at`, `apple_revoked_at`, `status` | User 1:0..1 | Durable external-cleanup record for Firebase `DeleteUser` and Apple `/auth/revoke`. Not an audit log. |
| `coach_athletes` | `coach_id`, `athlete_id` | Coach N:N Athlete | Join row retained after account deletion as **historical access** ACL. Service layer distinguishes that from an **active relationship** (`deleted_at IS NULL` on both users). No `ended_at` column in V0.10. |
| `coach_invite_codes` | `id`, `coach_id`, `code`, `description`, `expires_at`, `revoked_at` | Coach 1:N | Reusable capability a coach shares so athletes can self-connect. Redemption inserts `coach_athletes`; the invite row is never consumed. |
| `exercises` | `id`, `name`, `owner_coach_id` | Optional owner Coach | Exercise identity/library. `owner_coach_id = NULL` means system seed; otherwise private to one coach. |
| `workouts` | `id`, `coach_id`, `name`, `archived_at` | Coach 1:N Workout | Reusable workout template owned by a coach. |
| `workout_exercises` | `workout_id`, `exercise_id`, set count, defaults, one planned load unit, `position` | Workout N:N Exercise through junction entity | Uniform-first authoring defaults for one template exercise. |
| `workout_exercise_set_overrides` | `workout_exercise_id`, `planned_position`, nullable override values | WorkoutExercise 1:N | Sparse, property-specific explicit values; absent property means inherit. |
| `scheduled_workouts` | `workout_id`, `coach_id`, `athlete_id`, `scheduled_date` | Workout 1:N; Athlete 1:N | One concrete workout occurrence scheduled to one athlete on one date. |
| `scheduled_workout_exercises` | `scheduled_workout_id`, `exercise_id`, `exercise_name`, planned load unit, `position` | ScheduledWorkout 1:N | Frozen exercise identity/name/unit snapshot parent. |
| `scheduled_workout_planned_sets` | `scheduled_workout_exercise_id`, `planned_position`, resolved target fields | ScheduledWorkoutExercise 1:N | Fully resolved immutable planned positions used by Athlete execution. |
| `workout_sessions` | `scheduled_workout_id`, `athlete_id`, `status`, timestamps | ScheduledWorkout 1:0..1 | Actual training occurrence. One scheduled workout can create at most one session. |
| `set_logs` | `session_id`, `scheduled_workout_exercise_id`, optional `scheduled_workout_planned_set_id`, `set_number`, actual fields | Session 1:N; ScheduledWorkoutExercise 1:N; optional PlannedSet link | Actual performance. Non-null planned-set link = PLANNED; null link = EXTRA. |

The rows above describe the implemented responsibilities. `0001_init_schema` established the scalar baseline; `0002_planned_set_prescription` added the override and planned-set rows recorded in §3.1; `0003_coach_invite_codes` added the invite table. §3 records the current checked-in shape. §3.3 is the approved account-deletion additive shape (`0004_account_deletion`); it must not be applied until `docs/tasks/2026-08-26-account-deletion.md` is implemented.

## 3. Current implemented PostgreSQL shape

```sql
users(
  id uuid primary key,
  firebase_uid text unique not null,
  name text not null,
  role text not null,
  created_at timestamptz not null
)

coach_athletes(
  coach_id uuid references users(id),
  athlete_id uuid references users(id),
  primary key (coach_id, athlete_id)
)

coach_invite_codes(
  id uuid primary key,
  coach_id uuid not null references users(id),
  code text not null unique,
  description text null,
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  created_at timestamptz not null
)
  -- coach_invite_codes_code_format_check:
  --   CHECK (code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$')
  -- coach_invite_codes_description_check:
  --   CHECK (description IS NULL OR length(btrim(description)) > 0)
  -- coach_invite_codes_expiry_check:  CHECK (expires_at > created_at)
  -- coach_invite_codes_revoked_check: CHECK (revoked_at IS NULL OR revoked_at >= created_at)
  -- INDEX coach_invite_codes_coach_created_idx (coach_id, created_at DESC)
  --   serves GET /api/v1/invite-codes (caller's own codes, newest first)
  -- Status (ACTIVE/EXPIRED/REVOKED) is derived at read time from
  --   revoked_at and expires_at; it is never stored.

exercises(
  id uuid primary key,
  name text not null,
  owner_coach_id uuid null references users(id),
  created_at timestamptz not null
)

workouts(
  id uuid primary key,
  coach_id uuid not null references users(id),
  name text not null,
  archived_at timestamptz null,
  created_at timestamptz not null
)

workout_exercises(
  id uuid primary key,
  workout_id uuid not null references workouts(id),
  exercise_id uuid not null references exercises(id),
  target_sets integer not null,
  target_reps integer null,
  target_prescription_note text null,
  target_rpe numeric null,
  position integer not null,
  unique (workout_id, position),
  check (target_reps is not null or target_prescription_note is not null)
)

scheduled_workouts(
  id uuid primary key,
  workout_id uuid not null references workouts(id),
  coach_id uuid not null references users(id),
  athlete_id uuid not null references users(id),
  scheduled_date date not null,
  created_at timestamptz not null
)

scheduled_workout_exercises(
  id uuid primary key,
  scheduled_workout_id uuid not null references scheduled_workouts(id),
  exercise_id uuid not null references exercises(id),
  exercise_name text not null,
  target_sets integer not null,
  target_reps integer null,
  target_prescription_note text null,
  target_rpe numeric null,
  position integer not null,
  unique (scheduled_workout_id, position),
  check (target_reps is not null or target_prescription_note is not null)
)

workout_sessions(
  id uuid primary key,
  scheduled_workout_id uuid unique not null references scheduled_workouts(id),
  athlete_id uuid not null references users(id),
  status text not null,
  started_at timestamptz not null,
  completed_at timestamptz null
)

set_logs(
  id uuid primary key,
  session_id uuid not null references workout_sessions(id),
  scheduled_workout_exercise_id uuid not null references scheduled_workout_exercises(id),
  set_number integer not null,
  load numeric null,
  unit text null,
  reps integer not null,
  rpe numeric null,
  logged_by_user_id uuid not null references users(id),
  created_at timestamptz not null,
  unique (session_id, scheduled_workout_exercise_id, set_number)
)
```

### 3.1 Planned-set shape as implemented

Implemented additively by `0002_planned_set_prescription` without rewriting `0001_init_schema`. These entities and semantics are canonical:

```sql
workout_exercises(
  id uuid primary key,
  workout_id uuid not null references workouts(id),
  exercise_id uuid not null references exercises(id),
  target_sets integer not null,
  target_reps integer null,
  target_prescription_note text null,
  target_load numeric null,
  target_load_unit text null,
  target_rpe numeric null,
  position integer not null,
  unique (workout_id, position),
  check (exactly one of target_reps/target_prescription_note is non-null),
  check (target_load is null or target_load_unit is non-null),
  check (target_load_unit is null or target_load_unit in ('kg', 'lb'))
)

workout_exercise_set_overrides(
  id uuid primary key,
  workout_exercise_id uuid not null references workout_exercises(id),
  planned_position integer not null,
  reps_override integer null,
  prescription_note_override text null,
  load_override numeric null,
  rpe_override numeric null,
  unique (workout_exercise_id, planned_position),
  check (planned_position > 0),
  check (reps_override and prescription_note_override are not both non-null),
  check (at least one override value is non-null)
)

scheduled_workout_exercises(
  id uuid primary key,
  scheduled_workout_id uuid not null references scheduled_workouts(id),
  exercise_id uuid not null references exercises(id),
  exercise_name text not null,
  target_load_unit text null,
  position integer not null,
  unique (scheduled_workout_id, position)
)

scheduled_workout_planned_sets(
  id uuid primary key,
  scheduled_workout_exercise_id uuid not null references scheduled_workout_exercises(id),
  planned_position integer not null,
  target_reps integer null,
  target_prescription_note text null,
  target_load numeric null,
  target_rpe numeric null,
  unique (scheduled_workout_exercise_id, planned_position),
  check (exactly one of target_reps/target_prescription_note is non-null)
)

set_logs(
  ...existing actual fields...,
  scheduled_workout_planned_set_id uuid null references scheduled_workout_planned_sets(id),
  unique (session_id, scheduled_workout_exercise_id, set_number)
)

create unique index one_actual_per_planned_set
  on set_logs(session_id, scheduled_workout_planned_set_id)
  where scheduled_workout_planned_set_id is not null;
```

Existing `workout_exercises.target_reps`, `target_prescription_note`, and `target_rpe` become authoring defaults; they do not need duplicate `default_*` columns. V0.1 override storage has only two states: a null override column means inherit; a non-null override column means explicit value. It does not encode explicit-none. The service validates override position `<= target_sets`, requires the parent `target_load_unit` when any load override exists, and validates that a SetLog's planned-set reference belongs to the same snapshot exercise and session. A null SetLog planned-set reference is the formal EXTRA representation.

### 3.2 Migration/backfill as executed by `0002_planned_set_prescription`

1. Before schema mutation, query both current template and scheduled snapshot tables for rows where `target_reps IS NOT NULL AND target_prescription_note IS NOT NULL`.
2. If either query returns any row, stop and inspect those rows manually. There is no `reps wins` or text-wins precedence rule.
3. Add new columns/tables/FKs without rewriting `0001_init_schema`.
4. Treat every existing template scalar prescription as WorkoutExercise defaults with no override rows. Existing `target_sets`, reps-or-text, and RPE remain in place; add planned load/unit as absent.
5. For each existing `scheduled_workout_exercises` row, generate exactly `target_sets` frozen planned rows numbered `1..target_sets`, copying the current scalar reps-or-text/RPE into every row.
6. For each existing SetLog, link it to the frozen planned row whose position equals `set_number` when that position exists. Existing logs beyond the prescribed count remain null-linked EXTRA rows.
7. Validate cardinality, ordering, association, and uniqueness before adding final constraints.
8. Deploy the revised `/api/v1` backend and frontend as one controlled coordinated change. Do not maintain dual reads/writes. Removing deprecated scalar columns is a later cleanup only after the new path is verified.

### 3.3 Approved account-deletion shape (`0004_account_deletion`)

Additive. No user-level `ON DELETE CASCADE`. Current `0001`–`0003` FKs to `users` remain `NO ACTION`.

```sql
users(
  ...existing columns...,
  deleted_at timestamptz null
)

account_deletion_jobs(
  user_id uuid primary key references users(id),
  original_firebase_uid text not null,
  apple_refresh_token text null,
  firebase_deleted_at timestamptz null,
  apple_revoked_at timestamptz null,
  status text not null,
  last_error text null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  check (status in ('PENDING_EXTERNAL', 'COMPLETE'))
)
```

Deletion policy (service, not FK cascade):

- Tombstone the `users` row: set `deleted_at`, replace `name` with `Deleted Coach` or `Deleted Athlete`. Keep `firebase_uid` until Firebase `DeleteUser(original_firebase_uid)` succeeds, then atomically rewrite both `users.firebase_uid` and `account_deletion_jobs.original_firebase_uid` to `deleted:{users.id}`. The original UID is retry state, not a post-COMPLETE identity.
- Physically delete invite codes; unstarted `scheduled_workouts` (no session) in existing snapshot FK order; unreferenced coach-owned workouts (and their template children); unreferenced private exercises. System exercises stay.
- Retain `coach_athletes`; retain scheduled workouts that have a session, plus snapshots / sessions / set_logs; retain `workouts` rows referenced by remaining `scheduled_workouts.workout_id`; retain private `exercises` referenced by remaining `scheduled_workout_exercises.exercise_id`.
- Do not rewrite `ACTIVE` sessions to `COMPLETED`. A future `ABANDONED` status is out of scope.

`apple_refresh_token` is secret-at-rest and must be nulled when `apple_revoked_at` is set.

## 4. Exercise Library Uniqueness

System exercises and private coach exercises use separate partial unique indexes:

```sql
CREATE UNIQUE INDEX unique_system_exercise_name
ON exercises (lower(name))
WHERE owner_coach_id IS NULL;

CREATE UNIQUE INDEX unique_coach_exercise_name
ON exercises (owner_coach_id, lower(name))
WHERE owner_coach_id IS NOT NULL;
```

V0.1 rule: if a system exercise and requested name match after `lower(trim(name))`, the system exercise wins. Same-name private override is not supported in V0.1.

## 5. Prescription vs Actual

> **Prescription can be ambiguous; actual performance must be structured.**
> 

`WorkoutExercise` plus sparse `WorkoutExerciseSetOverride` rows is the editable template prescription.

`ScheduledWorkoutExercise` plus fully resolved `ScheduledWorkoutPlannedSet` rows is the frozen prescription snapshot for one athlete/date.

`SetLog` is what actually happened during training.

`0001_init_schema` aligned plan and actual only at exercise level. Since `0002_planned_set_prescription`, normal actuals are aligned by explicit frozen planned-set reference while exercise context is preserved for both normal and extra SetLogs.

Example:

```
WorkoutExercise
Back Squat — 4 × 5 @ RPE 8

        schedule
           ↓

ScheduledWorkoutExercise
Back Squat — 4 × 5 @ RPE 8  ← frozen

        training
           ↓

SetLog #1: 100 kg × 5 @7
SetLog #2: 105 kg × 5 @8
SetLog #3: 105 kg × 5 @8
SetLog #4: 110 kg × 4 @9
```

Historical display reads `exercise_name` and `target_load_unit` from `scheduled_workout_exercises`, and resolved targets from `scheduled_workout_planned_sets`. It never reads the live template for historical display. `exercise_id` remains only for analytics/cross-session exercise history. Renaming an Exercise later must not rewrite historical display.

### 5.1 Approved hybrid planned-set architecture

These V0.1 rules are persisted by the shape recorded in §3.1 (`0002_planned_set_prescription`):

- `target sets = N` yields exactly `N` effective planned set positions, ordered `1..N`.
- The **authoring model** contains exercise-level defaults plus sparse, property-specific per-position overrides. The Coach starts in a **uniform-first** editing mode: one reps value or text prescription, one load plus unit, and one RPE may apply to all `N` positions; uniform work must not require N repeated entries.
- A position with no explicit override for a property inherits that property's current default. An individual position can override reps while still inheriting load and RPE; it is not an all-or-nothing override object. Planned-set position is distinct from the `position` field that orders exercises in a Workout.
- Editing an inherited property begins with that position's current effective value. Changing it creates an override. Changing a default updates every position still inheriting that property, while explicit overrides remain unchanged. Clearing an override restores inheritance from the current default. There is no explicit-none override state in V0.1.
- Every effective planned position can express numeric reps or an existing text prescription, optional planned load, and optional planned RPE. One `kg`/`lb` planned unit belongs to the entire WorkoutExercise; per-position rows override only numeric load. Mixed planned units inside one exercise and automatic conversion are not supported. Actual SetLog units remain independent actual facts.
- The **effective planned prescription** resolves defaults and overrides deterministically for every planned position at save/build and scheduling time. The authoring model is distinct from this resolved plan.
- Authoring persistence uses defaults on WorkoutExercise plus sparse override rows. Scheduling freezes each athlete's fully effective values into one normalized row per planned position. Later template edits never mutate a ScheduledWorkout snapshot.
- Normal SetLogs explicitly reference the corresponding frozen planned row; `set_number` remains actual chronology. Extra SetLogs have a null reference and no target. Planned positions without SetLogs are incomplete; no explicit skipped rows are stored.

Example:

```
Planned Set 4: 8 reps / 85 kg / RPE 8
Actual Set 4:  7 reps / 85 kg / RPE 9
```

The target representation is the normalized hybrid shape in §3.1. Because this is a controlled pilot, implementation revises the existing `/api/v1` contract and coordinates migration/backend/frontend; no V2, dual-read, or dual-write layer is approved.

## 6. Important Integrity Rules

- `coach_athletes` prevents duplicate coach-athlete relationships through its composite primary key.
- `coach_invite_codes.code` is globally unique and constrained by CHECK to a 10-character unambiguous alphabet: the database, not the generator, is the final guarantee that two coaches can never share a code.
- There is no redemption-audit table. Idempotent redemption is guaranteed by `coach_athletes`'s composite primary key plus `ON CONFLICT DO NOTHING`; no second table is required for correctness.
- `workout_exercises (workout_id, position)` is unique so item order cannot collide inside one template.
- `scheduled_workout_exercises (scheduled_workout_id, position)` is unique for the same reason in the frozen snapshot.
- `workout_exercise_set_overrides (workout_exercise_id, planned_position)` is unique; service validation keeps positions within `1..target_sets`.
- `scheduled_workout_planned_sets (scheduled_workout_exercise_id, planned_position)` is unique and represents the frozen ordered target.
- `workout_sessions.scheduled_workout_id` is unique: one ScheduledWorkout creates at most one WorkoutSession.
- `set_logs (session_id, scheduled_workout_exercise_id, set_number)` is unique: the database is the final correctness boundary for set numbering.
- A partial unique index on `(session_id, scheduled_workout_planned_set_id)` prevents two normal actual logs from claiming one planned target; null references allow multiple extras.
- Workout deletion is soft delete only in V0.1. Do not use `ON DELETE CASCADE` from `scheduled_workouts.workout_id` to Workout.
- Account deletion must not use `ON DELETE CASCADE` from any `users` FK. Performed-training rows stay; identity is anonymized. Unstarted assignments and unreferenced coach-owned library rows are service-layer physical deletes.
- `account_deletion_jobs` is the durable recovery record for Firebase and Apple cleanup. Process-boot sweep of `PENDING_EXTERNAL` is best-effort, not a guaranteed scheduler.
- Authorization is enforced in the service layer; foreign keys and constraints enforce structural integrity, not application permissions.

## 7. V0.1 Scope Boundary

The schema intentionally supports only the current core loop:

```
Coach
→ Workout
→ Schedule Athlete
→ WorkoutSession
→ SetLog
→ Review
```

V0.1 SetLog is currently reps-based. Actual `load` and `unit` are nullable for bodyweight movements. Time/distance actual metrics remain future extensions; preserving a planned text prescription such as `30 sec` does not itself make duration an actual SetLog metric.

Implemented: template override rows, scheduled planned-set rows, and explicit SetLog planned-set association (`0002_planned_set_prescription`); coach invite codes (`0003_coach_invite_codes`). Approved, not yet migrated: account-deletion tombstone (`0004_account_deletion`). Still out of scope: polymorphic WorkoutItem, Program/Calendar, Organization/team hierarchy, video tables, wearable data, nutrition, payments, leaderboards, feed, `ABANDONED` session status.

## 8. Future Extension Points

### Deferred planned-set extensions

Explicit-none overrides, mixed planned units inside one WorkoutExercise, persisted skipped states/reasons, multiple replacement actuals for one planned target, and automatic unit conversion are deferred. They must not be added to the approved V0.1 migration without a new product decision.

### WorkoutItem

Future workout items may include `EXERCISE`, `NOTE`, `REST`, or `VIDEO`. Do not add these meanings to the `exercises` table.

### Program / Calendar

A future Calendar may generate concrete `ScheduledWorkout` rows for athletes. Existing snapshot semantics remain unchanged.
