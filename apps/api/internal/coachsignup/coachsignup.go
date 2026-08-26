// Package coachsignup implements self-service Coach account creation:
// POST /api/v1/coach-signup (docs/mvp-integration-latest-ui — Problem 2).
//
// This is the normal Coach registration path. It replaces "operator runs
// internal/bootstrap by hand" for everyday product use; bootstrap's
// trusted-manifest upsert remains available for emergency/operator use but
// is deliberately not reused here (see Signup's doc comment).
package coachsignup

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// maxNameLength matches the bound already used for redeem-triggered
// account creation (internal/invitecode.maxNameLength).
const maxNameLength = 80

// ValidationError indicates the request failed shape validation before any
// database access. Handlers map it to 400 INVALID_ARGUMENT.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// ErrAccountDeleted indicates the Firebase UID already maps to a
// tombstoned users row (deleted_at IS NOT NULL). Handlers map this to
// 409 ACCOUNT_DELETED — never idempotent success, never a second users row.
var ErrAccountDeleted = errors.New("coachsignup: account has been deleted")

// ErrAthleteConflict indicates the verified Firebase identity already
// resolves to an existing users row with role ATHLETE. An athlete account
// is never promoted to COACH by this endpoint — role is fixed at creation
// and never mutated on an existing row. Handlers map this to 409 CONFLICT.
var ErrAthleteConflict = errors.New("coachsignup: firebase uid is already registered as an athlete")

// User is the response shape for a successful signup, matching the shape
// GET /api/v1/me already returns.
type User struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

// Signup resolves identity's verified Firebase UID to a COACH-role
// application user, creating one if none exists yet. Identity is the sole
// source of truth for the Firebase UID: it comes only from a verified
// Firebase ID token (authn.FirebaseOnlyMiddleware), never from request
// JSON — a caller-supplied firebaseUid, role, coachId, or athleteId in the
// request body is never accepted or trusted (there is no such field on
// this endpoint's request type at all).
//
// Behavior:
//   - No users row for this Firebase UID: create one with role hard-coded
//     to COACH and the trimmed request name, and return it.
//   - An existing users row with role COACH: return it unchanged
//     (idempotent success, no duplicate row).
//   - An existing users row with role ATHLETE: return ErrAthleteConflict.
//     An athlete is never promoted to COACH automatically.
//
// Deliberately does NOT reuse bootstrap's (internal/bootstrap) trusted
// manifest upsert (ON CONFLICT ... DO UPDATE SET name = ..., role = ...):
// that pattern is safe only because bootstrap's input is a human-reviewed
// file, not an arbitrary HTTP caller. Follows the same
// INSERT ... ON CONFLICT (firebase_uid) DO NOTHING + fallback SELECT
// pattern already used by internal/invitecode.Redeem, so two concurrent
// signups for the same brand-new UID still produce exactly one users row.
func Signup(ctx context.Context, pool *pgxpool.Pool, identity authn.Identity, rawName string) (User, error) {
	trimmedName := strings.TrimSpace(rawName)

	// Wrapped in a transaction so an invalid name (checked below, after
	// the INSERT) rolls the row back rather than persisting it: name is
	// required only on the create path, and it can only be known whether
	// this call is creating a new row until after the
	// INSERT ... ON CONFLICT below runs.
	tx, err := pool.Begin(ctx)
	if err != nil {
		return User{}, fmt.Errorf("coachsignup: begin: %w", err)
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	var u User
	err = tx.QueryRow(ctx, `
		INSERT INTO users (id, firebase_uid, name, role, created_at)
		VALUES ($1, $2, $3, 'COACH', now())
		ON CONFLICT (firebase_uid) DO NOTHING
		RETURNING id, name, role`,
		uuid.NewString(), identity.UID, trimmedName,
	).Scan(&u.ID, &u.Name, &u.Role)

	switch {
	case err == nil:
		// A brand-new COACH row was created by this call. name is
		// required only on this path, validated after we know creation
		// happened (an idempotent re-signup by an existing coach may omit
		// it entirely, and must not fail on that account). The deferred
		// Rollback above discards the just-inserted row if validation
		// fails here, so an invalid name never persists.
		if trimmedName == "" {
			return User{}, &ValidationError{Message: "name is required"}
		}
		if len(trimmedName) > maxNameLength {
			return User{}, &ValidationError{Message: fmt.Sprintf("name must be at most %d characters", maxNameLength)}
		}

	case errors.Is(err, pgx.ErrNoRows):
		var deletedAt *time.Time
		// ON CONFLICT fired: a users row for this firebase_uid already
		// existed (also the path both concurrent goroutines that lose the
		// INSERT race take). Re-select it verbatim — name and role are
		// never overwritten by this endpoint.
		if err := tx.QueryRow(ctx, `SELECT id, name, role, deleted_at FROM users WHERE firebase_uid = $1`, identity.UID).
			Scan(&u.ID, &u.Name, &u.Role, &deletedAt); err != nil {
			return User{}, fmt.Errorf("coachsignup: load existing user: %w", err)
		}
		if deletedAt != nil {
			return User{}, ErrAccountDeleted
		}
		if u.Role == "ATHLETE" {
			return User{}, ErrAthleteConflict
		}
		// u.Role == "COACH": idempotent success, no duplicate row.

	default:
		return User{}, fmt.Errorf("coachsignup: create coach: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return User{}, fmt.Errorf("coachsignup: commit: %w", err)
	}
	return u, nil
}
