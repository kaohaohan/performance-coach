-- Coach-authored weekly reps increment per WorkoutExercise template.
-- Applied only when building the next assignment; snapshots store resolved
-- reps only.

ALTER TABLE workout_exercises
    ADD COLUMN reps_increment integer NOT NULL DEFAULT 0,
    ADD CONSTRAINT workout_exercises_reps_increment_check
        CHECK (reps_increment IN (0, 1));
