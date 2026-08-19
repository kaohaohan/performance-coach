package invitecode_test

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
	"github.com/kaohaohan/performance-coach/apps/api/internal/invitecode"
)

var (
	testPool   *pgxpool.Pool
	skipReason string
	testPrefix = "invitecode-integration-" + uuid.NewString()
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

func TestCreateValidatesInputAndDefaultsExpiry(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	athlete := createUser(t, "ATHLETE")

	if _, err := invitecode.Create(ctx, testPool, athlete, invitecode.CreateInput{}); !errors.Is(err, invitecode.ErrForbidden) {
		t.Fatalf("athlete create error = %v, want ErrForbidden", err)
	}

	before := time.Now()
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	if created.Description != nil {
		t.Fatalf("omitted description = %v, want nil", created.Description)
	}
	if created.Status != invitecode.StatusActive {
		t.Fatalf("new code status = %q, want ACTIVE", created.Status)
	}
	wantExpiry := before.AddDate(0, 0, 30)
	if diff := created.ExpiresAt.Sub(wantExpiry); diff < -time.Minute || diff > time.Minute {
		t.Fatalf("default expiresAt = %v, want close to %v (30 days from creation)", created.ExpiresAt, wantExpiry)
	}

	description := "  " + testPrefix + " Fall squad  "
	expires := 7
	withDescription, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{Description: &description, ExpiresInDays: &expires})
	if err != nil {
		t.Fatal(err)
	}
	if withDescription.Description == nil || *withDescription.Description != strings.TrimSpace(description) {
		t.Fatalf("description = %v, want trimmed %q", withDescription.Description, strings.TrimSpace(description))
	}

	blank := "   "
	blankResult, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{Description: &blank})
	if err != nil {
		t.Fatal(err)
	}
	if blankResult.Description != nil {
		t.Fatalf("blank-after-trim description = %v, want nil (treated as omitted)", blankResult.Description)
	}

	tooLong := strings.Repeat("x", 121)
	if _, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{Description: &tooLong}); !hasValidationError(err) {
		t.Fatalf("121-char description error = %v, want ValidationError", err)
	}

	for _, days := range []int{0, -1, 366} {
		if _, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{ExpiresInDays: &days}); !hasValidationError(err) {
			t.Fatalf("expiresInDays=%d error = %v, want ValidationError", days, err)
		}
	}

	for _, days := range []int{1, 365} {
		if _, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{ExpiresInDays: &days}); err != nil {
			t.Fatalf("expiresInDays=%d should be accepted at the boundary: %v", days, err)
		}
	}

	if len(created.Code) != 10 {
		t.Fatalf("generated code = %q, want length 10", created.Code)
	}
}

func TestListForCoachScopesToCallerAndOrdersNewestFirst(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coachA := createUser(t, "COACH")
	coachB := createUser(t, "COACH")
	athlete := createUser(t, "ATHLETE")

	descriptionA1 := testPrefix + " coachA first"
	descriptionA2 := testPrefix + " coachA second"
	first, err := invitecode.Create(ctx, testPool, coachA, invitecode.CreateInput{Description: &descriptionA1})
	if err != nil {
		t.Fatal(err)
	}
	second, err := invitecode.Create(ctx, testPool, coachA, invitecode.CreateInput{Description: &descriptionA2})
	if err != nil {
		t.Fatal(err)
	}
	descriptionB := testPrefix + " coachB only"
	if _, err := invitecode.Create(ctx, testPool, coachB, invitecode.CreateInput{Description: &descriptionB}); err != nil {
		t.Fatal(err)
	}

	listA, err := invitecode.ListForCoach(ctx, testPool, coachA)
	if err != nil {
		t.Fatal(err)
	}
	fixturesA := codesWithPrefix(listA)
	if len(fixturesA) != 2 {
		t.Fatalf("coachA fixture count = %d, want 2 (coachB's code must not be visible)", len(fixturesA))
	}
	if fixturesA[0].ID != second.ID || fixturesA[1].ID != first.ID {
		t.Fatalf("list order = [%s, %s], want newest first [%s, %s]", fixturesA[0].ID, fixturesA[1].ID, second.ID, first.ID)
	}
	for _, ic := range fixturesA {
		if strings.Contains(*ic.Description, "coachB") {
			t.Fatalf("coachA list leaked coachB's invite: %#v", ic)
		}
	}

	if _, err := invitecode.ListForCoach(ctx, testPool, athlete); !errors.Is(err, invitecode.ErrForbidden) {
		t.Fatalf("athlete list error = %v, want ErrForbidden", err)
	}
}

func TestRevokeIsIdempotentForwardOnlyAndOwnershipScoped(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coachA := createUser(t, "COACH")
	coachB := createUser(t, "COACH")
	athlete := createUser(t, "ATHLETE")

	created, err := invitecode.Create(ctx, testPool, coachA, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := invitecode.Revoke(ctx, testPool, athlete, created.ID); !errors.Is(err, invitecode.ErrForbidden) {
		t.Fatalf("athlete revoke error = %v, want ErrForbidden", err)
	}
	if _, err := invitecode.Revoke(ctx, testPool, coachB, created.ID); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("other coach revoke error = %v, want ErrNotFound (must not confirm the id exists)", err)
	}
	if _, err := invitecode.Revoke(ctx, testPool, coachA, uuid.NewString()); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("unknown id revoke error = %v, want ErrNotFound", err)
	}
	if _, err := invitecode.Revoke(ctx, testPool, coachA, "not-a-uuid"); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("malformed id revoke error = %v, want ErrNotFound", err)
	}

	revoked, err := invitecode.Revoke(ctx, testPool, coachA, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if revoked.Status != invitecode.StatusRevoked || revoked.RevokedAt == nil {
		t.Fatalf("revoked code = %#v, want STATUS=REVOKED with revokedAt set", revoked)
	}
	firstRevokedAt := *revoked.RevokedAt

	// Re-revoking is a no-op success (idempotent), not an error, and must
	// not move revokedAt forward (forward-only: the original revocation
	// instant is preserved).
	time.Sleep(10 * time.Millisecond)
	revokedAgain, err := invitecode.Revoke(ctx, testPool, coachA, created.ID)
	if err != nil {
		t.Fatalf("second revoke should succeed as a no-op: %v", err)
	}
	if revokedAgain.RevokedAt == nil || !revokedAgain.RevokedAt.Equal(firstRevokedAt) {
		t.Fatalf("second revoke revokedAt = %v, want unchanged %v", revokedAgain.RevokedAt, firstRevokedAt)
	}

	listed, err := invitecode.ListForCoach(ctx, testPool, coachA)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, ic := range listed {
		if ic.ID == created.ID {
			found = true
			if ic.Status != invitecode.StatusRevoked {
				t.Fatalf("revoked code still listed with status %q, want REVOKED", ic.Status)
			}
		}
	}
	if !found {
		t.Fatalf("revoked code %q was not found in ListForCoach — revocation must not delete the audit row", created.ID)
	}
}

func TestStatusDerivationAtExpiryBoundary(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")

	almostExpired := 1
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{ExpiresInDays: &almostExpired})
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != invitecode.StatusActive {
		t.Fatalf("freshly created 1-day code status = %q, want ACTIVE", created.Status)
	}

	// Force the row into the past directly, bypassing the service, to
	// deterministically observe the expired branch of status derivation.
	// Must stay strictly after created_at (coach_invite_codes_expiry_check
	// requires expires_at > created_at) while still landing in the past by
	// the time deriveStatus reads it below.
	if _, err := testPool.Exec(ctx, `UPDATE coach_invite_codes SET expires_at = created_at + interval '1 millisecond' WHERE id = $1`, created.ID); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)

	listed, err := invitecode.ListForCoach(ctx, testPool, coach)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for _, ic := range listed {
		if ic.ID == created.ID {
			found = true
			if ic.Status != invitecode.StatusExpired {
				t.Fatalf("past-expiry code status = %q, want EXPIRED", ic.Status)
			}
		}
	}
	if !found {
		t.Fatalf("expired code %q missing from ListForCoach", created.ID)
	}

	// Revoking an already-expired code reports REVOKED, not EXPIRED —
	// revoked_at takes precedence in deriveStatus.
	revoked, err := invitecode.Revoke(ctx, testPool, coach, created.ID)
	if err != nil {
		t.Fatal(err)
	}
	if revoked.Status != invitecode.StatusRevoked {
		t.Fatalf("revoked+expired code status = %q, want REVOKED (revocation takes precedence)", revoked.Status)
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

func codesWithPrefix(codes []invitecode.InviteCode) []invitecode.InviteCode {
	var out []invitecode.InviteCode
	for _, ic := range codes {
		if ic.Description != nil && strings.HasPrefix(*ic.Description, testPrefix) {
			out = append(out, ic)
		}
	}
	return out
}

func hasValidationError(err error) bool {
	var target *invitecode.ValidationError
	return errors.As(err, &target)
}

func cleanupTestRows(ctx context.Context) {
	if testPool == nil {
		return
	}
	pattern := testPrefix + "%"
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
