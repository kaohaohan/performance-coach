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

// maxNameLength bounds the display name accepted on redeem-triggered
// account creation (docs/athlete-onboarding-invite-codes-v0.1.md §5.3:
// "Required, trimmed, 1-80 chars, only when creation happens").
const maxNameLength = 80

// Preview is the public response shape for
// GET /invite-codes/{code}/preview. It deliberately carries no ids — no
// coachId, no invite id — only display strings
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.2).
type Preview struct {
	Code        string  `json:"code"`
	CoachName   string  `json:"coachName"`
	Description *string `json:"description"`
}

// PreviewInviteCode returns the public preview for a code: whether it
// exists and is currently ACTIVE, plus the owning coach's display name and
// the invite's description. Unauthenticated — no caller argument. Unknown,
// malformed, expired, and revoked codes all produce the identical
// ErrNotFound, so this endpoint cannot be used to confirm a code once
// existed.
func PreviewInviteCode(ctx context.Context, pool *pgxpool.Pool, rawCode string) (Preview, error) {
	code, err := Normalize(rawCode)
	if err != nil {
		return Preview{}, ErrNotFound
	}

	const query = `
		SELECT ic.code, ic.description, ic.revoked_at, ic.expires_at, u.name
		FROM coach_invite_codes ic
		JOIN users u ON u.id = ic.coach_id
		WHERE ic.code = $1 AND u.deleted_at IS NULL`

	var (
		p         Preview
		revokedAt *time.Time
		expiresAt time.Time
	)
	err = pool.QueryRow(ctx, query, code).Scan(&p.Code, &p.Description, &revokedAt, &expiresAt, &p.CoachName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Preview{}, ErrNotFound
		}
		return Preview{}, fmt.Errorf("invitecode: preview: %w", err)
	}

	if deriveStatus(revokedAt, expiresAt, time.Now()) != StatusActive {
		return Preview{}, ErrNotFound
	}
	return p, nil
}

// RedeemInput is the validated-shape request for Redeem. Name is required
// only when a brand-new users row is created by this call; it is never
// used to overwrite an existing row's name.
type RedeemInput struct {
	Name string
}

// RedeemedUser and RedeemedCoach are the nested response shapes for
// POST /invite-codes/{code}/redeem
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.3).
type RedeemedUser struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type RedeemedCoach struct {
	Name string `json:"name"`
}

// Redeemed is the full response shape for a successful redeem.
type Redeemed struct {
	User  RedeemedUser  `json:"user"`
	Coach RedeemedCoach `json:"coach"`
}

// ErrCoachCannotRedeem indicates the verified Firebase identity resolves
// to an existing COACH-role users row. A coach account can never redeem
// an invite code — role is never silently changed or dual-purposed, and a
// coach's own application user is COACH-role by construction, so this
// also covers a coach attempting to redeem their own code.
var ErrCoachCannotRedeem = errors.New("invitecode: a coach account cannot redeem an invite code")

// ErrAccountDeleted indicates the Firebase UID already maps to a
// tombstoned users row. Handlers map this to 409 ACCOUNT_DELETED.
var ErrAccountDeleted = errors.New("invitecode: account has been deleted")

// Redeem resolves identity's verified Firebase UID to an application user
// — creating one with role ATHLETE if none exists yet — and connects that
// user to the invite's owning coach. Identity is the caller's sole source
// of truth: it comes only from a verified Firebase ID token
// (authn.FirebaseOnlyMiddleware), never from request JSON. Role is always
// hard-coded ATHLETE on creation; it is never accepted as input and never
// mutated on an existing row.
//
// The whole operation is one transaction (docs/athlete-onboarding-invite-codes-v0.1.md
// §6): load the ACTIVE invite, reconcile the users row, link
// coach_athletes, commit. Every step is safe under concurrency: the invite
// lookup is a plain read (no lock needed — revocation is forward-only, so
// either outcome of a race with a concurrent revoke is correct); the user
// row uses INSERT ... ON CONFLICT (firebase_uid) DO NOTHING with a
// fallback SELECT, so two concurrent redeems for the same brand-new UID
// still produce exactly one users row; and coach_athletes uses
// INSERT ... ON CONFLICT DO NOTHING, making repeat redemption — same
// athlete, same coach, whether from a retried request or an intentional
// second visit — a idempotent no-op success rather than an error.
//
// Deliberately does NOT reuse bootstrap's (internal/bootstrap) trusted
// manifest upsert (ON CONFLICT ... DO UPDATE SET name = ..., role = ...):
// that pattern is safe only because bootstrap's input is a human-reviewed
// file, not an arbitrary HTTP caller. An existing row's name and role are
// always read back verbatim here and never overwritten.
func Redeem(ctx context.Context, pool *pgxpool.Pool, identity authn.Identity, rawCode string, input RedeemInput) (Redeemed, error) {
	code, err := Normalize(rawCode)
	if err != nil {
		return Redeemed{}, ErrNotFound
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Redeemed{}, fmt.Errorf("invitecode: redeem: begin: %w", err)
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	coachID, coachName, err := loadActiveInviteForUpdate(ctx, tx, code)
	if err != nil {
		return Redeemed{}, err
	}

	user, err := reconcileAthlete(ctx, tx, identity, input.Name)
	if err != nil {
		return Redeemed{}, err
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
		coachID, user.ID,
	); err != nil {
		return Redeemed{}, fmt.Errorf("invitecode: redeem: link coach and athlete: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return Redeemed{}, fmt.Errorf("invitecode: redeem: commit: %w", err)
	}

	return Redeemed{
		User:  RedeemedUser{ID: user.ID, Name: user.Name, Role: user.Role},
		Coach: RedeemedCoach{Name: coachName},
	}, nil
}

// loadActiveInviteForUpdate reads the invite's coach_id and the coach's
// display name inside the redeem transaction, returning ErrNotFound for
// missing, expired, or revoked codes — identical to PreviewInviteCode's
// notion of ACTIVE, checked again here (rather than trusted from an
// earlier PreviewInviteCode call) because time has necessarily passed and
// the code could have been revoked or expired in between.
func loadActiveInviteForUpdate(ctx context.Context, tx pgx.Tx, code string) (coachID, coachName string, err error) {
	const query = `
		SELECT ic.coach_id, ic.revoked_at, ic.expires_at, u.name
		FROM coach_invite_codes ic
		JOIN users u ON u.id = ic.coach_id
		WHERE ic.code = $1 AND u.deleted_at IS NULL`

	var (
		revokedAt *time.Time
		expiresAt time.Time
	)
	err = tx.QueryRow(ctx, query, code).Scan(&coachID, &revokedAt, &expiresAt, &coachName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", ErrNotFound
		}
		return "", "", fmt.Errorf("invitecode: redeem: load invite: %w", err)
	}
	if deriveStatus(revokedAt, expiresAt, time.Now()) != StatusActive {
		return "", "", ErrNotFound
	}
	return coachID, coachName, nil
}

// reconciledUser is the minimal users-row shape Redeem needs back.
type reconciledUser struct {
	ID, Name, Role string
}

// reconcileAthlete resolves identity.UID to a users row inside tx,
// creating a new ATHLETE row if none exists yet (the normal case for a
// brand-new athlete). It follows the exact optimistic-insert pattern
// already used elsewhere in this codebase (e.g.
// exercise.insertPrivate/FindOrCreateVisible): attempt the INSERT first,
// and only fall back to a SELECT if ON CONFLICT reports someone else
// already holds this firebase_uid — safe under concurrent redeems of the
// same brand-new identity because firebase_uid is UNIQUE (0001 schema).
func reconcileAthlete(ctx context.Context, tx pgx.Tx, identity authn.Identity, rawName string) (reconciledUser, error) {
	trimmedName := strings.TrimSpace(rawName)

	var u reconciledUser
	err := tx.QueryRow(ctx, `
		INSERT INTO users (id, firebase_uid, name, role, created_at)
		VALUES ($1, $2, $3, 'ATHLETE', now())
		ON CONFLICT (firebase_uid) DO NOTHING
		RETURNING id, name, role`,
		uuid.NewString(), identity.UID, trimmedName,
	).Scan(&u.ID, &u.Name, &u.Role)

	switch {
	case err == nil:
		// A brand-new ATHLETE row was created by this call. name is
		// required only on this path — validated now, after we know
		// creation happened, rather than unconditionally up front (an
		// existing user redeeming again may omit it entirely). The
		// surrounding transaction rolls back on error, so an invalid name
		// never persists even though the INSERT already ran.
		if trimmedName == "" {
			return reconciledUser{}, &ValidationError{Message: "name is required"}
		}
		if len(trimmedName) > maxNameLength {
			return reconciledUser{}, &ValidationError{Message: fmt.Sprintf("name must be at most %d characters", maxNameLength)}
		}
		return u, nil

	case errors.Is(err, pgx.ErrNoRows):
		var deletedAt *time.Time
		// ON CONFLICT fired: a users row for this firebase_uid already
		// existed (this is also the path both concurrent goroutines that
		// lose the INSERT race take). Re-select it verbatim — name and
		// role are never overwritten by this or any HTTP-facing caller;
		// see Redeem's doc comment on why that must never become
		// bootstrap's DO UPDATE pattern.
		if err := tx.QueryRow(ctx, `SELECT id, name, role, deleted_at FROM users WHERE firebase_uid = $1`, identity.UID).
			Scan(&u.ID, &u.Name, &u.Role, &deletedAt); err != nil {
			return reconciledUser{}, fmt.Errorf("invitecode: redeem: load existing user: %w", err)
		}
		if deletedAt != nil {
			return reconciledUser{}, ErrAccountDeleted
		}
		if u.Role == "COACH" {
			return reconciledUser{}, ErrCoachCannotRedeem
		}
		return u, nil

	default:
		return reconciledUser{}, fmt.Errorf("invitecode: redeem: create athlete: %w", err)
	}
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
