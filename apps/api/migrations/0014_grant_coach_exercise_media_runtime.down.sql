DO $revoke$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'performance_coach_api')
       AND to_regclass('coach_exercise_media') IS NOT NULL THEN
        REVOKE SELECT, INSERT, UPDATE, DELETE ON coach_exercise_media FROM performance_coach_api;
    END IF;
END
$revoke$;
