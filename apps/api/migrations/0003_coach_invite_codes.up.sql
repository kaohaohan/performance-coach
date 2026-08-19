-- V0.1 coach invite codes: athlete onboarding without manual bootstrap.
--
-- One coach owns exactly one reusable code per invite. Redemption (a later
-- phase) creates or reconciles an ATHLETE users row and a coach_athletes
-- relationship. The code is a capability, never a credential — Firebase
-- Auth remains the sole authentication authority. See
-- docs/athlete-onboarding-invite-codes-v0.1.md for full rationale.
--
-- Purely additive: no existing table is altered.

CREATE TABLE coach_invite_codes (
    id          uuid PRIMARY KEY,
    coach_id    uuid NOT NULL REFERENCES users (id),
    code        text NOT NULL UNIQUE,
    description text NULL,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz NULL,
    created_at  timestamptz NOT NULL,
    CONSTRAINT coach_invite_codes_code_format_check
        CHECK (code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{10}$'),
    CONSTRAINT coach_invite_codes_description_check
        CHECK (description IS NULL OR length(btrim(description)) > 0),
    CONSTRAINT coach_invite_codes_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT coach_invite_codes_revoked_check
        CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

-- Serves GET /api/v1/invite-codes (caller's own codes, newest first).
CREATE INDEX coach_invite_codes_coach_created_idx
    ON coach_invite_codes (coach_id, created_at DESC);
