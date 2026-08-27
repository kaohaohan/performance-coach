package migrate_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/migrate"
	"github.com/kaohaohan/performance-coach/apps/api/migrations"
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

func TestAccountDeletionMigration0004RoundTrip(t *testing.T) {
	pool := requireIsolatedTestDB(t)
	ctx := context.Background()

	if _, err := pool.Exec(ctx, `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`); err != nil {
		t.Fatalf("reset schema: %v", err)
	}

	applied, err := migrate.Up(ctx, pool, nil)
	if err != nil {
		t.Fatalf("Up() on clean database: %v", err)
	}
	if !containsVersion(applied, "0004_account_deletion") {
		t.Fatalf("Up() did not apply 0004_account_deletion; applied = %v", applied)
	}

	assertAccountDeletionSchema(t, ctx, pool, true)
	assertNoUserFKCascade(t, ctx, pool)

	downSQL, err := migrations.FS.ReadFile("0004_account_deletion.down.sql")
	if err != nil {
		t.Fatalf("read 0004 down: %v", err)
	}
	if _, err := pool.Exec(ctx, string(downSQL), pgx.QueryExecModeSimpleProtocol); err != nil {
		t.Fatalf("apply 0004 down: %v", err)
	}
	assertAccountDeletionSchema(t, ctx, pool, false)

	var leftover int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'workouts', 'coach_invite_codes')`).Scan(&leftover); err != nil {
		t.Fatalf("count remaining tables: %v", err)
	}
	if leftover != 3 {
		t.Fatalf("0004 down removed unrelated tables; found %d of users/workouts/coach_invite_codes", leftover)
	}

	if _, err := pool.Exec(ctx, `DELETE FROM schema_migrations WHERE version = '0004_account_deletion'`); err != nil {
		t.Fatalf("remove 0004 ledger row: %v", err)
	}

	reapplied, err := migrate.Up(ctx, pool, nil)
	if err != nil {
		t.Fatalf("Up() after 0004 down: %v", err)
	}
	if len(reapplied) != 1 || reapplied[0] != "0004_account_deletion" {
		t.Fatalf("Up() after down re-applied %v, want only 0004_account_deletion", reapplied)
	}
	assertAccountDeletionSchema(t, ctx, pool, true)
	assertNoUserFKCascade(t, ctx, pool)
	assertStatusConstraint(t, ctx, pool)
}

func containsVersion(applied []string, version string) bool {
	for _, v := range applied {
		if v == version {
			return true
		}
	}
	return false
}

func assertAccountDeletionSchema(t *testing.T, ctx context.Context, pool *pgxpool.Pool, present bool) {
	t.Helper()

	var deletedAtCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'users'
		  AND column_name = 'deleted_at'`).Scan(&deletedAtCount); err != nil {
		t.Fatalf("query users.deleted_at: %v", err)
	}

	var jobTableCount int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM information_schema.tables
		WHERE table_schema = 'public'
		  AND table_name = 'account_deletion_jobs'`).Scan(&jobTableCount); err != nil {
		t.Fatalf("query account_deletion_jobs: %v", err)
	}

	want := 0
	if present {
		want = 1
	}
	if deletedAtCount != want {
		t.Fatalf("users.deleted_at present=%d, want %d", deletedAtCount, want)
	}
	if jobTableCount != want {
		t.Fatalf("account_deletion_jobs present=%d, want %d", jobTableCount, want)
	}
	if !present {
		return
	}

	var nullable, dataType string
	if err := pool.QueryRow(ctx, `
		SELECT is_nullable, data_type
		FROM information_schema.columns
		WHERE table_schema = 'public'
		  AND table_name = 'users'
		  AND column_name = 'deleted_at'`).Scan(&nullable, &dataType); err != nil {
		t.Fatalf("describe users.deleted_at: %v", err)
	}
	if nullable != "YES" || dataType != "timestamp with time zone" {
		t.Fatalf("users.deleted_at = nullable %s type %s, want YES timestamptz", nullable, dataType)
	}

	var statusCheck int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM pg_constraint
		WHERE conrelid = 'account_deletion_jobs'::regclass
		  AND conname = 'account_deletion_jobs_status_check'`).Scan(&statusCheck); err != nil {
		t.Fatalf("query status check: %v", err)
	}
	if statusCheck != 1 {
		t.Fatal("account_deletion_jobs_status_check missing")
	}

	var confdeltype string
	if err := pool.QueryRow(ctx, `
		SELECT confdeltype::text
		FROM pg_constraint
		WHERE conrelid = 'account_deletion_jobs'::regclass
		  AND contype = 'f'
		  AND confrelid = 'users'::regclass`).Scan(&confdeltype); err != nil {
		t.Fatalf("query job FK delete action: %v", err)
	}
	if confdeltype != "a" && confdeltype != "r" {
		t.Fatalf("account_deletion_jobs.user_id confdeltype=%s, want a (NO ACTION) or r (RESTRICT)", confdeltype)
	}
}

func assertNoUserFKCascade(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()
	var cascades int
	if err := pool.QueryRow(ctx, `
		SELECT count(*)
		FROM pg_constraint
		WHERE contype = 'f'
		  AND confrelid = 'users'::regclass
		  AND confdeltype = 'c'`).Scan(&cascades); err != nil {
		t.Fatalf("query user FK cascades: %v", err)
	}
	if cascades != 0 {
		t.Fatalf("found %d ON DELETE CASCADE FK(s) referencing users", cascades)
	}
}

func assertStatusConstraint(t *testing.T, ctx context.Context, pool *pgxpool.Pool) {
	t.Helper()

	var userID string
	if err := pool.QueryRow(ctx, `
		INSERT INTO users (id, firebase_uid, name, role, created_at)
		VALUES (gen_random_uuid(), 'migrate-0004-status-check', 'Constraint Probe', 'COACH', now())
		RETURNING id`).Scan(&userID); err != nil {
		t.Fatalf("insert probe user: %v", err)
	}
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM account_deletion_jobs WHERE user_id = $1`, userID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})

	_, err := pool.Exec(ctx, `
		INSERT INTO account_deletion_jobs (
			user_id, original_firebase_uid, status, created_at, updated_at
		) VALUES ($1, 'firebase-uid', 'INVALID', now(), now())`, userID)
	if err == nil {
		t.Fatal("invalid job status was accepted")
	}

	if _, err := pool.Exec(ctx, `
		INSERT INTO account_deletion_jobs (
			user_id, original_firebase_uid, status, created_at, updated_at
		) VALUES ($1, 'firebase-uid', 'PENDING_EXTERNAL', now(), now())`, userID); err != nil {
		t.Fatalf("valid PENDING_EXTERNAL insert: %v", err)
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
