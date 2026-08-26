package athlete_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/athlete"
)

func TestListForCoachOmitsTombstonedAthlete(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	activeAthlete := createUser(t, "ATHLETE")
	tombstonedAthlete := createUser(t, "ATHLETE")
	connect(t, ctx, coach.ID, activeAthlete.ID)
	connect(t, ctx, coach.ID, tombstonedAthlete.ID)
	tombstoneUser(t, ctx, tombstonedAthlete.ID, "Deleted Athlete")

	athletes, err := athlete.ListForCoach(ctx, testPool, coach)
	if err != nil {
		t.Fatal(err)
	}
	if len(athletes) != 1 || athletes[0].ID != activeAthlete.ID {
		t.Fatalf("listed athletes = %#v, want only active athlete %s", athletes, activeAthlete.ID)
	}
	if !connected(t, ctx, coach.ID, tombstonedAthlete.ID) {
		t.Fatal("historical coach_athletes row for tombstoned athlete must remain")
	}
}

func TestRemoveTombstonedAthleteReturnsNotFoundAndRetainsACL(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	tombstonedAthlete := createUser(t, "ATHLETE")
	connect(t, ctx, coach.ID, tombstonedAthlete.ID)
	tombstoneUser(t, ctx, tombstonedAthlete.ID, "Deleted Athlete")

	if err := athlete.Remove(ctx, testPool, coach, tombstonedAthlete.ID); !errors.Is(err, athlete.ErrNotFound) {
		t.Fatalf("Remove tombstoned athlete error = %v, want ErrNotFound", err)
	}
	if !connected(t, ctx, coach.ID, tombstonedAthlete.ID) {
		t.Fatal("DELETE /athletes must not remove historical coach_athletes row for tombstoned athlete")
	}
}

func TestUnrelatedCoachAthleteRelationshipUnaffectedByTombstone(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coachA := createUser(t, "COACH")
	coachB := createUser(t, "COACH")
	sharedAthlete := createUser(t, "ATHLETE")
	connect(t, ctx, coachA.ID, sharedAthlete.ID)
	connect(t, ctx, coachB.ID, sharedAthlete.ID)
	tombstoneUser(t, ctx, sharedAthlete.ID, "Deleted Athlete")

	if !connected(t, ctx, coachA.ID, sharedAthlete.ID) {
		t.Fatal("coachA historical coach_athletes row was removed by tombstone")
	}
	if !connected(t, ctx, coachB.ID, sharedAthlete.ID) {
		t.Fatal("coachB historical coach_athletes row was removed by tombstone")
	}

	if err := athlete.Remove(ctx, testPool, coachA, sharedAthlete.ID); !errors.Is(err, athlete.ErrNotFound) {
		t.Fatalf("coachA Remove tombstoned shared athlete error = %v, want ErrNotFound", err)
	}
	if !connected(t, ctx, coachA.ID, sharedAthlete.ID) {
		t.Fatal("coachA Remove must not delete historical ACL for tombstoned athlete")
	}
	if !connected(t, ctx, coachB.ID, sharedAthlete.ID) {
		t.Fatal("coachA Remove must not mutate coachB's coach_athletes row")
	}

	otherAthlete := createUser(t, "ATHLETE")
	connect(t, ctx, coachB.ID, otherAthlete.ID)
	athletes, err := athlete.ListForCoach(ctx, testPool, coachB)
	if err != nil {
		t.Fatal(err)
	}
	if len(athletes) != 1 || athletes[0].ID != otherAthlete.ID {
		t.Fatalf("coachB roster = %#v, want only unrelated active athlete", athletes)
	}
}

func tombstoneUser(t *testing.T, ctx context.Context, userID, name string) {
	t.Helper()
	if _, err := testPool.Exec(ctx, `UPDATE users SET deleted_at = now(), name = $2 WHERE id = $1`, userID, name); err != nil {
		t.Fatal(err)
	}
}
