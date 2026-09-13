-- Reversible only for an isolated database where no account-deletion data
-- has been populated. This is not a production rollback mechanism.
-- Removes only the structures introduced by 0004_account_deletion.up.sql.

BEGIN;

DO $$
DECLARE
    job_rows bigint;
    tombstones bigint;
BEGIN
    SELECT count(*) INTO job_rows
    FROM account_deletion_jobs;
    IF job_rows > 0 THEN
        RAISE EXCEPTION
            'refusing 0004 down: account_deletion_jobs contains % rows',
            job_rows;
    END IF;

    SELECT count(*) INTO tombstones
    FROM users
    WHERE deleted_at IS NOT NULL;
    IF tombstones > 0 THEN
        RAISE EXCEPTION
            'refusing 0004 down: users.deleted_at is set on % rows',
            tombstones;
    END IF;
END
$$;

DROP TABLE IF EXISTS account_deletion_jobs;

ALTER TABLE users
    DROP COLUMN IF EXISTS deleted_at;

COMMIT;
