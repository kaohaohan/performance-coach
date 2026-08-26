-- Read-only verification for 0004_account_deletion.up.sql.
-- Run with psql -v ON_ERROR_STOP=1 against performance_coach_test only.

\set ON_ERROR_STOP on

SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name = 'deleted_at';

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'account_deletion_jobs';

SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'account_deletion_jobs'
ORDER BY ordinal_position;

SELECT conname
FROM pg_constraint
WHERE conrelid = 'account_deletion_jobs'::regclass
  AND conname = 'account_deletion_jobs_status_check';

DO $$
DECLARE
    deleted_at_ok integer;
    job_table_ok integer;
    status_check_ok integer;
    cascade_from_users integer;
    job_fk_delete_action char;
BEGIN
    SELECT count(*) INTO deleted_at_ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'deleted_at'
      AND is_nullable = 'YES'
      AND data_type = 'timestamp with time zone';
    IF deleted_at_ok <> 1 THEN
        RAISE EXCEPTION
            '0004 verification failed: users.deleted_at missing or not nullable timestamptz';
    END IF;

    SELECT count(*) INTO job_table_ok
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'account_deletion_jobs';
    IF job_table_ok <> 1 THEN
        RAISE EXCEPTION
            '0004 verification failed: account_deletion_jobs table missing';
    END IF;

    SELECT count(*) INTO status_check_ok
    FROM pg_constraint
    WHERE conrelid = 'account_deletion_jobs'::regclass
      AND contype = 'c'
      AND conname = 'account_deletion_jobs_status_check';
    IF status_check_ok <> 1 THEN
        RAISE EXCEPTION
            '0004 verification failed: account_deletion_jobs_status_check missing';
    END IF;

    SELECT confdeltype INTO job_fk_delete_action
    FROM pg_constraint
    WHERE conrelid = 'account_deletion_jobs'::regclass
      AND contype = 'f'
      AND confrelid = 'users'::regclass;
    IF job_fk_delete_action IS DISTINCT FROM 'a' AND job_fk_delete_action IS DISTINCT FROM 'r' THEN
        RAISE EXCEPTION
            '0004 verification failed: account_deletion_jobs.user_id must be NO ACTION/RESTRICT, found confdeltype=%',
            job_fk_delete_action;
    END IF;

    -- Historical training FKs to users must still have no CASCADE.
    SELECT count(*) INTO cascade_from_users
    FROM pg_constraint
    WHERE contype = 'f'
      AND confrelid = 'users'::regclass
      AND confdeltype = 'c';
    IF cascade_from_users <> 0 THEN
        RAISE EXCEPTION
            '0004 verification failed: % FK(s) to users use ON DELETE CASCADE',
            cascade_from_users;
    END IF;
END
$$;
