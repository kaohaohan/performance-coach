-- 0013 created coach_exercise_media owned by the migration role, and the API's
-- runtime role has no privileges on it until they are granted explicitly
-- (docs/tasks/2026-08-18-d3a-neon-identities-secrets.md: migrations must grant
-- DML on each new application table). Without this every request that reads the
-- table returns 500 "permission denied". A grant issued by anyone but the table
-- owner is silently ignored, which is why it lives in a migration.
--
-- The runtime role only exists on Neon deployments. It is absent on a local
-- database, where the single dev role owns everything, so the grant is skipped.
DO $grant$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'performance_coach_api') THEN
        GRANT SELECT, INSERT, UPDATE, DELETE ON coach_exercise_media TO performance_coach_api;
    END IF;
END
$grant$;
