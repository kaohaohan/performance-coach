-- Reverses 0011: rpe = 10 - rir, restoring the 1-10 checks.
-- RIR is constrained to 0-9, so converted values stay inside 1-10.

BEGIN;

ALTER TABLE set_logs
    DROP CONSTRAINT IF EXISTS set_logs_rir_check;
ALTER TABLE set_logs RENAME COLUMN rir TO rpe;
UPDATE set_logs SET rpe = 10 - rpe WHERE rpe IS NOT NULL;
ALTER TABLE set_logs
    ADD CONSTRAINT set_logs_rpe_check
        CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10);

ALTER TABLE scheduled_workout_planned_sets
    DROP CONSTRAINT IF EXISTS scheduled_workout_planned_sets_rir_check;
ALTER TABLE scheduled_workout_planned_sets RENAME COLUMN target_rir TO target_rpe;
UPDATE scheduled_workout_planned_sets SET target_rpe = 10 - target_rpe WHERE target_rpe IS NOT NULL;
ALTER TABLE scheduled_workout_planned_sets
    ADD CONSTRAINT scheduled_workout_planned_sets_rpe_check
        CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 10);

ALTER TABLE scheduled_workout_exercises
    DROP CONSTRAINT IF EXISTS scheduled_workout_exercises_target_rir_check;
ALTER TABLE scheduled_workout_exercises RENAME COLUMN target_rir TO target_rpe;
UPDATE scheduled_workout_exercises SET target_rpe = 10 - target_rpe WHERE target_rpe IS NOT NULL;
ALTER TABLE scheduled_workout_exercises
    ADD CONSTRAINT scheduled_workout_exercises_target_rpe_check
        CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 10);

ALTER TABLE workout_exercise_set_overrides
    DROP CONSTRAINT IF EXISTS workout_exercise_set_overrides_rir_check;
ALTER TABLE workout_exercise_set_overrides RENAME COLUMN rir_override TO rpe_override;
UPDATE workout_exercise_set_overrides SET rpe_override = 10 - rpe_override WHERE rpe_override IS NOT NULL;
ALTER TABLE workout_exercise_set_overrides
    ADD CONSTRAINT workout_exercise_set_overrides_rpe_check
        CHECK (rpe_override IS NULL OR rpe_override BETWEEN 1 AND 10);

ALTER TABLE workout_exercises
    DROP CONSTRAINT IF EXISTS workout_exercises_target_rir_check;
ALTER TABLE workout_exercises RENAME COLUMN target_rir TO target_rpe;
UPDATE workout_exercises SET target_rpe = 10 - target_rpe WHERE target_rpe IS NOT NULL;
ALTER TABLE workout_exercises
    ADD CONSTRAINT workout_exercises_target_rpe_check
        CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 10);

COMMIT;
