package db

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestAssertSafeSSLMode(t *testing.T) {
	cases := []struct {
		name    string
		dsn     string
		wantErr bool
	}{
		{
			name: "loopback with sslmode disable is safe",
			dsn:  "postgres://performance:performance@localhost:5433/performance_coach?sslmode=disable",
		},
		{
			name: "loopback IP with sslmode disable is safe",
			dsn:  "postgres://performance:performance@127.0.0.1:5433/performance_coach?sslmode=disable",
		},
		{
			name: "cloud sql socket with sslmode disable is safe",
			dsn:  "postgres://appuser:secret@/performance_coach?host=/cloudsql/proj:asia-east1:pilot&sslmode=disable",
		},
		{
			name:    "public host with sslmode disable is refused",
			dsn:     "postgres://appuser:secret@db.example.com:5432/performance_coach?sslmode=disable",
			wantErr: true,
		},
		{
			name: "public host without sslmode is unaffected",
			dsn:  "postgres://appuser:secret@db.example.com:5432/performance_coach",
		},
		{
			name: "public host with sslmode require is unaffected",
			dsn:  "postgres://appuser:secret@db.example.com:5432/performance_coach?sslmode=require",
		},
		{
			name:    "unparsable DSN is refused",
			dsn:     "://not a url",
			wantErr: true,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := AssertSafeSSLMode(tc.dsn)
			if tc.wantErr && err == nil {
				t.Fatalf("AssertSafeSSLMode(%q) = nil, want error", tc.dsn)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("AssertSafeSSLMode(%q) = %v, want nil", tc.dsn, err)
			}
		})
	}
}

// A DSN that fails net/url.Parse must never leak its content: net/url's own
// parse error embeds the full input string, password included. This is the
// scenario that produced a real credential leak before D1c-2 (a malformed
// production DSN would print its password to stdout via log.Fatal).
func TestAssertSafeSSLModeDoesNotLeakCredentialsOnUnparsableDSN(t *testing.T) {
	const password = "SUPER_SECRET_PASSWORD"
	// A raw space in the host is what net/url rejects; this is exactly the
	// class of "malformed production DSN" §7 is concerned about, not a
	// contrived input.
	dsn := "postgres://appuser:" + password + "@bad host:5432/db?sslmode=disable"

	err := AssertSafeSSLMode(dsn)
	if err == nil {
		t.Fatal("AssertSafeSSLMode(malformed DSN) = nil, want error")
	}
	if !errors.Is(err, ErrUnparsableDSN) {
		t.Errorf("error = %v, want errors.Is(err, ErrUnparsableDSN)", err)
	}
	if strings.Contains(err.Error(), password) {
		t.Fatalf("error text leaked the password: %v", err)
	}
	if strings.Contains(err.Error(), dsn) {
		t.Fatalf("error text leaked the full DSN: %v", err)
	}
}

// db.NewPool's second parse (pgxpool.ParseConfig, for pool configuration)
// is a separate code path from AssertSafeSSLMode and must be independently
// verified: a DSN that passes net/url.Parse (so AssertSafeSSLMode lets it
// through) can still fail pgxpool.ParseConfig's own validation. This case —
// a syntactically valid postgres:// URL with an invalid sslmode value —
// happens to be one pgx itself redacts before failing. NewPool does not
// rely on that: it never propagates a pgxpool.ParseConfig error's text at
// all (ErrInvalidDatabaseConfig), which is what actually makes this safe
// regardless of pgx's own redaction behavior in any given failure mode —
// see the next test for a failure mode where pgx does not redact.
func TestNewPoolParseConfigErrorDoesNotLeakPassword(t *testing.T) {
	const password = "SUPER_SECRET_PASSWORD"
	dsn := "postgres://appuser:" + password + "@localhost:5432/db?sslmode=bogus-mode"

	_, err := NewPool(context.Background(), dsn, 1)
	if err == nil {
		t.Fatal("NewPool(invalid sslmode) = nil, want error")
	}
	if !errors.Is(err, ErrInvalidDatabaseConfig) {
		t.Errorf("error = %v, want errors.Is(err, ErrInvalidDatabaseConfig)", err)
	}
	if strings.Contains(err.Error(), password) {
		t.Fatalf("error text leaked the password: %v", err)
	}
}

// Discovered during D1c-3 manual verification: a string that is not a
// valid postgres DSN at all (no recognized scheme) still passes
// net/url.Parse — url.Parse is lenient enough to accept it as a bare
// relative path — so AssertSafeSSLMode lets it through. pgxpool.ParseConfig
// then falls back to its libpq keyword/value parser, fails to tokenize the
// string, and — confirmed empirically — embeds the raw input verbatim in
// its error, credentials included, with no redaction at all. This is the
// failure mode TestNewPoolParseConfigErrorDoesNotLeakPassword's pgx-level
// redaction does not cover, and the reason NewPool must not propagate
// pgxpool.ParseConfig's error text under any circumstance.
func TestNewPoolRejectsUnparsablePoolConfigWithoutLeaking(t *testing.T) {
	const password = "PASSWORD123"
	dsn := "not-a-valid-postgres-dsn with a secret " + password

	_, err := NewPool(context.Background(), dsn, 1)
	if err == nil {
		t.Fatal("NewPool(garbage DSN) = nil, want error")
	}
	if !errors.Is(err, ErrInvalidDatabaseConfig) {
		t.Errorf("error = %v, want errors.Is(err, ErrInvalidDatabaseConfig)", err)
	}
	if strings.Contains(err.Error(), password) {
		t.Fatalf("error text leaked the password: %v", err)
	}
	if strings.Contains(err.Error(), dsn) {
		t.Fatalf("error text leaked the full DSN: %v", err)
	}
}
