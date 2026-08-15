-- Read-only verification for 0002_planned_set_prescription.up.sql.
-- Run with psql -v ON_ERROR_STOP=1 against performance_coach_test only.

\set ON_ERROR_STOP on

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
      'workout_exercise_set_overrides',
      'scheduled_workout_planned_sets'
  )
ORDER BY table_name;

SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
      (table_name = 'workout_exercises'
       AND column_name IN ('target_load', 'target_load_unit'))
      OR
      (table_name = 'scheduled_workout_exercises'
       AND column_name = 'target_load_unit')
      OR
      (table_name = 'set_logs'
       AND column_name = 'scheduled_workout_planned_set_id')
  )
ORDER BY table_name, column_name;

SELECT swe.id AS scheduled_workout_exercise_id,
       swe.target_sets,
       count(p.id) AS planned_count
FROM scheduled_workout_exercises swe
LEFT JOIN scheduled_workout_planned_sets p
  ON p.scheduled_workout_exercise_id = swe.id
GROUP BY swe.id, swe.target_sets
HAVING count(p.id) <> swe.target_sets;

SELECT scheduled_workout_exercise_id, planned_position, count(*)
FROM scheduled_workout_planned_sets
GROUP BY scheduled_workout_exercise_id, planned_position
HAVING count(*) > 1;

SELECT id
FROM scheduled_workout_planned_sets
WHERE planned_position <= 0
   OR (target_reps IS NULL AND target_prescription_note IS NULL)
   OR (target_reps IS NOT NULL AND target_prescription_note IS NOT NULL)
   OR (target_reps IS NOT NULL AND target_reps < 1)
   OR (target_prescription_note IS NOT NULL
       AND length(btrim(target_prescription_note)) = 0)
   OR (target_load IS NOT NULL AND target_load < 0)
   OR (target_rpe IS NOT NULL AND target_rpe NOT BETWEEN 1 AND 10);

SELECT sl.id
FROM set_logs sl
JOIN scheduled_workout_planned_sets p
  ON p.id = sl.scheduled_workout_planned_set_id
WHERE p.scheduled_workout_exercise_id
   <> sl.scheduled_workout_exercise_id;

SELECT sl.id
FROM set_logs sl
JOIN scheduled_workout_exercises swe
  ON swe.id = sl.scheduled_workout_exercise_id
WHERE sl.set_number <= swe.target_sets
  AND sl.scheduled_workout_planned_set_id IS NULL;

SELECT sl.id
FROM set_logs sl
JOIN scheduled_workout_exercises swe
  ON swe.id = sl.scheduled_workout_exercise_id
WHERE sl.set_number > swe.target_sets
  AND sl.scheduled_workout_planned_set_id IS NOT NULL;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname = 'set_logs_one_planned_target_per_session_idx';

SELECT conrelid::regclass AS table_name,
       conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN (
    'workout_exercise_set_overrides'::regclass,
    'scheduled_workout_planned_sets'::regclass,
    'set_logs'::regclass
)
AND (
    conrelid IN (
        'workout_exercise_set_overrides'::regclass,
        'scheduled_workout_planned_sets'::regclass
    )
    OR conname = 'set_logs_planned_set_exercise_fk'
)
ORDER BY table_name, conname;
