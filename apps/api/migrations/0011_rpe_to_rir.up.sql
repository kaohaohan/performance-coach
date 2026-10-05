-- Effort is stored as RIR (reps in reserve), not RPE.
-- Existing values convert mechanically: rir = 10 - rpe (RPE 1-10 -> RIR 9-0).
-- docs/tasks/2026-10-04-rpe-to-rir.md

BEGIN;

ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_target_rpe_check;
ALTER TABLE workout_exercises RENAME COLUMN target_rpe TO target_rir;
UPDATE workout_exercises SET target_rir = 10 - target_rir WHERE target_rir IS NOT NULL;
ALTER TABLE workout_exercises
    ADD CONSTRAINT workout_exercises_target_rir_check
        CHECK (target_rir IS NULL OR target_rir BETWEEN 0 AND 9);

ALTER TABLE workout_exercise_set_overrides
    DROP CONSTRAINT IF EXISTS workout_exercise_set_overrides_rpe_check;
ALTER TABLE workout_exercise_set_overrides RENAME COLUMN rpe_override TO rir_override;
UPDATE workout_exercise_set_overrides SET rir_override = 10 - rir_override WHERE rir_override IS NOT NULL;
ALTER TABLE workout_exercise_set_overrides
    ADD CONSTRAINT workout_exercise_set_overrides_rir_check
        CHECK (rir_override IS NULL OR rir_override BETWEEN 0 AND 9);

ALTER TABLE scheduled_workout_exercises
    DROP CONSTRAINT IF EXISTS scheduled_workout_exercises_target_rpe_check;
ALTER TABLE scheduled_workout_exercises RENAME COLUMN target_rpe TO target_rir;
UPDATE scheduled_workout_exercises SET target_rir = 10 - target_rir WHERE target_rir IS NOT NULL;
ALTER TABLE scheduled_workout_exercises
    ADD CONSTRAINT scheduled_workout_exercises_target_rir_check
        CHECK (target_rir IS NULL OR target_rir BETWEEN 0 AND 9);

ALTER TABLE scheduled_workout_planned_sets
    DROP CONSTRAINT IF EXISTS scheduled_workout_planned_sets_rpe_check;
ALTER TABLE scheduled_workout_planned_sets RENAME COLUMN target_rpe TO target_rir;
UPDATE scheduled_workout_planned_sets SET target_rir = 10 - target_rir WHERE target_rir IS NOT NULL;
ALTER TABLE scheduled_workout_planned_sets
    ADD CONSTRAINT scheduled_workout_planned_sets_rir_check
        CHECK (target_rir IS NULL OR target_rir BETWEEN 0 AND 9);

ALTER TABLE set_logs
    DROP CONSTRAINT IF EXISTS set_logs_rpe_check;
ALTER TABLE set_logs RENAME COLUMN rpe TO rir;
UPDATE set_logs SET rir = 10 - rir WHERE rir IS NOT NULL;
ALTER TABLE set_logs
    ADD CONSTRAINT set_logs_rir_check
        CHECK (rir IS NULL OR rir BETWEEN 0 AND 9);

COMMIT;
