ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_reps_increment_check,
    DROP COLUMN IF EXISTS reps_increment;
