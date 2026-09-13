-- V0.10 account deletion: tombstone users and durable external-cleanup jobs.
--
-- Additive. Does not change any existing user-owned FKs and does not add
-- ON DELETE CASCADE from historical training records. See
-- docs/database-schema-relationships.md §3.3 and
-- docs/tasks/2026-08-26-account-deletion.md.

ALTER TABLE users
    ADD COLUMN deleted_at timestamptz NULL;

CREATE TABLE account_deletion_jobs (
    user_id uuid PRIMARY KEY REFERENCES users (id),
    original_firebase_uid text NOT NULL,
    -- Secret-at-rest. Never log. Null after Apple revoke succeeds (or when
    -- the account is not Apple-linked and revoke is N/A).
    apple_refresh_token text NULL,
    firebase_deleted_at timestamptz NULL,
    apple_revoked_at timestamptz NULL,
    status text NOT NULL,
    last_error text NULL,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    CONSTRAINT account_deletion_jobs_status_check
        CHECK (status IN ('PENDING_EXTERNAL', 'COMPLETE'))
);

COMMENT ON COLUMN account_deletion_jobs.apple_refresh_token IS
    'Secret-at-rest Apple refresh token; never log; null after revoke.';

COMMENT ON COLUMN account_deletion_jobs.original_firebase_uid IS
    'Durable Firebase UID for retry until DeleteUser succeeds; rewritten to deleted:{user_id} when status becomes COMPLETE.';
