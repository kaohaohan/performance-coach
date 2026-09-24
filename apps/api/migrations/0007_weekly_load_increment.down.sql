ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_load_increment_check,
    DROP COLUMN IF EXISTS load_increment;
