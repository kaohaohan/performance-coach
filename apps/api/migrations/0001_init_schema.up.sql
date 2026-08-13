-- V0.1 initial schema for the Performance Coach MVP core loop.
--
-- Coach -> Workout -> Schedule Athlete -> WorkoutSession -> SetLog -> Coach Review
--
-- See docs/database-schema-relationships.md for the full data model rationale
-- and docs/go-backend-api-contract-v0.1.md for the endpoints that read/write
-- these tables. Out of scope for V0.1 (do not add here): VideoAsset, AIReview,
-- Organization, Calendar, PlannedSet, WorkoutItem.

CREATE TABLE users (
    id uuid PRIMARY KEY,
    firebase_uid text NOT NULL UNIQUE,
    name text NOT NULL,
    role text NOT NULL,
    created_at timestamptz NOT NULL,
    CONSTRAINT users_role_check CHECK (role IN ('COACH', 'ATHLETE'))
);

CREATE TABLE coach_athletes (
    coach_id uuid NOT NULL REFERENCES users (id),
    athlete_id uuid NOT NULL REFERENCES users (id),
    PRIMARY KEY (coach_id, athlete_id)
);

CREATE TABLE exercises (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    owner_coach_id uuid NULL REFERENCES users (id),
    created_at timestamptz NOT NULL
);

-- System catalog (owner_coach_id IS NULL) must not contain duplicate names.
CREATE UNIQUE INDEX unique_system_exercise_name
    ON exercises (lower(name))
    WHERE owner_coach_id IS NULL;

-- Each coach's private catalog must not contain duplicate names;
-- different coaches may reuse the same name.
CREATE UNIQUE INDEX unique_coach_exercise_name
    ON exercises (owner_coach_id, lower(name))
    WHERE owner_coach_id IS NOT NULL;

CREATE TABLE workouts (
    id uuid PRIMARY KEY,
    coach_id uuid NOT NULL REFERENCES users (id),
    name text NOT NULL,
    archived_at timestamptz NULL,
    created_at timestamptz NOT NULL
);

-- Serves GET /workouts (list scoped to caller coach).
CREATE INDEX workouts_coach_id_idx ON workouts (coach_id);

CREATE TABLE workout_exercises (
    id uuid PRIMARY KEY,
    workout_id uuid NOT NULL REFERENCES workouts (id),
    exercise_id uuid NOT NULL REFERENCES exercises (id),
    target_sets integer NOT NULL,
    target_reps integer NULL,
    target_prescription_note text NULL,
    target_rpe numeric NULL,
    position integer NOT NULL,
    UNIQUE (workout_id, position),
    CONSTRAINT workout_exercises_target_presence_check
        CHECK (target_reps IS NOT NULL OR target_prescription_note IS NOT NULL),
    CONSTRAINT workout_exercises_target_sets_check
        CHECK (target_sets > 0),
    CONSTRAINT workout_exercises_target_rpe_check
        CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 10)
);

CREATE TABLE scheduled_workouts (
    id uuid PRIMARY KEY,
    workout_id uuid NOT NULL REFERENCES workouts (id),
    coach_id uuid NOT NULL REFERENCES users (id),
    athlete_id uuid NOT NULL REFERENCES users (id),
    scheduled_date date NOT NULL,
    created_at timestamptz NOT NULL
);

-- Serves GET /me/scheduled-workouts?date= (athlete Today view).
CREATE INDEX scheduled_workouts_athlete_date_idx
    ON scheduled_workouts (athlete_id, scheduled_date);

-- Serves GET /scheduled-workouts?athleteId=&from=&to= (coach view).
CREATE INDEX scheduled_workouts_coach_athlete_date_idx
    ON scheduled_workouts (coach_id, athlete_id, scheduled_date);

CREATE TABLE scheduled_workout_exercises (
    id uuid PRIMARY KEY,
    scheduled_workout_id uuid NOT NULL REFERENCES scheduled_workouts (id),
    exercise_id uuid NOT NULL REFERENCES exercises (id),
    exercise_name text NOT NULL,
    target_sets integer NOT NULL,
    target_reps integer NULL,
    target_prescription_note text NULL,
    target_rpe numeric NULL,
    position integer NOT NULL,
    UNIQUE (scheduled_workout_id, position),
    CONSTRAINT scheduled_workout_exercises_target_presence_check
        CHECK (target_reps IS NOT NULL OR target_prescription_note IS NOT NULL),
    CONSTRAINT scheduled_workout_exercises_target_sets_check
        CHECK (target_sets > 0),
    CONSTRAINT scheduled_workout_exercises_target_rpe_check
        CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 10)
);

CREATE TABLE workout_sessions (
    id uuid PRIMARY KEY,
    scheduled_workout_id uuid NOT NULL UNIQUE REFERENCES scheduled_workouts (id),
    athlete_id uuid NOT NULL REFERENCES users (id),
    status text NOT NULL,
    started_at timestamptz NOT NULL,
    completed_at timestamptz NULL,
    CONSTRAINT workout_sessions_status_check
        CHECK (status IN ('ACTIVE', 'COMPLETED'))
);

CREATE TABLE set_logs (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES workout_sessions (id),
    scheduled_workout_exercise_id uuid NOT NULL REFERENCES scheduled_workout_exercises (id),
    set_number integer NOT NULL,
    load numeric NULL,
    unit text NULL,
    reps integer NOT NULL,
    rpe numeric NULL,
    logged_by_user_id uuid NOT NULL REFERENCES users (id),
    created_at timestamptz NOT NULL,
    UNIQUE (session_id, scheduled_workout_exercise_id, set_number),
    -- load and unit must be present or absent together (bodyweight movements
    -- have neither; loaded movements have both).
    CONSTRAINT set_logs_load_unit_pairing_check
        CHECK ((load IS NULL) = (unit IS NULL)),
    CONSTRAINT set_logs_unit_check
        CHECK (unit IS NULL OR unit IN ('kg', 'lb')),
    CONSTRAINT set_logs_reps_check
        CHECK (reps >= 1),
    CONSTRAINT set_logs_load_check
        CHECK (load IS NULL OR load >= 0),
    CONSTRAINT set_logs_rpe_check
        CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10)
);
