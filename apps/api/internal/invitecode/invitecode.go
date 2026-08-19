package invitecode

// This file implements the coach-facing invite-code service: Create,
// ListForCoach, and Revoke (package doc lives in code.go). Public preview
// and athlete redemption (docs/athlete-onboarding-invite-codes-v0.1.md
// §5.2/§5.3) are a later phase and are deliberately not implemented here.

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// Status values derived from revoked_at/expires_at at read time — never
// persisted, so there is nothing to drift as time passes.
const (
	StatusActive  = "ACTIVE"
	StatusExpired = "EXPIRED"
	StatusRevoked = "REVOKED"
)

// defaultExpiresInDays and the allowed range match
// docs/athlete-onboarding-invite-codes-v0.1.md §2 decision #2 and §5.1.
const (
	defaultExpiresInDays = 30
	minExpiresInDays     = 1
	maxExpiresInDays     = 365
	maxDescriptionLength = 120
)

// InviteCode is the coach-facing API response shape for one invite code
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.1). Status is derived,
// not stored.
type InviteCode struct {
	ID          string     `json:"id"`
	Code        string     `json:"code"`
	Description *string    `json:"description"`
	Status      string     `json:"status"`
	ExpiresAt   time.Time  `json:"expiresAt"`
	RevokedAt   *time.Time `json:"revokedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
}

// ErrForbidden indicates the caller is authenticated but not authorized
// (i.e. not a COACH) to create, list, or revoke invite codes.
var ErrForbidden = errors.New("invitecode: caller is not a coach")

// ErrNotFound indicates the requested invite code does not exist, or
// belongs to a different coach — deliberately one indistinguishable
// outcome (docs/athlete-onboarding-invite-codes-v0.1.md §5.1), matching
// the "resource-scoping, not a role check" pattern used elsewhere (e.g.
// scheduledworkout.ErrWorkoutNotFound). Handlers map this to 404 NOT_FOUND.
var ErrNotFound = errors.New("invitecode: not found")

// ValidationError indicates the request failed shape validation before any
// database access. Handlers map it to 400 INVALID_ARGUMENT.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// CreateInput is the validated-shape request for Create. ExpiresInDays is
// a pointer so "omitted" (use the default) is distinguishable from an
// explicit value.
type CreateInput struct {
	Description   *string
	ExpiresInDays *int
}

// Create validates input and creates one reusable invite code owned by the
// caller. Only a COACH may call this.
func Create(ctx context.Context, pool *pgxpool.Pool, caller authn.User, input CreateInput) (InviteCode, error) {
	if caller.Role != "COACH" {
		return InviteCode{}, ErrForbidden
	}

	description, err := normalizeDescription(input.Description)
	if err != nil {
		return InviteCode{}, err
	}

	expiresInDays, err := normalizeExpiresInDays(input.ExpiresInDays)
	if err != nil {
		return InviteCode{}, err
	}

	// Regeneration on a unique-violation is a defensive backstop, not an
	// expected path: at ~50 bits of entropy (crypto/rand, 10-character
	// Crockford Base32) a collision is astronomically unlikely.
	const maxAttempts = 3
	var lastErr error
	for attempt := 0; attempt < maxAttempts; attempt++ {
		code, err := Generate()
		if err != nil {
			return InviteCode{}, fmt.Errorf("invitecode: create: %w", err)
		}

		created, err := insert(ctx, pool, caller.ID, code, description, expiresInDays)
		if err == nil {
			return created, nil
		}
		if !isUniqueViolation(err) {
			return InviteCode{}, fmt.Errorf("invitecode: create: %w", err)
		}
		lastErr = err
	}
	return InviteCode{}, fmt.Errorf("invitecode: create: exhausted %d attempts generating a unique code: %w", maxAttempts, lastErr)
}

func insert(ctx context.Context, pool *pgxpool.Pool, coachID, code string, description *string, expiresInDays int) (InviteCode, error) {
	const query = `
		INSERT INTO coach_invite_codes (id, coach_id, code, description, expires_at, revoked_at, created_at)
		VALUES ($1, $2, $3, $4, now() + make_interval(days => $5), NULL, now())
		RETURNING id, code, description, expires_at, revoked_at, created_at`

	var ic InviteCode
	err := pool.QueryRow(ctx, query, uuid.NewString(), coachID, code, description, expiresInDays).
		Scan(&ic.ID, &ic.Code, &ic.Description, &ic.ExpiresAt, &ic.RevokedAt, &ic.CreatedAt)
	if err != nil {
		return InviteCode{}, err
	}
	ic.Status = deriveStatus(ic.RevokedAt, ic.ExpiresAt, time.Now())
	return ic, nil
}

// ListForCoach returns the caller's own invite codes, newest first,
// including expired and revoked ones — they are the audit trail and are
// never deleted. Only a COACH may call this.
func ListForCoach(ctx context.Context, pool *pgxpool.Pool, caller authn.User) ([]InviteCode, error) {
	if caller.Role != "COACH" {
		return nil, ErrForbidden
	}

	const query = `
		SELECT id, code, description, expires_at, revoked_at, created_at
		FROM coach_invite_codes
		WHERE coach_id = $1
		ORDER BY created_at DESC`

	rows, err := pool.Query(ctx, query, caller.ID)
	if err != nil {
		return nil, fmt.Errorf("invitecode: list: %w", err)
	}
	defer rows.Close()

	now := time.Now()
	codes := make([]InviteCode, 0)
	for rows.Next() {
		var ic InviteCode
		if err := rows.Scan(&ic.ID, &ic.Code, &ic.Description, &ic.ExpiresAt, &ic.RevokedAt, &ic.CreatedAt); err != nil {
			return nil, fmt.Errorf("invitecode: list: scan: %w", err)
		}
		ic.Status = deriveStatus(ic.RevokedAt, ic.ExpiresAt, now)
		codes = append(codes, ic)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("invitecode: list: iterate: %w", err)
	}
	return codes, nil
}

// Revoke sets revoked_at if it is not already set, and returns the updated
// row. Re-revoking an already-revoked code is a no-op success, not an
// error — a double-tap must not look like a failure
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.1). Revocation is
// forward-only: it never detaches athletes who already joined using this
// code. Only a COACH may call this, and only for a code they own; an
// unknown id or another coach's id both produce ErrNotFound — one
// indistinguishable outcome, so this endpoint cannot be used to confirm
// another coach's invite exists.
func Revoke(ctx context.Context, pool *pgxpool.Pool, caller authn.User, id string) (InviteCode, error) {
	if caller.Role != "COACH" {
		return InviteCode{}, ErrForbidden
	}

	// An id that isn't even a well-formed UUID cannot belong to the
	// caller; treat it the same as "not found" rather than a separate
	// 400, matching the resource-scoping (not shape-validation) nature of
	// this check.
	if _, err := uuid.Parse(id); err != nil {
		return InviteCode{}, ErrNotFound
	}

	const query = `
		UPDATE coach_invite_codes
		SET revoked_at = COALESCE(revoked_at, now())
		WHERE id = $1 AND coach_id = $2
		RETURNING id, code, description, expires_at, revoked_at, created_at`

	var ic InviteCode
	err := pool.QueryRow(ctx, query, id, caller.ID).
		Scan(&ic.ID, &ic.Code, &ic.Description, &ic.ExpiresAt, &ic.RevokedAt, &ic.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return InviteCode{}, ErrNotFound
		}
		return InviteCode{}, fmt.Errorf("invitecode: revoke: %w", err)
	}
	ic.Status = deriveStatus(ic.RevokedAt, ic.ExpiresAt, time.Now())
	return ic, nil
}

// deriveStatus computes the read-time status. revoked_at takes precedence
// over expiry: a revoked-but-not-yet-expired code is still REVOKED, not
// ACTIVE.
func deriveStatus(revokedAt *time.Time, expiresAt time.Time, now time.Time) string {
	if revokedAt != nil {
		return StatusRevoked
	}
	if !expiresAt.After(now) {
		return StatusExpired
	}
	return StatusActive
}

// normalizeDescription trims the input and treats an empty (or
// empty-after-trim) string the same as omitted — nil, not an error — since
// the field is optional. A description over maxDescriptionLength after
// trimming is a ValidationError.
func normalizeDescription(raw *string) (*string, error) {
	if raw == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*raw)
	if trimmed == "" {
		return nil, nil
	}
	if len(trimmed) > maxDescriptionLength {
		return nil, &ValidationError{Message: fmt.Sprintf("description must be at most %d characters", maxDescriptionLength)}
	}
	return &trimmed, nil
}

// normalizeExpiresInDays applies the default when omitted and validates
// the range when provided.
func normalizeExpiresInDays(raw *int) (int, error) {
	if raw == nil {
		return defaultExpiresInDays, nil
	}
	if *raw < minExpiresInDays || *raw > maxExpiresInDays {
		return 0, &ValidationError{Message: fmt.Sprintf("expiresInDays must be between %d and %d", minExpiresInDays, maxExpiresInDays)}
	}
	return *raw, nil
}

// isUniqueViolation reports whether err is a PostgreSQL unique-violation
// (SQLSTATE 23505), the only conflict Create's INSERT can hit (the code
// column's UNIQUE constraint).
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
