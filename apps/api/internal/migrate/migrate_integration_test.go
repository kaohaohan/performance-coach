package migrate_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/migrate"
)

// This is D1b's "dry/local validation path against a clean PostgreSQL
// database" (docs/deployment-architecture-v0.2.md §9): it resets
// TEST_DATABASE_URL to an empty schema and proves the full migration set
// applies cleanly, in order, before any of it is trusted against a real
// deployment target.
func TestUpAppliesCleanlyFromEmptySchema(t *testing.T) {
	pool := requireIsolatedTestDB(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset schema: %v", err)
	}

	applied, err := migrate.Up(ctx, pool, nil)
	if err != nil {
		t.Fatalf("Up() on clean database: %v", err)
	}
	if len(applied) == 0 {
		t.Fatal("Up() applied nothing against an empty schema")
	}

	var tableCount int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workouts'`).Scan(&tableCount); err != nil {
		t.Fatalf("verify migrated schema: %v", err)
	}
	if tableCount != 1 {
		t.Fatalf("workouts table missing after migration; applied = %v", applied)
	}
}

// A second Up() call against an already-migrated database must be a no-op:
// nothing pending, nothing reapplied, no error.
func TestUpIsIdempotent(t *testing.T) {
	pool := requireIsolatedTestDB(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset schema: %v", err)
	}

	if _, err := migrate.Up(ctx, pool, nil); err != nil {
		t.Fatalf("first Up(): %v", err)
	}

	second, err := migrate.Up(ctx, pool, nil)
	if err != nil {
		t.Fatalf("second Up(): %v", err)
	}
	if len(second) != 0 {
		t.Fatalf("second Up() re-applied %v, want none", second)
	}
}

// Editing an already-applied migration's on-disk content must be refused
// rather than silently reapplied (§9: "failure on changed historical
// migration content"). Load() reads the real embedded files, so this test
// simulates drift by corrupting the ledger's recorded checksum instead.
func TestUpRefusesChangedHistoricalMigration(t *testing.T) {
	pool := requireIsolatedTestDB(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset schema: %v", err)
	}

	if _, err := migrate.Up(ctx, pool, nil); err != nil {
		t.Fatalf("first Up(): %v", err)
	}

	// This test deliberately corrupts the ledger below to prove Up()
	// refuses to proceed past it. Capture the correct checksum first, so
	// cleanup can restore it rather than leaving the ledger — and
	// therefore the whole shared TEST_DATABASE_URL database — permanently
	// tampered after the test finishes. Restoring the checksum (not
	// dropping the schema) matters: `go test ./...` can run other
	// packages' integration tests concurrently against this same
	// database, and they assume an intact, already-migrated schema; they
	// do not call migrate.Up themselves, so they would be broken by a
	// missing schema just as much as by a tampered one. Registered before
	// the corrupting UPDATE, and t.Cleanup runs even if the test fails,
	// so the tampering never outlives this test either way.
	var originalChecksum string
	const version = "0001_init_schema"
	if err := pool.QueryRow(ctx, `SELECT checksum FROM schema_migrations WHERE version = $1`, version).Scan(&originalChecksum); err != nil {
		t.Fatalf("read original checksum: %v", err)
	}
	t.Cleanup(func() {
		if _, err := pool.Exec(context.Background(), `UPDATE schema_migrations SET checksum = $1 WHERE version = $2`, originalChecksum, version); err != nil {
			t.Errorf("cleanup: restore original checksum: %v", err)
		}
	})

	if _, err := pool.Exec(ctx, `UPDATE schema_migrations SET checksum = 'tampered' WHERE version = $1`, version); err != nil {
		t.Fatalf("tamper with ledger: %v", err)
	}

	if _, err := migrate.Up(ctx, pool, nil); err == nil {
		t.Fatal("Up() with a changed historical migration checksum unexpectedly succeeded")
	}
}

func requireIsolatedTestDB(t *testing.T) *pgxpool.Pool {
	t.Helper()

	testURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testURL == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	if developmentURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); developmentURL != "" {
		same, err := sameDatabaseTarget(testURL, developmentURL)
		if err != nil || same {
			t.Skip("TEST_DATABASE_URL is not confirmed to be isolated from DATABASE_URL")
		}
	}

	// This test truncates the target database's entire public schema, so
	// it additionally refuses to run unless the target name itself looks
	// like a test/throwaway database — an extra guard against ever
	// pointing TEST_DATABASE_URL at something real by mistake.
	cfg, err := pgxpool.ParseConfig(testURL)
	if err != nil {
		t.Skipf("cannot parse TEST_DATABASE_URL: %v", err)
	}
	if !strings.Contains(strings.ToLower(cfg.ConnConfig.Database), "test") {
		t.Skip("TEST_DATABASE_URL database name does not look like a test database; refusing to DROP SCHEMA")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, testURL)
	if err != nil {
		t.Skipf("cannot connect to TEST_DATABASE_URL: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

func sameDatabaseTarget(testURL, developmentURL string) (bool, error) {
	testConfig, err := pgxpool.ParseConfig(testURL)
	if err != nil {
		return false, err
	}
	developmentConfig, err := pgxpool.ParseConfig(developmentURL)
	if err != nil {
		return false, err
	}
	if testConfig.ConnConfig.Database != developmentConfig.ConnConfig.Database || testConfig.ConnConfig.Port != developmentConfig.ConnConfig.Port {
		return false, nil
	}
	return strings.EqualFold(testConfig.ConnConfig.Host, developmentConfig.ConnConfig.Host), nil
}
