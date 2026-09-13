package coachsignup_test

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/coachsignup"
)

func TestSignupTombstoneCollisionReturnsAccountDeleted(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	identity := authn.Identity{UID: testPrefix + "-tombstone-coach-" + uuid.NewString()}
	created, err := coachsignup.Signup(ctx, testPool, identity, "Coach One")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := testPool.Exec(ctx, `UPDATE users SET deleted_at = now(), name = 'Deleted Coach' WHERE id = $1`, created.ID); err != nil {
		t.Fatal(err)
	}

	_, err = coachsignup.Signup(ctx, testPool, identity, "Coach Retry")
	if !errors.Is(err, coachsignup.ErrAccountDeleted) {
		t.Fatalf("signup tombstone collision error = %v, want ErrAccountDeleted", err)
	}

	var count int
	if err := testPool.QueryRow(ctx, `SELECT count(*) FROM users WHERE firebase_uid = $1 AND deleted_at IS NULL`, identity.UID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("tombstone signup must not resurrect account, got %d active rows", count)
	}
}
