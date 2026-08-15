-- V0.1 planned-set prescription migration.
--
-- This migration is additive. It preserves the existing scalar scheduled
-- prescription columns temporarily; a later coordinated cleanup may remove
-- those deprecated columns after the new readers/writers are live.
--
-- Run only after 0001_init_schema.up.sql and only against an isolated test
-- database until the backfill verification has been reviewed.

BEGIN;

-- Legacy data must be unambiguous before it is expanded into planned rows.
DO $$
DECLARE
    violations bigint;
BEGIN
    IF to_regprocedure('gen_random_uuid()') IS NULL THEN
        RAISE EXCEPTION '0002 requires PostgreSQL gen_random_uuid() support';
    END IF;

    SELECT count(*) INTO violations
    FROM workout_exercises
    WHERE target_reps IS NOT NULL
      AND target_prescription_note IS NOT NULL;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 preflight failed: % workout_exercises rows contain both reps and prescription note',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM scheduled_workout_exercises
    WHERE target_reps IS NOT NULL
      AND target_prescription_note IS NOT NULL;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 preflight failed: % scheduled_workout_exercises rows contain both reps and prescription note',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM workout_exercises
    WHERE (target_reps IS NULL AND target_prescription_note IS NULL)
       OR target_sets <= 0
       OR (target_reps IS NOT NULL AND target_reps < 1)
       OR (target_prescription_note IS NOT NULL
           AND length(btrim(target_prescription_note)) = 0);
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 preflight failed: % invalid workout_exercises prescriptions',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM scheduled_workout_exercises
    WHERE (target_reps IS NULL AND target_prescription_note IS NULL)
       OR target_sets <= 0
       OR (target_reps IS NOT NULL AND target_reps < 1)
       OR (target_prescription_note IS NOT NULL
           AND length(btrim(target_prescription_note)) = 0);
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 preflight failed: % invalid scheduled_workout_exercises prescriptions',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM set_logs
    WHERE set_number <= 0;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 preflight failed: % set_logs rows have non-positive set_number',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM set_logs sl
    JOIN workout_sessions ws
      ON ws.id = sl.session_id
    JOIN scheduled_workout_exercises swe
      ON swe.id = sl.scheduled_workout_exercise_id
    JOIN scheduled_workouts sw
      ON sw.id = ws.scheduled_workout_id
    WHERE swe.scheduled_workout_id <> sw.id;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 preflight failed: % set_logs rows cross session/snapshot exercises',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM workout_sessions ws
    JOIN scheduled_workouts sw
      ON sw.id = ws.scheduled_workout_id
    WHERE ws.athlete_id <> sw.athlete_id;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 preflight failed: % sessions have an athlete different from their scheduled workout',
            violations;
    END IF;
END
$$;

ALTER TABLE workout_exercises
    ADD COLUMN target_load numeric NULL,
    ADD COLUMN target_load_unit text NULL,
    ADD CONSTRAINT workout_exercises_target_load_check
        CHECK (target_load IS NULL OR target_load >= 0),
    ADD CONSTRAINT workout_exercises_target_load_unit_check
        CHECK (target_load_unit IS NULL OR target_load_unit IN ('kg', 'lb'));

CREATE TABLE workout_exercise_set_overrides (
    id uuid PRIMARY KEY,
    workout_exercise_id uuid NOT NULL
        REFERENCES workout_exercises (id) ON DELETE CASCADE,
    planned_position integer NOT NULL,
    reps_override integer NULL,
    prescription_note_override text NULL,
    load_override numeric NULL,
    rpe_override numeric NULL,
    UNIQUE (workout_exercise_id, planned_position),
    CONSTRAINT workout_exercise_set_overrides_position_check
        CHECK (planned_position > 0),
    CONSTRAINT workout_exercise_set_overrides_reps_check
        CHECK (reps_override IS NULL OR reps_override >= 1),
    CONSTRAINT workout_exercise_set_overrides_note_check
        CHECK (
            prescription_note_override IS NULL
            OR length(btrim(prescription_note_override)) > 0
        ),
    CONSTRAINT workout_exercise_set_overrides_load_check
        CHECK (load_override IS NULL OR load_override >= 0),
    CONSTRAINT workout_exercise_set_overrides_rpe_check
        CHECK (rpe_override IS NULL OR rpe_override BETWEEN 1 AND 10),
    CONSTRAINT workout_exercise_set_overrides_prescription_exclusive_check
        CHECK (
            NOT (
                reps_override IS NOT NULL
                AND prescription_note_override IS NOT NULL
            )
        ),
    CONSTRAINT workout_exercise_set_overrides_nonempty_check
        CHECK (
            reps_override IS NOT NULL
            OR prescription_note_override IS NOT NULL
            OR load_override IS NOT NULL
            OR rpe_override IS NOT NULL
        )
);

ALTER TABLE scheduled_workout_exercises
    ADD COLUMN target_load_unit text NULL,
    ADD CONSTRAINT scheduled_workout_exercises_target_load_unit_check
        CHECK (target_load_unit IS NULL OR target_load_unit IN ('kg', 'lb'));

CREATE TABLE scheduled_workout_planned_sets (
    id uuid PRIMARY KEY,
    scheduled_workout_exercise_id uuid NOT NULL
        REFERENCES scheduled_workout_exercises (id),
    planned_position integer NOT NULL,
    target_reps integer NULL,
    target_prescription_note text NULL,
    target_load numeric NULL,
    target_rpe numeric NULL,
    UNIQUE (scheduled_workout_exercise_id, planned_position),
    UNIQUE (id, scheduled_workout_exercise_id),
    CONSTRAINT scheduled_workout_planned_sets_position_check
        CHECK (planned_position > 0),
    CONSTRAINT scheduled_workout_planned_sets_reps_check
        CHECK (target_reps IS NULL OR target_reps >= 1),
    CONSTRAINT scheduled_workout_planned_sets_note_check
        CHECK (
            target_prescription_note IS NULL
            OR length(btrim(target_prescription_note)) > 0
        ),
    CONSTRAINT scheduled_workout_planned_sets_prescription_exclusive_check
        CHECK (
            (target_reps IS NOT NULL AND target_prescription_note IS NULL)
            OR
            (target_reps IS NULL AND target_prescription_note IS NOT NULL)
        ),
    CONSTRAINT scheduled_workout_planned_sets_load_check
        CHECK (target_load IS NULL OR target_load >= 0),
    CONSTRAINT scheduled_workout_planned_sets_rpe_check
        CHECK (target_rpe IS NULL OR target_rpe BETWEEN 1 AND 10)
);

ALTER TABLE set_logs
    ADD COLUMN scheduled_workout_planned_set_id uuid NULL;

-- Existing scalar scheduled snapshots are expanded uniformly. Legacy load is
-- absent because 0001 had no planned-load columns.
INSERT INTO scheduled_workout_planned_sets (
    id,
    scheduled_workout_exercise_id,
    planned_position,
    target_reps,
    target_prescription_note,
    target_load,
    target_rpe
)
SELECT
    gen_random_uuid(),
    swe.id,
    positions.planned_position,
    swe.target_reps,
    swe.target_prescription_note,
    NULL,
    swe.target_rpe
FROM scheduled_workout_exercises swe
CROSS JOIN LATERAL generate_series(1, swe.target_sets) AS positions(planned_position);

-- In-range legacy logs become normal planned logs. Out-of-range logs retain a
-- NULL reference and therefore become EXTRA logs.
UPDATE set_logs sl
SET scheduled_workout_planned_set_id = p.id
FROM scheduled_workout_planned_sets p
WHERE p.scheduled_workout_exercise_id = sl.scheduled_workout_exercise_id
  AND p.planned_position = sl.set_number;

ALTER TABLE set_logs
    ADD CONSTRAINT set_logs_planned_set_exercise_fk
        FOREIGN KEY (
            scheduled_workout_planned_set_id,
            scheduled_workout_exercise_id
        )
        REFERENCES scheduled_workout_planned_sets (
            id,
            scheduled_workout_exercise_id
        );

CREATE UNIQUE INDEX set_logs_one_planned_target_per_session_idx
    ON set_logs (session_id, scheduled_workout_planned_set_id)
    WHERE scheduled_workout_planned_set_id IS NOT NULL;

DO $$
DECLARE
    violations bigint;
BEGIN
    SELECT count(*) INTO violations
    FROM scheduled_workout_exercises swe
    LEFT JOIN scheduled_workout_planned_sets p
      ON p.scheduled_workout_exercise_id = swe.id
    GROUP BY swe.id, swe.target_sets
    HAVING count(p.id) <> swe.target_sets;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 verification failed: % scheduled exercises have incorrect planned-set cardinality',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM set_logs sl
    JOIN scheduled_workout_exercises swe
      ON swe.id = sl.scheduled_workout_exercise_id
    WHERE sl.set_number <= swe.target_sets
      AND sl.scheduled_workout_planned_set_id IS NULL;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 verification failed: % in-range SetLogs were not linked to planned sets',
            violations;
    END IF;

    SELECT count(*) INTO violations
    FROM set_logs sl
    JOIN scheduled_workout_exercises swe
      ON swe.id = sl.scheduled_workout_exercise_id
    WHERE sl.set_number > swe.target_sets
      AND sl.scheduled_workout_planned_set_id IS NOT NULL;
    IF violations > 0 THEN
        RAISE EXCEPTION
            '0002 verification failed: % out-of-range SetLogs were linked to planned sets',
            violations;
    END IF;
END
$$;

COMMIT;
