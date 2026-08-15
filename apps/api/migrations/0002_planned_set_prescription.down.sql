-- Reversible only for an isolated database where the V0.1 planned-set data
-- has not been populated. This is not a production rollback mechanism.

BEGIN;

DO $$
DECLARE
    violations bigint;
BEGIN
    SELECT count(*) INTO violations
    FROM workout_exercise_set_overrides;
    IF violations > 0 THEN
        RAISE EXCEPTION
            'refusing 0002 down: workout_exercise_set_overrides contains % rows',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM scheduled_workout_planned_sets;
    IF violations > 0 THEN
        RAISE EXCEPTION
            'refusing 0002 down: scheduled_workout_planned_sets contains % rows',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM set_logs
    WHERE scheduled_workout_planned_set_id IS NOT NULL;
    IF violations > 0 THEN
        RAISE EXCEPTION
            'refusing 0002 down: % SetLogs have planned-set references',
            violations;
    END IF;
END
$$;

DROP INDEX IF EXISTS set_logs_one_planned_target_per_session_idx;

ALTER TABLE set_logs
    DROP CONSTRAINT IF EXISTS set_logs_planned_set_exercise_fk,
    DROP COLUMN IF EXISTS scheduled_workout_planned_set_id;

DROP TABLE IF EXISTS scheduled_workout_planned_sets;

ALTER TABLE scheduled_workout_exercises
    DROP CONSTRAINT IF EXISTS scheduled_workout_exercises_target_load_unit_check,
    DROP COLUMN IF EXISTS target_load_unit;

DROP TABLE IF EXISTS workout_exercise_set_overrides;

ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_target_load_unit_check,
    DROP CONSTRAINT IF EXISTS workout_exercises_target_load_check,
    DROP COLUMN IF EXISTS target_load_unit,
    DROP COLUMN IF EXISTS target_load;

COMMIT;
