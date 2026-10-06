-- A Coach's personal demo-video link for one exercise
-- (docs/tasks/2026-10-06-coach-exercise-youtube-override.md). Absence of a row
-- means "use exercises.youtube_url". The shared catalog row is never edited.
-- URL format (https, allowed hosts, length) is validated in the API, like the
-- catalog column it overrides.
--
-- coach_id deliberately has no ON DELETE CASCADE: users are tombstoned, never
-- deleted, and the project forbids cascades from users (see 0004). Account
-- deletion prunes a Coach's rows explicitly in accountdeletion.pruneOwnedData.
CREATE TABLE coach_exercise_media (
    coach_id    uuid        NOT NULL REFERENCES users (id),
    exercise_id uuid        NOT NULL REFERENCES exercises (id) ON DELETE CASCADE,
    youtube_url text        NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (coach_id, exercise_id),
    CONSTRAINT coach_exercise_media_youtube_url_check
        CHECK (length(btrim(youtube_url)) > 0)
);

-- The primary key serves "this coach's overrides"; this serves the cascade from
-- exercises and "who overrides this exercise".
CREATE INDEX coach_exercise_media_exercise_idx ON coach_exercise_media (exercise_id);
