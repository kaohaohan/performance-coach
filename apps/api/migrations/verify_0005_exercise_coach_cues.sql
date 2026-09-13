SELECT table_name, column_name, is_nullable
FROM information_schema.columns
WHERE table_name IN ('workout_exercises', 'scheduled_workout_exercises') AND column_name = 'coach_cue'
ORDER BY table_name;
SELECT conrelid::regclass::text AS table_name, conname
FROM pg_constraint
WHERE conname IN ('workout_exercises_coach_cue_check', 'scheduled_workout_exercises_coach_cue_check')
ORDER BY conname;
