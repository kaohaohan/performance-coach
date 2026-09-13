ALTER TABLE exercises
    DROP COLUMN IF EXISTS image_object_key,
    DROP COLUMN IF EXISTS youtube_url,
    DROP COLUMN IF EXISTS description;
