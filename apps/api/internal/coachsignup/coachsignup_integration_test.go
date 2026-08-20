package coachsignup_test

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/coachsignup"
)

var (
	testPool   *pgxpool.Pool
	skipReason string
	testPrefix = "coachsignup-integration-" + uuid.NewString()
)

func TestMain(m *testing.M) {
	testURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testURL == "" {
		skipReason = "TEST_DATABASE_URL is not set"
		os.Exit(m.Run())
	}

	if developmentURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); developmentURL != "" {
		same, err := sameDatabaseTarget(testURL, developmentURL)
		if err != nil || same {
			skipReason = "TEST_DATABASE_URL is not confirmed to be isolated from DATABASE_URL"
			os.Exit(m.Run())
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, testURL)
	if err != nil {
		skipReason = "cannot connect to TEST_DATABASE_URL"
		os.Exit(m.Run())
	}
	testPool = pool
	code := m.Run()
	cleanupTestRows(context.Background())
	pool.Close()
	os.Exit(code)
}

// TestSignupCreatesCoach is the core new-account path: a Firebase UID with
// no users row yet gets one created with role hard-coded to COACH and the
// trimmed request name, regardless of what a malicious/buggy client might
// otherwise try to smuggle in (there is no field for firebaseUid, role,
// coachId, or athleteId on the request type at all).
func TestSignupCreatesCoach(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	identity := authn.Identity{UID: testPrefix + "-uid-" + uuid.NewString(), Email: "new-coach@example.com"}

	created, err := coachsignup.Signup(ctx, testPool, identity, "  Coach Kevin  ")
	if err != nil {
		t.Fatal(err)
	}
	if created.Role != "COACH" {
		t.Fatalf("role = %q, want COACH", created.Role)
	}
	if created.Name != "Coach Kevin" {
		t.Fatalf("name = %q, want trimmed %q", created.Name, "Coach Kevin")
	}
	if created.ID == "" {
		t.Fatal("id was not set")
	}

	var storedRole, storedName string
	if err := testPool.QueryRow(ctx, `SELECT role, name FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&storedRole, &storedName); err != nil {
		t.Fatalf("load created row: %v", err)
	}
	if storedRole != "COACH" {
		t.Fatalf("stored role = %q, want COACH", storedRole)
	}
	if storedName != "Coach Kevin" {
		t.Fatalf("stored name = %q, want %q", storedName, "Coach Kevin")
	}
}

// TestSignupIsIdempotentForExistingCoach proves a repeat signup call for an
// already-COACH Firebase UID succeeds without creating a duplicate row and
// without overwriting the existing name.
func TestSignupIsIdempotentForExistingCoach(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	identity := authn.Identity{UID: testPrefix + "-uid-" + uuid.NewString()}

	first, err := coachsignup.Signup(ctx, testPool, identity, "Original Name")
	if err != nil {
		t.Fatal(err)
	}

	second, err := coachsignup.Signup(ctx, testPool, identity, "Different Name")
	if err != nil {
		t.Fatalf("repeat signup should succeed idempotently, got: %v", err)
	}
	if second.ID != first.ID {
		t.Fatalf("repeat signup created a different row: first=%q second=%q", first.ID, second.ID)
	}
	if second.Name != "Original Name" {
		t.Fatalf("repeat signup overwrote name: got %q, want unchanged %q", second.Name, "Original Name")
	}
	if second.Role != "COACH" {
		t.Fatalf("role = %q, want COACH", second.Role)
	}

	var count int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("users row count for firebase_uid = %d, want exactly 1 (no duplicate)", count)
	}
}

// TestSignupRejectsExistingAthlete is the hard boundary this endpoint must
// never cross: an athlete account is never promoted to COACH automatically.
func TestSignupRejectsExistingAthlete(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	athlete := createUser(t, "ATHLETE")
	identity := authn.Identity{UID: athlete.FirebaseUID}

	_, err := coachsignup.Signup(ctx, testPool, identity, "Trying To Become Coach")
	if !errors.Is(err, coachsignup.ErrAthleteConflict) {
		t.Fatalf("error = %v, want ErrAthleteConflict", err)
	}

	var storedRole string
	if err := testPool.QueryRow(ctx, `SELECT role FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&storedRole); err != nil {
		t.Fatal(err)
	}
	if storedRole != "ATHLETE" {
		t.Fatalf("stored role = %q, want unchanged ATHLETE (must never be promoted)", storedRole)
	}
}

func TestSignupValidatesNameOnCreate(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()

	cases := []struct {
		name string
		raw  string
	}{
		{name: "blank", raw: "   "},
		{name: "too long", raw: strings.Repeat("a", 81)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			identity := authn.Identity{UID: testPrefix + "-uid-" + uuid.NewString()}
			_, err := coachsignup.Signup(ctx, testPool, identity, c.raw)
			var validationErr *coachsignup.ValidationError
			if !errors.As(err, &validationErr) {
				t.Fatalf("error = %v, want *ValidationError", err)
			}

			var count int
			if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("a rejected signup must not leave a users row behind, got count=%d", count)
			}
		})
	}
}

func requireIntegrationDB(t *testing.T) {
	t.Helper()
	if skipReason != "" {
		t.Skip(skipReason)
	}
}

func createUser(t *testing.T, role string) authn.User {
	t.Helper()
	u := authn.User{ID: uuid.NewString(), FirebaseUID: testPrefix + "-uid-" + uuid.NewString(), Name: testPrefix + " user", Role: role}
	if _, err := testPool.Exec(context.Background(),
		`INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1, $2, $3, $4, now())`,
		u.ID, u.FirebaseUID, u.Name, u.Role,
	); err != nil {
		t.Fatalf("TEST_DATABASE_URL must point to a database with the current schema: create user: %v", err)
	}
	return u
}

func cleanupTestRows(ctx context.Context) {
	if testPool == nil {
		return
	}
	pattern := testPrefix + "%"
	_, _ = testPool.Exec(ctx, `DELETE FROM coach_athletes WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1) OR athlete_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM coach_invite_codes WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM users WHERE firebase_uid LIKE $1`, pattern)
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
	if strings.EqualFold(testConfig.ConnConfig.Host, developmentConfig.ConnConfig.Host) {
		return true, nil
	}
	testIPs, err := net.LookupIP(testConfig.ConnConfig.Host)
	if err != nil {
		return false, err
	}
	developmentIPs, err := net.LookupIP(developmentConfig.ConnConfig.Host)
	if err != nil {
		return false, err
	}
	for _, testIP := range testIPs {
		for _, developmentIP := range developmentIPs {
			if testIP.Equal(developmentIP) {
				return true, nil
			}
		}
	}
	return false, nil
}
