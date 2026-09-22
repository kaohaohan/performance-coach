-- Preserve scheduled exercise identity and actual history while allowing an
-- ACTIVE session to replace its live work queue incrementally.
ALTER TABLE scheduled_workout_exercises
    ADD COLUMN origin text NOT NULL DEFAULT 'ASSIGNED',
    ADD COLUMN added_by_user_id uuid NULL REFERENCES users(id),
    ADD COLUMN removed_at timestamptz NULL,
    ADD COLUMN removed_by_user_id uuid NULL REFERENCES users(id),
    ADD COLUMN replaces_scheduled_workout_exercise_id uuid NULL REFERENCES scheduled_workout_exercises(id),
    ADD CONSTRAINT scheduled_workout_exercises_origin_check
        CHECK (origin IN ('ASSIGNED', 'COACH_ADDED', 'ATHLETE_ADDED')),
    ADD CONSTRAINT scheduled_workout_exercises_origin_actor_check
        CHECK ((origin = 'ASSIGNED' AND added_by_user_id IS NULL) OR (origin <> 'ASSIGNED' AND added_by_user_id IS NOT NULL)),
    ADD CONSTRAINT scheduled_workout_exercises_removal_actor_check
        CHECK ((removed_at IS NULL) = (removed_by_user_id IS NULL));

ALTER TABLE scheduled_workout_exercises
    DROP CONSTRAINT scheduled_workout_exercises_scheduled_workout_id_position_key;

CREATE UNIQUE INDEX scheduled_workout_exercises_active_position_idx
    ON scheduled_workout_exercises (scheduled_workout_id, position)
    WHERE removed_at IS NULL;
