ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_set_increment_check,
    DROP COLUMN IF EXISTS set_increment;
