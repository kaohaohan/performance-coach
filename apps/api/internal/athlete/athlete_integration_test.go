package athlete_test

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

	"github.com/kaohaohan/performance-coach/apps/api/internal/athlete"
	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

var (
	testPool   *pgxpool.Pool
	skipReason string
	testPrefix = "athlete-integration-" + uuid.NewString()
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

func TestRemoveDetachesOnlyCallerCoachRelationship(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coachA := createUser(t, "COACH")
	coachB := createUser(t, "COACH")
	athleteUser := createUser(t, "ATHLETE")
	connect(t, ctx, coachA.ID, athleteUser.ID)
	connect(t, ctx, coachB.ID, athleteUser.ID)

	if err := athlete.Remove(ctx, testPool, coachA, athleteUser.ID); err != nil {
		t.Fatal(err)
	}

	if connected(t, ctx, coachA.ID, athleteUser.ID) {
		t.Fatal("coachA-athlete relationship still exists after Remove")
	}
	if !connected(t, ctx, coachB.ID, athleteUser.ID) {
		t.Fatal("coachB-athlete relationship was removed, want untouched — Remove must be scoped to the caller only")
	}

	var userCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE id = $1`, athleteUser.ID).Scan(&userCount); err != nil {
		t.Fatal(err)
	}
	if userCount != 1 {
		t.Fatalf("athlete users row count after Remove = %d, want 1 (Remove must never delete the users row)", userCount)
	}
}

func TestRemoveIsForbiddenForNonCoach(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	athleteCaller := createUser(t, "ATHLETE")
	otherAthlete := createUser(t, "ATHLETE")

	if err := athlete.Remove(ctx, testPool, athleteCaller, otherAthlete.ID); !errors.Is(err, athlete.ErrForbidden) {
		t.Fatalf("athlete-caller Remove error = %v, want ErrForbidden", err)
	}
}

func TestRemoveReturnsNotFoundForUnknownUnconnectedAndMalformedIDs(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	otherCoach := createUser(t, "COACH")
	unconnectedAthlete := createUser(t, "ATHLETE")
	connectedToOtherCoach := createUser(t, "ATHLETE")
	connect(t, ctx, otherCoach.ID, connectedToOtherCoach.ID)

	if err := athlete.Remove(ctx, testPool, coach, uuid.NewString()); !errors.Is(err, athlete.ErrNotFound) {
		t.Fatalf("unknown athleteId error = %v, want ErrNotFound", err)
	}
	if err := athlete.Remove(ctx, testPool, coach, unconnectedAthlete.ID); !errors.Is(err, athlete.ErrNotFound) {
		t.Fatalf("never-connected athleteId error = %v, want ErrNotFound", err)
	}
	if err := athlete.Remove(ctx, testPool, coach, connectedToOtherCoach.ID); !errors.Is(err, athlete.ErrNotFound) {
		t.Fatalf("athlete connected only to a different coach: error = %v, want ErrNotFound (must not confirm the other coach's roster)", err)
	}
	if err := athlete.Remove(ctx, testPool, coach, "not-a-uuid"); !errors.Is(err, athlete.ErrNotFound) {
		t.Fatalf("malformed athleteId error = %v, want ErrNotFound", err)
	}

	// The other coach's relationship must still be intact — none of the
	// rejected calls above may have mutated it.
	if !connected(t, ctx, otherCoach.ID, connectedToOtherCoach.ID) {
		t.Fatal("other coach's relationship was unexpectedly removed by a call it was never the caller of")
	}
}

func TestRemoveIsNotIdempotentSecondCallIsNotFound(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	athleteUser := createUser(t, "ATHLETE")
	connect(t, ctx, coach.ID, athleteUser.ID)

	if err := athlete.Remove(ctx, testPool, coach, athleteUser.ID); err != nil {
		t.Fatal(err)
	}
	// A DELETE's target, once gone, is gone — unlike revoke's
	// idempotent-200 semantics for a still-existing row with a settable
	// flag (docs/athlete-onboarding-invite-codes-v0.1.md §5.4).
	if err := athlete.Remove(ctx, testPool, coach, athleteUser.ID); !errors.Is(err, athlete.ErrNotFound) {
		t.Fatalf("second Remove error = %v, want ErrNotFound", err)
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

func connect(t *testing.T, ctx context.Context, coachID, athleteID string) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1, $2)`, coachID, athleteID); err != nil {
		t.Fatal(err)
	}
}

func connected(t *testing.T, ctx context.Context, coachID, athleteID string) bool {
	t.Helper()
	var exists bool
	if err := testPool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2)`, coachID, athleteID).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	return exists
}

func cleanupTestRows(ctx context.Context) {
	if testPool == nil {
		return
	}
	pattern := testPrefix + "%"
	_, _ = testPool.Exec(ctx, `DELETE FROM coach_athletes WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1) OR athlete_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
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
