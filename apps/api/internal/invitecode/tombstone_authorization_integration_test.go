package invitecode_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/invitecode"
)

func TestRedeemTombstoneCollisionReturnsAccountDeleted(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}

	identity := authn.Identity{UID: testPrefix + "-tombstone-athlete-" + uuid.NewString()}
	first, err := invitecode.Redeem(ctx, testPool, identity, created.Code, invitecode.RedeemInput{Name: "Athlete One"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE users SET deleted_at = now(), name = 'Deleted Athlete' WHERE id = $1`, first.User.ID); err != nil {
		t.Fatal(err)
	}

	secondCode, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	_, err = invitecode.Redeem(ctx, testPool, identity, secondCode.Code, invitecode.RedeemInput{Name: "Athlete Retry"})
	if !errors.Is(err, invitecode.ErrAccountDeleted) {
		t.Fatalf("redeem tombstone collision error = %v, want ErrAccountDeleted", err)
	}
}

func TestPreviewAndRedeemNotFoundForTombstonedCoach(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	created, err := invitecode.Create(ctx, testPool, coach, invitecode.CreateInput{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE users SET deleted_at = now(), name = 'Deleted Coach' WHERE id = $1`, coach.ID); err != nil {
		t.Fatal(err)
	}

	if _, err := invitecode.PreviewInviteCode(ctx, testPool, created.Code); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("preview tombstoned coach error = %v, want ErrNotFound", err)
	}

	identity := authn.Identity{UID: testPrefix + "-new-athlete-" + uuid.NewString()}
	if _, err := invitecode.Redeem(ctx, testPool, identity, created.Code, invitecode.RedeemInput{Name: "New Athlete"}); !errors.Is(err, invitecode.ErrNotFound) {
		t.Fatalf("redeem tombstoned coach error = %v, want ErrNotFound", err)
	}

	var count int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid = $1`, identity.UID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("redeem against tombstoned coach must not create users row, got count=%d", count)
	}
}
