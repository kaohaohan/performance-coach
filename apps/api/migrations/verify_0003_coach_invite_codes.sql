-- Read-only verification for 0003_coach_invite_codes.up.sql.
-- Run with psql -v ON_ERROR_STOP=1 against performance_coach_test only.

\set ON_ERROR_STOP on

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name = 'coach_invite_codes';

SELECT column_name, is_nullable, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'coach_invite_codes'
ORDER BY ordinal_position;

SELECT conname
FROM pg_constraint
WHERE conrelid = 'coach_invite_codes'::regclass
  AND conname IN (
      'coach_invite_codes_code_format_check',
      'coach_invite_codes_description_check',
      'coach_invite_codes_expiry_check',
      'coach_invite_codes_revoked_check'
  )
ORDER BY conname;

SELECT indexname
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'coach_invite_codes'
  AND indexname = 'coach_invite_codes_coach_created_idx';

DO $$
DECLARE
    found_constraints integer;
BEGIN
    SELECT count(*) INTO found_constraints
    FROM pg_constraint
    WHERE conrelid = 'coach_invite_codes'::regclass
      AND conname IN (
          'coach_invite_codes_code_format_check',
          'coach_invite_codes_description_check',
          'coach_invite_codes_expiry_check',
          'coach_invite_codes_revoked_check'
      );
    IF found_constraints <> 4 THEN
        RAISE EXCEPTION
            '0003 verification failed: expected 4 CHECK constraints on coach_invite_codes, found %',
            found_constraints;
    END IF;
END
$$;
