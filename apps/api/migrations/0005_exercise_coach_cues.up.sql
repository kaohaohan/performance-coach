-- Optional, workout-context-specific guidance. Templates own the authored
-- cue; scheduled exercises own the immutable copy shown to the athlete.
ALTER TABLE workout_exercises
    ADD COLUMN coach_cue text NULL,
    ADD CONSTRAINT workout_exercises_coach_cue_check
        CHECK (coach_cue IS NULL OR (length(btrim(coach_cue)) > 0 AND length(coach_cue) <= 500));

ALTER TABLE scheduled_workout_exercises
    ADD COLUMN coach_cue text NULL,
    ADD CONSTRAINT scheduled_workout_exercises_coach_cue_check
        CHECK (coach_cue IS NULL OR (length(btrim(coach_cue)) > 0 AND length(coach_cue) <= 500));
