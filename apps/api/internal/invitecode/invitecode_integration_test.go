package invitecode_test

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"sync"
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

func TestPreviewInviteCodeReturnsPublicFieldsForActiveCode(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	description := testPrefix + " Fall squad"

	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{Description: &description})
	if err != nil {
		t.Fatal(err)
	}

	for _, variant := range []string{created.Code, strings.ToLower(created.Code), hyphenate(created.Code)} {
		preview, err := invitecode.PreviewInviteCode(ctx, testPool, variant)
		if err != nil {
			t.Fatalf("PreviewInviteCode(%q) returned error: %v", variant, err)
		}
		if preview.Code != created.Code {
			t.Fatalf("PreviewInviteCode(%q).Code = %q, want %q", variant, preview.Code, created.Code)
		}
		if preview.CoachName != coach.Name {
			t.Fatalf("PreviewInviteCode(%q).CoachName = %q, want %q", variant, preview.CoachName, coach.Name)
		}
		if preview.Description == nil || *preview.Description != description {
			t.Fatalf("PreviewInviteCode(%q).Description = %v, want %q", variant, preview.Description, description)
		}
	}
}

func TestPreviewInviteCodeReturnsNotFoundForUnknownMalformedExpiredRevoked(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")

	if _, err := invitecode.PreviewInviteCode(ctx, testPool, "ZZZZZZZZZZ"); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("unknown code error = %v, want ErrNotFound", err)
	}
	if _, err := invitecode.PreviewInviteCode(ctx, testPool, "too-short"); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("malformed code error = %v, want ErrNotFound", err)
	}

	almostExpired := 1
	expiring, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{ExpiresInDays: &almostExpired})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE coach_invite_codes SET expires_at = created_at + interval '1 millisecond' WHERE id = $1`, expiring.ID); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)
	if _, err := invitecode.PreviewInviteCode(ctx, testPool, expiring.Code); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("expired code error = %v, want ErrNotFound", err)
	}

	revokable, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := invitecode.Revoke(ctx, testPool, coach, revokable.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := invitecode.PreviewInviteCode(ctx, testPool, revokable.Code); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("revoked code error = %v, want ErrNotFound", err)
	}
}

func TestRedeemCreatesNewAthleteAndConnectsToCoach(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}

	identity := authn.Identity{UID: testPrefix + "-athlete-uid-" + uuid.NewString(), Email: "kevin@example.com"}
	redeemed, err := invitecode.Redeem(ctx, testPool, identity, created.Code, invitecode.RedeemInput{Name: "Kevin Chen"})
	if err != nil {
		t.Fatal(err)
	}
	if redeemed.User.Role != "ATHLETE" || redeemed.User.Name != "Kevin Chen" {
		t.Fatalf("redeemed.User = %#v, want ATHLETE Kevin Chen", redeemed.User)
	}
	if redeemed.Coach.Name != coach.Name {
		t.Fatalf("redeemed.Coach.Name = %q, want %q", redeemed.Coach.Name, coach.Name)
	}

	var role, name, firebaseUID string
	if err := testPool.QueryRow(ctx, `SELECT role, name, firebase_uid FROM users WHERE id = $1`, redeemed.User.ID).
		Scan(&role, &name, &firebaseUID); err != nil {
		t.Fatal(err)
	}
	if role != "ATHLETE" || name != "Kevin Chen" || firebaseUID != identity.UID {
		t.Fatalf("persisted user = role=%q name=%q firebaseUid=%q, want ATHLETE %q %q", role, name, firebaseUID, "Kevin Chen", identity.UID)
	}

	var connected bool
	if err := testPool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2)`, coach.ID, redeemed.User.ID).
		Scan(&connected); err != nil {
		t.Fatal(err)
	}
	if !connected {
		t.Fatal("coach_athletes relationship was not created")
	}
}

func TestRedeemRequiresNameOnlyWhenCreatingNewUser(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}

	blankIdentity := authn.Identity{UID: testPrefix + "-blank-name-" + uuid.NewString()}
	if _, err := invitecode.Redeem(ctx, testPool, blankIdentity, created.Code, invitecode.RedeemInput{Name: "   "}); !hasValidationError(err) {
		t.Fatalf("new user with blank name error = %v, want ValidationError", err)
	}

	tooLongIdentity := authn.Identity{UID: testPrefix + "-long-name-" + uuid.NewString()}
	tooLongName := strings.Repeat("x", 81)
	if _, err := invitecode.Redeem(ctx, testPool, tooLongIdentity, created.Code, invitecode.RedeemInput{Name: tooLongName}); !hasValidationError(err) {
		t.Fatalf("new user with 81-char name error = %v, want ValidationError", err)
	}

	// Neither rejected attempt above may have left a users row behind —
	// the surrounding transaction must have rolled back.
	for _, identity := range []authn.Identity{blankIdentity, tooLongIdentity} {
		var count int
		if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("rejected redeem for %q left %d users row(s) behind, want 0 (transaction must roll back)", identity.UID, count)
		}
	}

	// An existing ATHLETE redeeming again may omit name entirely — it is
	// only required on the create path.
	existingIdentity := authn.Identity{UID: testPrefix + "-existing-" + uuid.NewString()}
	if _, err := invitecode.Redeem(ctx, testPool, existingIdentity, created.Code, invitecode.RedeemInput{Name: "First Time"}); err != nil {
		t.Fatal(err)
	}
	secondCode, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	redeemedAgain, err := invitecode.Redeem(ctx, testPool, existingIdentity, secondCode.Code, invitecode.RedeemInput{})
	if err != nil {
		t.Fatalf("existing athlete redeeming with blank name should succeed: %v", err)
	}
	if redeemedAgain.User.Name != "First Time" {
		t.Fatalf("redeemedAgain.User.Name = %q, want unchanged %q (blank name must never overwrite)", redeemedAgain.User.Name, "First Time")
	}
}

func TestRedeemIsIdempotentSameAthleteSameCoach(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	identity := authn.Identity{UID: testPrefix + "-idempotent-" + uuid.NewString()}

	first, err := invitecode.Redeem(ctx, testPool, identity, created.Code, invitecode.RedeemInput{Name: "Repeat Athlete"})
	if err != nil {
		t.Fatal(err)
	}
	second, err := invitecode.Redeem(ctx, testPool, identity, created.Code, invitecode.RedeemInput{Name: "Repeat Athlete"})
	if err != nil {
		t.Fatalf("repeat redeem should succeed as a no-op: %v", err)
	}
	if first.User.ID != second.User.ID {
		t.Fatalf("repeat redeem user id = %q, want unchanged %q", second.User.ID, first.User.ID)
	}

	var relationshipCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`, coach.ID, first.User.ID).
		Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if relationshipCount != 1 {
		t.Fatalf("coach_athletes rows for the same pair = %d, want exactly 1", relationshipCount)
	}
}

func TestRedeemAllowsMultiCoachConnection(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coachA := createUser(t, "COACH")
	coachB := createUser(t, "COACH")
	codeA, err := invitecode.Create(ctx, testPool, coachA, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	codeB, err := invitecode.Create(ctx, testPool, coachB, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	identity := authn.Identity{UID: testPrefix + "-multi-coach-" + uuid.NewString()}

	first, err := invitecode.Redeem(ctx, testPool, identity, codeA.Code, invitecode.RedeemInput{Name: "Multi Coach Athlete"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := invitecode.Redeem(ctx, testPool, identity, codeB.Code, invitecode.RedeemInput{}); err != nil {
		t.Fatalf("redeeming a second, different coach's code should be allowed: %v", err)
	}

	var relationshipCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM coach_athletes WHERE athlete_id = $1`, first.User.ID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if relationshipCount != 2 {
		t.Fatalf("relationships for multi-coach athlete = %d, want 2", relationshipCount)
	}
}

func TestRedeemRejectsExistingCoachAccountIncludingItsOwnCode(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	existingCoach := createUser(t, "COACH")
	otherCoach := createUser(t, "COACH")
	otherCoachesCode, err := invitecode.Create(ctx, testPool, otherCoach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	ownCode, err := invitecode.Create(ctx, testPool, existingCoach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	coachIdentity := authn.Identity{UID: existingCoach.FirebaseUID}

	if _, err := invitecode.Redeem(ctx, testPool, coachIdentity, otherCoachesCode.Code, invitecode.RedeemInput{}); !errors.Is(err, invitecode.ErrCoachCannotRedeem) {
		t.Fatalf("coach redeeming another coach's code error = %v, want ErrCoachCannotRedeem", err)
	}
	if _, err := invitecode.Redeem(ctx, testPool, coachIdentity, ownCode.Code, invitecode.RedeemInput{}); !errors.Is(err, invitecode.ErrCoachCannotRedeem) {
		t.Fatalf("coach redeeming their own code error = %v, want ErrCoachCannotRedeem", err)
	}

	var relationshipCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM coach_athletes WHERE athlete_id = $1`, existingCoach.ID).Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if relationshipCount != 0 {
		t.Fatalf("a rejected coach redeem left %d coach_athletes row(s) behind, want 0", relationshipCount)
	}
}

func TestRedeemRejectsExpiredAndRevokedCodesWithoutWritingAnything(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")

	almostExpired := 1
	expiring, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{ExpiresInDays: &almostExpired})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE coach_invite_codes SET expires_at = created_at + interval '1 millisecond' WHERE id = $1`, expiring.ID); err != nil {
		t.Fatal(err)
	}
	time.Sleep(5 * time.Millisecond)

	revokable, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := invitecode.Revoke(ctx, testPool, coach, revokable.ID); err != nil {
		t.Fatal(err)
	}

	expiredIdentity := authn.Identity{UID: testPrefix + "-expired-attempt-" + uuid.NewString()}
	if _, err := invitecode.Redeem(ctx, testPool, expiredIdentity, expiring.Code, invitecode.RedeemInput{Name: "Should Not Exist"}); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("redeem of expired code error = %v, want ErrNotFound", err)
	}

	revokedIdentity := authn.Identity{UID: testPrefix + "-revoked-attempt-" + uuid.NewString()}
	if _, err := invitecode.Redeem(ctx, testPool, revokedIdentity, revokable.Code, invitecode.RedeemInput{Name: "Should Not Exist"}); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("redeem of revoked code error = %v, want ErrNotFound", err)
	}

	for _, identity := range []authn.Identity{expiredIdentity, revokedIdentity} {
		var count int
		if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("rejected redeem for %q left %d users row(s) behind, want 0", identity.UID, count)
		}
	}
}

func TestRedeemMalformedCodeReturnsNotFound(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	identity := authn.Identity{UID: testPrefix + "-malformed-attempt-" + uuid.NewString()}
	if _, err := invitecode.Redeem(ctx, testPool, identity, "not-a-real-code!", invitecode.RedeemInput{Name: "Whoever"}); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("redeem of a malformed code error = %v, want ErrNotFound", err)
	}
}

// TestRedeemConcurrentSameNewIdentity is the concurrency requirement from
// docs/athlete-onboarding-invite-codes-v0.1.md §6: two goroutines
// redeeming the same brand-new Firebase identity against the same code at
// the same time must both succeed and must produce exactly one users row
// and exactly one coach_athletes relationship — never a duplicate, never
// an error surfaced to either caller.
func TestRedeemConcurrentSameNewIdentity(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	identity := authn.Identity{UID: testPrefix + "-concurrent-" + uuid.NewString()}

	const goroutines = 8
	start := make(chan struct{})
	results := make(chan invitecode.Redeemed, goroutines)
	errs := make(chan error, goroutines)
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			redeemed, err := invitecode.Redeem(ctx, testPool, identity, created.Code, invitecode.RedeemInput{Name: "Concurrent Athlete"})
			if err != nil {
				errs <- err
				return
			}
			results <- redeemed
		}()
	}
	close(start)
	wg.Wait()
	close(results)
	close(errs)

	for err := range errs {
		t.Fatalf("concurrent redeem returned an error, want all to succeed: %v", err)
	}

	var firstUserID string
	count := 0
	for r := range results {
		count++
		if firstUserID == "" {
			firstUserID = r.User.ID
		} else if r.User.ID != firstUserID {
			t.Fatalf("concurrent redeem produced two different user ids: %q and %q", firstUserID, r.User.ID)
		}
	}
	if count != goroutines {
		t.Fatalf("got %d successful results, want %d", count, goroutines)
	}

	var userCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&userCount); err != nil {
		t.Fatal(err)
	}
	if userCount != 1 {
		t.Fatalf("users rows for the concurrently-redeemed identity = %d, want exactly 1", userCount)
	}

	var relationshipCount int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`, coach.ID, firstUserID).
		Scan(&relationshipCount); err != nil {
		t.Fatal(err)
	}
	if relationshipCount != 1 {
		t.Fatalf("coach_athletes rows for the concurrently-redeemed pair = %d, want exactly 1", relationshipCount)
	}
}

func hyphenate(code string) string {
	if len(code) != 10 {
		return code
	}
	return strings.ToLower(code[:5] + "-" + code[5:])
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
