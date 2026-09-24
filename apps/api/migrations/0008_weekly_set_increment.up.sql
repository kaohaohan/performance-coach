-- Coach-authored weekly set increment per WorkoutExercise template.
-- Applied only when building the next assignment; snapshots store resolved
-- set count only.

ALTER TABLE workout_exercises
    ADD COLUMN set_increment integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT workout_exercises_set_increment_check
        CHECK (set_increment IN (0, 1));
