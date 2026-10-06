SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'coach_exercise_media'
ORDER BY ordinal_position;
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'coach_exercise_media'::regclass
ORDER BY conname;
SELECT indexname
FROM pg_indexes
WHERE tablename = 'coach_exercise_media'
ORDER BY indexname;
