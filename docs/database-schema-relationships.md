# DontWorkout — Database Schema & Relationships

Status: **V0.1 — aligned with Backend API Contract V0.4**

Purpose: Define the PostgreSQL data model, table responsibilities, foreign keys, cardinality, and integrity constraints for the MVP. Endpoint behavior stays in the Go Backend API Contract.

## 1. Core ERD

```
User (Coach) ──< Workout ──< WorkoutExercise >── Exercise
      │
      └──< CoachAthlete >── User (Athlete)

Workout
  │
  └──< ScheduledWorkout ──< ScheduledWorkoutExercise
                                  │
                                  └──< SetLog
                           │
                           └──1:1── WorkoutSession
```

More explicitly:

```
users
  ├──< coach_athletes >── users
  ├──< workouts
  ├──< exercises (owner_coach_id nullable)
  └──< set_logs (logged_by_user_id)

workouts
  └──< workout_exercises >── exercises
  └──< scheduled_workouts

scheduled_workouts
  ├──< scheduled_workout_exercises
  └──1:1── workout_sessions

workout_sessions
  └──< set_logs

scheduled_workout_exercises
  └──< set_logs
```

## 2. Table Summary

| Table | Important fields | Relationship | Responsibility |
| --- | --- | --- | --- |
| `users` | `id`, `firebase_uid`, `name`, `role` | Root entity | Application identity. Firebase authenticates the user; this row determines internal identity and role. |
| `coach_athletes` | `coach_id`, `athlete_id` | Coach N:N Athlete | Defines which coaches may access and operate on which athletes. |
| `exercises` | `id`, `name`, `owner_coach_id` | Optional owner Coach | Exercise identity/library. `owner_coach_id = NULL` means system seed; otherwise private to one coach. |
| `workouts` | `id`, `coach_id`, `name`, `archived_at` | Coach 1:N Workout | Reusable workout template owned by a coach. |
| `workout_exercises` | `workout_id`, `exercise_id`, target fields, `position` | Workout N:N Exercise through junction entity | Prescription of an exercise inside a workout template. |
| `scheduled_workouts` | `workout_id`, `coach_id`, `athlete_id`, `scheduled_date` | Workout 1:N; Athlete 1:N | One concrete workout occurrence scheduled to one athlete on one date. |
| `scheduled_workout_exercises` | `scheduled_workout_id`, `exercise_id`, `exercise_name`, target fields, `position` | ScheduledWorkout 1:N | Frozen prescription snapshot created at scheduling time. |
| `workout_sessions` | `scheduled_workout_id`, `athlete_id`, `status`, timestamps | ScheduledWorkout 1:0..1 | Actual training occurrence. One scheduled workout can create at most one session. |
| `set_logs` | `session_id`, `scheduled_workout_exercise_id`, `set_number`, `load`, `unit`, `reps`, `rpe`, `logged_by_user_id` | Session 1:N; ScheduledWorkoutExercise 1:N | Actual performance facts recorded during the session. |

## 3. PostgreSQL Schema Shape

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
  rpe numeric not null,
  logged_by_user_id uuid not null references users(id),
  created_at timestamptz not null,
  unique (session_id, scheduled_workout_exercise_id, set_number)
)
```

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

`WorkoutExercise` is the template prescription.

`ScheduledWorkoutExercise` is the frozen prescription snapshot for one athlete/date.

`SetLog` is what actually happened during training.

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

Historical display always reads `exercise_name` and target fields from `scheduled_workout_exercises`. `exercise_id` remains only for analytics/cross-session exercise history. Renaming an Exercise later must not rewrite historical display.

## 6. Important Integrity Rules

- `coach_athletes` prevents duplicate coach-athlete relationships through its composite primary key.
- `workout_exercises (workout_id, position)` is unique so item order cannot collide inside one template.
- `scheduled_workout_exercises (scheduled_workout_id, position)` is unique for the same reason in the frozen snapshot.
- `workout_sessions.scheduled_workout_id` is unique: one ScheduledWorkout creates at most one WorkoutSession.
- `set_logs (session_id, scheduled_workout_exercise_id, set_number)` is unique: the database is the final correctness boundary for set numbering.
- Workout deletion is soft delete only in V0.1. Do not use `ON DELETE CASCADE` from `scheduled_workouts.workout_id` to Workout.
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

V0.1 SetLog is reps-based. `load` and `unit` are nullable for bodyweight movements. Time/distance actual metrics are future extensions.

Not implemented in V0.1: PlannedSet/per-set prescription, polymorphic WorkoutItem, Program/Calendar, Organization/team hierarchy, video tables, wearable data, nutrition, payments, leaderboards, feed.

## 8. Future Extension Points

### PlannedSet

Future per-set prescription:

```
ScheduledWorkoutExercise
  └──< PlannedSet
          └── actual SetLog
```

Example: `100×5@7 / 105×5@8 / 110×3@9`.

### WorkoutItem

Future workout items may include `EXERCISE`, `NOTE`, `REST`, or `VIDEO`. Do not add these meanings to the `exercises` table.

### Program / Calendar

A future Calendar may generate concrete `ScheduledWorkout` rows for athletes. Existing snapshot semantics remain unchanged.