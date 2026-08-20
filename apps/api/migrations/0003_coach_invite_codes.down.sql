-- Reversible only for an isolated database where no coach_invite_codes
-- data has been populated. This is not a production rollback mechanism.

BEGIN;

DO $$
DECLARE
    violations bigint;
BEGIN
    SELECT count(*) INTO violations
    FROM coach_invite_codes;
    IF violations > 0 THEN
        RAISE EXCEPTION
            'refusing 0003 down: coach_invite_codes contains % rows',
            violations;
    END IF;
END
$$;

DROP INDEX IF EXISTS coach_invite_codes_coach_created_idx;

DROP TABLE IF EXISTS coach_invite_codes;

COMMIT;
