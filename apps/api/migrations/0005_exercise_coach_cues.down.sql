BEGIN;
ALTER TABLE scheduled_workout_exercises DROP CONSTRAINT IF EXISTS scheduled_workout_exercises_coach_cue_check, DROP COLUMN IF EXISTS coach_cue;
ALTER TABLE workout_exercises DROP CONSTRAINT IF EXISTS workout_exercises_coach_cue_check, DROP COLUMN IF EXISTS coach_cue;
COMMIT;
