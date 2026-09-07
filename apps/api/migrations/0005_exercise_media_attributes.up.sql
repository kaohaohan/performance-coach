-- V0.11 exercise media attributes: optional description, YouTube URL, and
-- object-storage image key on the Exercise catalog row.
--
-- Additive. Does not change name identity or snapshot semantics. See
-- docs/tasks/2026-09-07-exercise-media-attributes.md.

ALTER TABLE exercises
    ADD COLUMN description text NULL,
    ADD COLUMN youtube_url text NULL,
    ADD COLUMN image_object_key text NULL;
