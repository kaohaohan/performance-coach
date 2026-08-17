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

	firebase "firebase.google.com/go/v4"
	fbauth "firebase.google.com/go/v4/auth"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
)

// User is the internal application identity resolved from a verified
// Firebase ID token, matching the users table.
type User struct {
	ID          string
	FirebaseUID string
	Name        string
	Role        string
}

// TokenVerifier verifies a Firebase ID token and returns the Firebase UID.
// Satisfied by the Firebase Admin SDK's *auth.Client; kept as an interface
// so tests can substitute a fake without a live Firebase project/emulator.
type TokenVerifier interface {
	VerifyIDToken(ctx context.Context, idToken string) (uid string, err error)
}

// NewVerifier initializes the Firebase Admin SDK auth client for the given
// project. When the FIREBASE_AUTH_EMULATOR_HOST environment variable is
// set, the SDK verifies against the local Auth Emulator instead of
// production Firebase.
func NewVerifier(ctx context.Context, projectID string) (TokenVerifier, error) {
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

func (v *firebaseVerifier) VerifyIDToken(ctx context.Context, idToken string) (string, error) {
	token, err := v.client.VerifyIDToken(ctx, idToken)
	if err != nil {
		return "", err
	}
	return token.UID, nil
}

type contextKey int

const userContextKey contextKey = iota

// UserFromContext returns the internal user attached by Middleware. ok is
// false if no user was attached (i.e. called outside a protected route).
func UserFromContext(ctx context.Context) (User, bool) {
	u, ok := ctx.Value(userContextKey).(User)
	return u, ok
}

// Middleware verifies the Firebase ID token on each request, resolves it to
// an internal user, and attaches that user to the request context before
// calling next. Missing/invalid tokens and unknown Firebase UIDs both
// result in 401 UNAUTHENTICATED, per the API contract.
func Middleware(verifier TokenVerifier, pool *pgxpool.Pool) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r)
			if !ok {
				writeUnauthenticated(w)
				return
			}

			uid, err := verifier.VerifyIDToken(r.Context(), token)
			if err != nil {
				writeUnauthenticated(w)
				return
			}

			user, err := lookupByFirebaseUID(r.Context(), pool, uid)
			if err != nil {
				if errors.Is(err, errUserNotFound) {
					writeUnauthenticated(w)
					return
				}
				WriteInternalError(w, r, err)
				return
			}

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

// lookupByFirebaseUID resolves a Firebase UID to the internal user row.
func lookupByFirebaseUID(ctx context.Context, pool *pgxpool.Pool, firebaseUID string) (User, error) {
	const query = `SELECT id, firebase_uid, name, role FROM users WHERE firebase_uid = $1`

	var u User
	err := pool.QueryRow(ctx, query, firebaseUID).Scan(&u.ID, &u.FirebaseUID, &u.Name, &u.Role)
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
