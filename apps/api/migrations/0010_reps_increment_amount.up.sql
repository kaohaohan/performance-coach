-- Weekly reps increment is a coach-authored whole number (0 = none),
-- not a 0|1 toggle. Existing 0/1 rows stay valid.

ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_reps_increment_check,
    ADD CONSTRAINT workout_exercises_reps_increment_check
        CHECK (reps_increment >= 0 AND reps_increment <= 20);
