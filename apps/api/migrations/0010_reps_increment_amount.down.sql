ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_reps_increment_check,
    ADD CONSTRAINT workout_exercises_reps_increment_check
        CHECK (reps_increment IN (0, 1));
