package authn_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
)

// decodeLines parses one JSON object per stdout line, matching
// internal/logging's format (docs/deployment-architecture-v0.2.md §12).
func decodeLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if raw == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatalf("log line is not valid JSON: %v\nline: %s", err, raw)
		}
		lines = append(lines, m)
	}
	return lines
}

// This is the core of D1c-2: before it, every internal-error branch called
// WriteError(..., 500, "INTERNAL", "internal error") directly and
// discarded the real error, so a production 500 produced zero log output.
// WriteInternalError must log the real error, correlated by request_id
// with the request's own summary log line, while leaving the client-facing
// JSON envelope exactly as the API contract already specifies.
func TestWriteInternalErrorLogsCorrelatedWithRequestIDAndPreservesEnvelope(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	underlying := errors.New("pool.QueryRow: connection reset by peer")
	handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authn.WriteInternalError(w, r, underlying)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/athletes", nil))

	requestID := rec.Header().Get("X-Request-Id")
	if requestID == "" {
		t.Fatal("X-Request-Id response header was not set")
	}

	// The JSON error envelope is a fixed API contract
	// (docs/go-backend-api-contract-v0.1.md): the underlying error must
	// never appear in the response body.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	wantBody := map[string]any{"error": map[string]any{"code": "INTERNAL", "message": "internal error"}}
	gotJSON, _ := json.Marshal(body)
	wantJSON, _ := json.Marshal(wantBody)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("response body = %s, want %s (envelope must not change)", gotJSON, wantJSON)
	}
	if strings.Contains(rec.Body.String(), underlying.Error()) {
		t.Fatal("response body leaked the internal error text")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}

	// Exactly one line should carry the underlying error (from
	// WriteInternalError itself); logging.Middleware also emits its own
	// per-request summary line for the same request. Both must carry the
	// same request_id as the X-Request-Id response header, which is what
	// makes "locate this exact request in Cloud Logging" (§13's verification line).
	lines := decodeLines(t, &buf)
	var errorLine map[string]any
	for _, line := range lines {
		if line["message"] == "internal error" {
			errorLine = line
		}
		if line["request_id"] != requestID {
			t.Errorf("log line request_id = %v, want %q (must match X-Request-Id): %v", line["request_id"], requestID, line)
		}
	}
	if errorLine == nil {
		t.Fatalf("no log line with message \"internal error\" found: %v", lines)
	}
	if errorLine["severity"] != "ERROR" {
		t.Errorf("internal error log severity = %v, want ERROR", errorLine["severity"])
	}
	if errorLine["error"] != underlying.Error() {
		t.Errorf("internal error log error field = %v, want %q", errorLine["error"], underlying.Error())
	}
}

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

func (f fakeTokenVerifier) VerifyIDToken(ctx context.Context, idToken string) (authn.VerifiedToken, error) {
	return authn.VerifiedToken{UID: f.uid, AuthTime: time.Now().UTC()}, f.err
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
