-- Returns NULL for the runtime role on databases where it does not exist.
SELECT has_table_privilege('performance_coach_api', 'coach_exercise_media', 'SELECT') AS can_select,
       has_table_privilege('performance_coach_api', 'coach_exercise_media', 'INSERT') AS can_insert,
       has_table_privilege('performance_coach_api', 'coach_exercise_media', 'UPDATE') AS can_update,
       has_table_privilege('performance_coach_api', 'coach_exercise_media', 'DELETE') AS can_delete,
       has_table_privilege('performance_coach_api', 'coach_exercise_media', 'TRUNCATE') AS can_truncate
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'performance_coach_api');
