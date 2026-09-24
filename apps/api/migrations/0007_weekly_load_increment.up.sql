-- Coach-authored weekly load increment per WorkoutExercise template.
-- Applied only when building the next assignment; snapshots store resolved
-- planned load only.

ALTER TABLE workout_exercises
    ADD COLUMN load_increment numeric NOT NULL DEFAULT 2.5,
    ADD CONSTRAINT workout_exercises_load_increment_check
        CHECK (load_increment >= 0);
