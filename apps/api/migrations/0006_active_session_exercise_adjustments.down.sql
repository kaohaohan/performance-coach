DROP INDEX IF EXISTS scheduled_workout_exercises_active_position_idx;

ALTER TABLE scheduled_workout_exercises
    ADD CONSTRAINT scheduled_workout_exercises_scheduled_workout_id_position_key
    UNIQUE (scheduled_workout_id, position);

ALTER TABLE scheduled_workout_exercises
    DROP CONSTRAINT scheduled_workout_exercises_removal_actor_check,
    DROP CONSTRAINT scheduled_workout_exercises_origin_actor_check,
    DROP CONSTRAINT scheduled_workout_exercises_origin_check,
    DROP COLUMN replaces_scheduled_workout_exercise_id,
    DROP COLUMN removed_by_user_id,
    DROP COLUMN removed_at,
    DROP COLUMN added_by_user_id,
    DROP COLUMN origin;
