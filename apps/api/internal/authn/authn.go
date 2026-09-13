// Package authn verifies Firebase ID tokens and resolves them to internal
// Performance Coach users.
//
// Flow (per docs/go-backend-api-contract-v0.1.md "Authentication"):
//
//	Bearer token -> VerifyIDToken -> Firebase UID -> lookup users by
//	firebase_uid -> attach internal User to context -> protected handler
//
// A verified Firebase token with no matching internal user is treated as
// 401 UNAUTHENTICATED, not 404: this endpoint does not distinguish "invalid
// token" from "valid token, unknown account" (no signup flow exists yet).
package authn

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	firebase "firebase.google.com/go/v4"
	fbauth "firebase.google.com/go/v4/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
)

// User is the internal application identity resolved from a verified
// Firebase ID token, matching the users table. AuthTime and
// AppleProviderUIDs come from the verified token, never from the client.
type User struct {
	ID                string
	FirebaseUID       string
	Name              string
	Role              string
	DeletedAt         *time.Time
	AuthTime          time.Time
	AppleProviderUIDs []string
}

// VerifiedToken is the subset of a verified Firebase ID token that
// application-user routes need: identity, recent-auth, and linked IdPs.
type VerifiedToken struct {
	UID               string
	AuthTime          time.Time
	AppleProviderUIDs []string
}

// TokenVerifier verifies a Firebase ID token. Satisfied by the Firebase
// Admin SDK wrapper; kept as an interface so tests can substitute a fake
// without a live Firebase project/emulator.
type TokenVerifier interface {
	VerifyIDToken(ctx context.Context, idToken string) (VerifiedToken, error)
}

// UserDeleter deletes a Firebase Auth user. Implementations must treat
// user-not-found as success so account-deletion retry is idempotent.
type UserDeleter interface {
	DeleteUser(ctx context.Context, uid string) error
}

// Verifier satisfies both TokenVerifier (used by Middleware) and
// IdentityVerifier (used by FirebaseOnlyMiddleware). NewVerifier returns
// this combined interface so a caller (cmd/api/main.go) can wire both
// middlewares from the one underlying Firebase Admin SDK client without
// an unsafe type assertion — matching
// docs/athlete-onboarding-invite-codes-v0.1.md §5.3: "firebaseVerifier ...
// implements both TokenVerifier and IdentityVerifier — same underlying
// VerifyIDToken call, two thin interfaces over it." Any existing caller
// that only needs TokenVerifier (e.g. Middleware's parameter type)
// continues to accept a Verifier value unchanged, since Verifier embeds
// TokenVerifier.
type Verifier interface {
	TokenVerifier
	IdentityVerifier
	UserDeleter
}

// NewVerifier initializes the Firebase Admin SDK auth client for the given
// project. When the FIREBASE_AUTH_EMULATOR_HOST environment variable is
// set, the SDK verifies against the local Auth Emulator instead of
// production Firebase.
func NewVerifier(ctx context.Context, projectID string) (Verifier, error) {
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID})
	if err != nil {
		return nil, err
	}

	client, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}

	return &firebaseVerifier{client: client}, nil
}

type firebaseVerifier struct {
	client *fbauth.Client
}

func (v *firebaseVerifier) VerifyIDToken(ctx context.Context, idToken string) (VerifiedToken, error) {
	token, err := v.client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return VerifiedToken{}, err
	}
	return VerifiedToken{
		UID:               token.UID,
		AuthTime:          time.Unix(token.AuthTime, 0).UTC(),
		AppleProviderUIDs: appleProviderUIDs(token.Firebase.Identities),
	}, nil
}

func (v *firebaseVerifier) DeleteUser(ctx context.Context, uid string) error {
	err := v.client.DeleteUser(ctx, uid)
	if err == nil || fbauth.IsUserNotFound(err) {
		return nil
	}
	return err
}

func appleProviderUIDs(identities map[string]any) []string {
	if identities == nil {
		return nil
	}
	raw, ok := identities["apple.com"]
	if !ok {
		return nil
	}
	var out []string
	switch ids := raw.(type) {
	case []any:
		for _, id := range ids {
			if s, ok := id.(string); ok && s != "" {
				out = append(out, s)
			}
		}
	case []string:
		for _, s := range ids {
			if s != "" {
				out = append(out, s)
			}
		}
	}
	return out
}

// Identity is the verified-but-unreconciled Firebase identity attached by
// FirebaseOnlyMiddleware. Unlike User, it carries no internal users row —
// see FirebaseOnlyMiddleware's doc comment for why that relaxation exists
// and where it is (and is not) used. Identity proves only what the
// verified token itself asserts (the Firebase UID and its email claim);
// it must never be treated as authorization on its own, and a
// caller-supplied firebaseUid/role/coachId in a request body must never
// be trusted in its place.
type Identity struct {
	UID   string
	Email string
}

// IdentityVerifier verifies a Firebase ID token and returns its claims as
// an Identity, without requiring a matching internal user. Satisfied by
// the same concrete type NewVerifier returns; kept as a separate interface
// from TokenVerifier so a caller's dependency is exactly "can verify a
// token," not "can verify a token and also look up a users row."
type IdentityVerifier interface {
	VerifyIdentity(ctx context.Context, idToken string) (Identity, error)
}

func (v *firebaseVerifier) VerifyIdentity(ctx context.Context, idToken string) (Identity, error) {
	token, err := v.client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return Identity{}, err
	}
	email, _ := token.Claims["email"].(string)
	return Identity{UID: token.UID, Email: email}, nil
}

type contextKey int

const userContextKey contextKey = iota

// UserFromContext returns the internal user attached by Middleware. ok is
// false if no user was attached (i.e. called outside a protected route).
func UserFromContext(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(userContextKey).(User)
	return u, ok
}

type identityContextKey int

const firebaseIdentityContextKey identityContextKey = iota

// IdentityFromContext returns the Identity attached by
// FirebaseOnlyMiddleware. ok is false if no Identity was attached (i.e.
// called outside a route using that middleware).
func IdentityFromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(firebaseIdentityContextKey).(Identity)
	return id, ok
}

// FirebaseOnlyMiddleware verifies the Firebase ID token on each request
// and attaches the resulting Identity to the request context. Unlike
// Middleware, it does NOT look up or require a matching internal users
// row — a newly-registered athlete redeeming an invite code is, by
// definition, in exactly that state (see
// docs/athlete-onboarding-invite-codes-v0.1.md §5.3). Missing, invalid,
// or expired tokens still result in 401 UNAUTHENTICATED, identically to
// Middleware.
//
// This is a second, narrower middleware, not a relaxation of Middleware:
// every existing route stays behind the original users-row requirement,
// completely unchanged by this function's addition. As of this phase,
// FirebaseOnlyMiddleware is not wired to any route in cmd/api/main.go —
// the redeem endpoint that will use it is a later phase.
//
// Identity's UID/Email come only from the verified token itself. A
// handler built on this middleware must never substitute a
// caller-supplied firebaseUid, role, or coachId from the request body in
// their place, and must never reuse bootstrap's trusted-manifest
// upsert semantics (apps/api/internal/bootstrap): that package's
// ON CONFLICT ... DO UPDATE is safe only because its input is a
// human-reviewed file, not an arbitrary HTTP caller.
func FirebaseOnlyMiddleware(v IdentityVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r)
			if !ok {
				writeUnauthenticated(w)
				return
			}

			identity, err := v.VerifyIdentity(r.Context(), token)
			if err != nil {
				writeUnauthenticated(w)
				return
			}

			ctx := context.WithValue(r.Context(), firebaseIdentityContextKey, identity)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Middleware verifies the Firebase ID token on each request, resolves it to
// an internal user, and attaches that user to the request context before
// calling next. Missing/invalid tokens, unknown Firebase UIDs, and
// tombstoned users (deleted_at IS NOT NULL) all result in 401
// UNAUTHENTICATED. Use TombstoneRetryMiddleware for DELETE /me.
func Middleware(verifier TokenVerifier, pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return applicationUserMiddleware(verifier, pool, false)
}

// TombstoneRetryMiddleware is the application-user middleware for
// DELETE /api/v1/me. It resolves tombstoned users while external cleanup
// is still PENDING_EXTERNAL, including the window after Firebase
// DeleteUser succeeds but before firebase_uid is rewritten. COMPLETE jobs
// no longer retain the original Firebase UID, so an old token cannot
// regain an application user. Other application-user routes must use
// Middleware, which treats tombstones as unauthenticated.
func TombstoneRetryMiddleware(verifier TokenVerifier, pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return applicationUserMiddleware(verifier, pool, true)
}

func applicationUserMiddleware(verifier TokenVerifier, pool *pgxpool.Pool, allowTombstone bool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			rawToken, ok := bearerToken(r)
			if !ok {
				writeUnauthenticated(w)
				return
			}

			verified, err := verifier.VerifyIDToken(r.Context(), rawToken)
			if err != nil {
				writeUnauthenticated(w)
				return
			}

			user, err := lookupApplicationUser(r.Context(), pool, verified.UID, allowTombstone)
			if err != nil {
				if errors.Is(err, errUserNotFound) {
					writeUnauthenticated(w)
					return
				}
				WriteInternalError(w, r, err)
				return
			}

			user.AuthTime = verified.AuthTime
			user.AppleProviderUIDs = verified.AppleProviderUIDs

			ctx := context.WithValue(r.Context(), userContextKey, user)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func bearerToken(r *http.Request) (string, bool) {
	const prefix = "Bearer "
	header := r.Header.Get("Authorization")
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	token := strings.TrimPrefix(header, prefix)
	if token == "" {
		return "", false
	}
	return token, true
}

var errUserNotFound = errors.New("authn: no internal user for firebase uid")

func lookupApplicationUser(ctx context.Context, pool *pgxpool.Pool, firebaseUID string, allowTombstone bool) (User, error) {
	user, err := scanUser(ctx, pool,
		`SELECT id, firebase_uid, name, role, deleted_at FROM users WHERE firebase_uid = $1`,
		firebaseUID,
	)
	if err == nil {
		if user.DeletedAt != nil && !allowTombstone {
			return User{}, errUserNotFound
		}
		return user, nil
	}
	if !errors.Is(err, errUserNotFound) || !allowTombstone {
		return User{}, err
	}

	// Firebase DeleteUser may succeed before the final uid rewrite. While
	// the job is still PENDING_EXTERNAL, original_firebase_uid is the
	// retry key. COMPLETE jobs scrub that column, so this lookup must not
	// restore a finished identity.
	user, err = scanUser(ctx, pool,
		`SELECT u.id, u.firebase_uid, u.name, u.role, u.deleted_at
		 FROM account_deletion_jobs j
		 JOIN users u ON u.id = j.user_id
		 WHERE j.original_firebase_uid = $1
		   AND j.status = 'PENDING_EXTERNAL'`,
		firebaseUID,
	)
	if err != nil {
		return User{}, err
	}
	if user.DeletedAt == nil {
		return User{}, errUserNotFound
	}
	return user, nil
}

func scanUser(ctx context.Context, pool *pgxpool.Pool, query string, firebaseUID string) (User, error) {
	var u User
	err := pool.QueryRow(ctx, query, firebaseUID).Scan(&u.ID, &u.FirebaseUID, &u.Name, &u.Role, &u.DeletedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return User{}, errUserNotFound
		}
		return User{}, err
	}
	return u, nil
}

// WriteInternalError logs err at ERROR severity via the request-scoped
// logger attached to r.Context() by logging.Middleware — correlated with
// the same request_id as that request's own summary log line
// (docs/deployment-architecture-v0.2.md §12) — and then writes the fixed
// 500 INTERNAL envelope. err is never included in the response: the
// client-visible message stays the generic, unchanging string the API
// contract already specifies, so the only way to see err is by locating
// the matching request_id in Cloud Logging (§13's verification line).
//
// This is the shared path every internal-error branch should use instead
// of calling WriteError(..., http.StatusInternalServerError, ...)
// directly and discarding err: before D1c-2, every such branch discarded
// the error, so a production 500 produced no log output at all.
func WriteInternalError(w http.ResponseWriter, r *http.Request, err error) {
	logging.FromContext(r.Context()).Error("internal error", "error", err.Error())
	WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
}

// WriteError writes the API contract's unified error envelope:
// {"error": {"code": "...", "message": "..."}}.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error": map[string]string{
			"code":    code,
			"message": message,
		},
	})
}

func writeUnauthenticated(w http.ResponseWriter) {
	WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
}
