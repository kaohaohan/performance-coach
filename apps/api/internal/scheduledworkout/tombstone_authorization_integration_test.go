package scheduledworkout_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
)

func TestCreateScheduledWorkoutForbiddenForTombstonedAthlete(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	tombstonedAthlete := user(t, "ATHLETE")
	connect(t, coach, tombstonedAthlete)
	tombstoneUser(t, tombstonedAthlete.ID, "Deleted Athlete")

	reps := 5
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " tombstone schedule",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})

	if _, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{tombstonedAthlete.ID}, ScheduledDate: "2026-08-16",
	}); !errors.Is(err, scheduledworkout.ErrAthletesNotConnected) {
		t.Fatalf("schedule tombstoned athlete error = %v, want ErrAthletesNotConnected", err)
	}
}

func TestHistoricalScheduledWorkoutListAndGetRemainReadableForTombstonedAthlete(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	athleteUser := user(t, "ATHLETE")
	connect(t, coach, athleteUser)

	reps := 5
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " historical schedule",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athleteUser.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}

	tombstoneUser(t, athleteUser.ID, "Deleted Athlete")
	day, _ := time.Parse("2006-01-02", "2026-08-16")

	listed, err := scheduledworkout.ListForCoach(ctx, pool, coach, day, day, &athleteUser.ID)
	if err != nil {
		t.Fatalf("historical list for tombstoned athlete = %v", err)
	}
	if len(listed) != 1 || listed[0].ID != created[0].ID {
		t.Fatalf("listed = %#v, want retained scheduled workout %s", listed, created[0].ID)
	}

	got, err := scheduledworkout.GetForCoach(ctx, pool, coach, created[0].ID)
	if err != nil {
		t.Fatalf("historical get for tombstoned athlete = %v", err)
	}
	if got.ID != created[0].ID {
		t.Fatalf("GetForCoach = %#v, want scheduled workout %s", got, created[0].ID)
	}
}

func TestCrossTenantHistoricalRowsUnaffectedByAthleteTombstone(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coachA := user(t, "COACH")
	coachB := user(t, "COACH")
	sharedAthlete := user(t, "ATHLETE")
	liveAthleteB := user(t, "ATHLETE")
	connect(t, coachA, sharedAthlete)
	connect(t, coachB, sharedAthlete)
	connect(t, coachB, liveAthleteB)

	reps := 5
	workoutA := createWorkout(t, coachA, []workout.CreateExerciseInput{{
		Name: prefix + " coachA historical",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	workoutB := createWorkout(t, coachB, []workout.CreateExerciseInput{{
		Name: prefix + " coachB historical",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	createdA, err := scheduledworkout.Create(ctx, pool, coachA, scheduledworkout.CreateInput{
		WorkoutID: workoutA.ID, AthleteIDs: []string{sharedAthlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}
	createdB, err := scheduledworkout.Create(ctx, pool, coachB, scheduledworkout.CreateInput{
		WorkoutID: workoutB.ID, AthleteIDs: []string{sharedAthlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}

	tombstoneUser(t, sharedAthlete.ID, "Deleted Athlete")

	assertRelationshipExists(t, coachA.ID, sharedAthlete.ID)
	assertRelationshipExists(t, coachB.ID, sharedAthlete.ID)
	assertScheduledWorkoutExists(t, createdA[0].ID)
	assertScheduledWorkoutExists(t, createdB[0].ID)

	if _, err := scheduledworkout.Create(ctx, pool, coachA, scheduledworkout.CreateInput{
		WorkoutID: workoutA.ID, AthleteIDs: []string{sharedAthlete.ID}, ScheduledDate: "2026-08-17",
	}); !errors.Is(err, scheduledworkout.ErrAthletesNotConnected) {
		t.Fatalf("coachA reschedule tombstoned athlete error = %v, want ErrAthletesNotConnected", err)
	}
	assertRelationshipExists(t, coachB.ID, sharedAthlete.ID)
	assertScheduledWorkoutExists(t, createdB[0].ID)

	day, _ := time.Parse("2006-01-02", "2026-08-16")
	listedB, err := scheduledworkout.ListForCoach(ctx, pool, coachB, day, day, &sharedAthlete.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listedB) != 1 || listedB[0].ID != createdB[0].ID {
		t.Fatalf("coachB historical list = %#v, want retained row %s", listedB, createdB[0].ID)
	}

	liveWorkout := createWorkout(t, coachB, []workout.CreateExerciseInput{{
		Name: prefix + " coachB live",
		Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	if _, err := scheduledworkout.Create(ctx, pool, coachB, scheduledworkout.CreateInput{
		WorkoutID: liveWorkout.ID, AthleteIDs: []string{liveAthleteB.ID}, ScheduledDate: "2026-08-18",
	}); err != nil {
		t.Fatalf("coachB scheduling live athlete after shared tombstone = %v", err)
	}
}

func assertRelationshipExists(t *testing.T, coachID, athleteID string) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2)`, coachID, athleteID).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatalf("expected coach_athletes row coach=%s athlete=%s", coachID, athleteID)
	}
}

func assertScheduledWorkoutExists(t *testing.T, id string) {
	t.Helper()
	var exists bool
	if err := pool.QueryRow(context.Background(), `SELECT EXISTS(SELECT 1 FROM scheduled_workouts WHERE id = $1)`, id).Scan(&exists); err != nil {
		t.Fatal(err)
	}
	if !exists {
		t.Fatalf("expected scheduled_workouts row %s to remain", id)
	}
}

func tombstoneUser(t *testing.T, userID, name string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `UPDATE users SET deleted_at = now(), name = $2 WHERE id = $1`, userID, name); err != nil {
		t.Fatal(err)
	}
}
