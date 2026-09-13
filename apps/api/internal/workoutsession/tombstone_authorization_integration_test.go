package workoutsession_test

import (
	"context"
	"errors"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

func TestCoachMutationsNotFoundForTombstonedAthlete(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	reps := 5
	setup := newSession(t, []workout.CreateExerciseInput{{
		Name: integrationPrefix + " tombstone mutations",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	tombstoneUser(t, setup.athlete.ID, "Deleted Athlete")

	if _, _, err := workoutsession.Start(ctx, integrationPool, setup.coach, setup.created.ID); !errors.Is(err, workoutsession.ErrNotFound) {
		t.Fatalf("coach Start tombstoned athlete error = %v, want ErrNotFound", err)
	}
	if _, err := workoutsession.Complete(ctx, integrationPool, setup.coach, setup.session.ID); !errors.Is(err, workoutsession.ErrNotFound) {
		t.Fatalf("coach Complete tombstoned athlete error = %v, want ErrNotFound", err)
	}

	exercise := setup.created.Exercises[0]
	plannedID := exercise.Plan.Sets[0].ScheduledWorkoutPlannedSetID
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.coach, setup.session.ID, plannedInput(
		exercise.ScheduledWorkoutExerciseID, plannedID, nil, nil, intPtr(5), nil,
	)); !errors.Is(err, workoutsession.ErrNotFound) {
		t.Fatalf("coach CreateSetLog tombstoned athlete error = %v, want ErrNotFound", err)
	}
}

func TestGetSessionReadableForHistoricallyConnectedCoachShowsTombstoneName(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	reps := 5
	setup := newSession(t, []workout.CreateExerciseInput{{
		Name: integrationPrefix + " tombstone read",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	tombstoneUser(t, setup.athlete.ID, "Deleted Athlete")

	detail, err := workoutsession.Get(ctx, integrationPool, setup.coach, setup.session.ID)
	if err != nil {
		t.Fatalf("historical coach Get session = %v", err)
	}
	if detail.Athlete.Name != "Deleted Athlete" {
		t.Fatalf("athlete name = %q, want Deleted Athlete", detail.Athlete.Name)
	}
}

func TestAthleteSelfAccessUnaffectedByDeletedCoach(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	reps := 5
	setup := newSession(t, []workout.CreateExerciseInput{{
		Name: integrationPrefix + " deleted coach self access",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	tombstoneUser(t, setup.coach.ID, "Deleted Coach")

	exercise := setup.created.Exercises[0]
	plannedID := exercise.Plan.Sets[0].ScheduledWorkoutPlannedSetID
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(
		exercise.ScheduledWorkoutExerciseID, plannedID, nil, nil, intPtr(5), nil,
	)); err != nil {
		t.Fatalf("athlete CreateSetLog after coach tombstone = %v", err)
	}
	if _, err := workoutsession.Complete(ctx, integrationPool, setup.athlete, setup.session.ID); err != nil {
		t.Fatalf("athlete Complete after coach tombstone = %v", err)
	}
}

func tombstoneUser(t *testing.T, userID, name string) {
	t.Helper()
	if _, err := integrationPool.Exec(context.Background(), `UPDATE users SET deleted_at = now(), name = $2 WHERE id = $1`, userID, name); err != nil {
		t.Fatal(err)
	}
}
