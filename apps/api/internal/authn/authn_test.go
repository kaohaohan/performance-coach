package authn_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// fakeIdentityVerifier lets these tests exercise FirebaseOnlyMiddleware
// without a live Firebase project or the Auth Emulator.
type fakeIdentityVerifier struct {
	identity authn.Identity
	err      error
}

func (f fakeIdentityVerifier) VerifyIdentity(ctx context.Context, idToken string) (authn.Identity, error) {
	return f.identity, f.err
}

// fakeTokenVerifier is the TokenVerifier-only counterpart, used to prove
// Middleware's pre-database behavior (missing/invalid token) is unchanged
// by this phase's addition — those branches return before touching the
// database, so they can be exercised with a nil pool.
type fakeTokenVerifier struct {
	uid string
	err error
}

func (f fakeTokenVerifier) VerifyIDToken(ctx context.Context, idToken string) (string, error) {
	return f.uid, f.err
}

func TestFirebaseOnlyMiddlewareRejectsMissingAuthorizationHeader(t *testing.T) {
	called := false
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { called = true })
	handler := authn.FirebaseOnlyMiddleware(fakeIdentityVerifier{})(next)

	req := httptest.NewRequest(http.MethodPost, "/api/v1/invite-codes/ABCDEFGHJK/redeem", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
	if called {
		t.Fatal("next handler must not be called when the Authorization header is missing")
	}
}

func TestFirebaseOnlyMiddlewareRejectsMalformedAuthorizationHeader(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler must not be called for a malformed header")
	})
	handler := authn.FirebaseOnlyMiddleware(fakeIdentityVerifier{})(next)

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Authorization", "Basic not-a-bearer-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestFirebaseOnlyMiddlewareRejectsVerifierError(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("next handler must not be called when token verification fails")
	})
	handler := authn.FirebaseOnlyMiddleware(fakeIdentityVerifier{err: errors.New("invalid token")})(next)

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Authorization", "Bearer expired-or-invalid")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

// TestFirebaseOnlyMiddlewareAttachesIdentityWithNoUsersRowRequired is the
// core behavior this phase adds: a verified Firebase caller reaches the
// handler even though no internal users row exists or was looked up — no
// database is touched anywhere in this test.
func TestFirebaseOnlyMiddlewareAttachesIdentityWithNoUsersRowRequired(t *testing.T) {
	want := authn.Identity{UID: "firebase-uid-123", Email: "kevin@example.com"}

	var gotIdentity authn.Identity
	var gotOK bool
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotIdentity, gotOK = authn.IdentityFromContext(r.Context())
		w.WriteHeader(http.StatusOK)
	})
	handler := authn.FirebaseOnlyMiddleware(fakeIdentityVerifier{identity: want})(next)

	req := httptest.NewRequest(http.MethodPost, "/", nil)
	req.Header.Set("Authorization", "Bearer valid-token")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !gotOK {
		t.Fatal("IdentityFromContext ok = false, want true")
	}
	if gotIdentity != want {
		t.Fatalf("identity = %#v, want %#v", gotIdentity, want)
	}
}

func TestIdentityFromContextReturnsFalseOutsideMiddleware(t *testing.T) {
	if _, ok := authn.IdentityFromContext(context.Background()); ok {
		t.Fatal("IdentityFromContext ok = true on a bare context, want false")
	}
}

// TestMiddlewareUnauthenticatedBehaviorUnchanged is a regression check:
// FirebaseOnlyMiddleware is an addition alongside Middleware, not a
// modification to it. Middleware's missing-header and
// invalid/rejected-token branches both return before any database access,
// so they can be exercised here with a nil pool to prove those paths
// behave exactly as they did before this phase (401 UNAUTHENTICATED,
// next handler never called) without needing a live database.
func TestMiddlewareUnauthenticatedBehaviorUnchanged(t *testing.T) {
	cases := []struct {
		name    string
		header  string
		verify  fakeTokenVerifier
		useAuth bool
	}{
		{name: "missing header", useAuth: false},
		{name: "rejected token", header: "Bearer whatever", verify: fakeTokenVerifier{err: errors.New("invalid")}, useAuth: true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Fatal("next handler must not be called")
			})
			handler := authn.Middleware(c.verify, nil)(next)

			req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
			if c.useAuth {
				req.Header.Set("Authorization", c.header)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
			}
		})
	}
}
