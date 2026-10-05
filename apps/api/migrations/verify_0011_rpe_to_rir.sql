-- Read-only verification for 0011_rpe_to_rir.up.sql.
-- Run with psql -v ON_ERROR_STOP=1 against performance_coach_test only.

\set ON_ERROR_STOP on

-- Expected: the five RIR columns, no RPE-named columns.
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND column_name IN ('target_rir', 'rir_override', 'rir', 'target_rpe', 'rpe_override', 'rpe')
ORDER BY table_name, column_name;

-- Expected: five *_rir_check constraints, no *_rpe_check constraints.
SELECT conrelid::regclass::text AS table_name, conname
FROM pg_constraint
WHERE conname LIKE '%rir\_check' OR conname LIKE '%rpe\_check'
ORDER BY conname;

-- Expected: zero rows (values stay inside 0-9).
SELECT 'workout_exercises' AS table_name, id FROM workout_exercises WHERE target_rir IS NOT NULL AND target_rir NOT BETWEEN 0 AND 9
UNION ALL
SELECT 'workout_exercise_set_overrides', id FROM workout_exercise_set_overrides WHERE rir_override IS NOT NULL AND rir_override NOT BETWEEN 0 AND 9
UNION ALL
SELECT 'scheduled_workout_exercises', id FROM scheduled_workout_exercises WHERE target_rir IS NOT NULL AND target_rir NOT BETWEEN 0 AND 9
UNION ALL
SELECT 'scheduled_workout_planned_sets', id FROM scheduled_workout_planned_sets WHERE target_rir IS NOT NULL AND target_rir NOT BETWEEN 0 AND 9
UNION ALL
SELECT 'set_logs', id FROM set_logs WHERE rir IS NOT NULL AND rir NOT BETWEEN 0 AND 9;
