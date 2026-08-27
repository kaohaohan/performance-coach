package scheduledworkout_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
)

// scheduleOne creates a single-exercise template and schedules it for one
// athlete, returning the workout template and the scheduled workout. Delete's
// tests care about which rows survive, not about prescription shapes, so the
// prescription is deliberately trivial.
func scheduleOne(t *testing.T, coach, athlete authn.User, date string) (workout.Workout, scheduledworkout.Created) {
	t.Helper()
	reps := 10
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " squat " + uuid.NewString(),
		Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	created, err := scheduledworkout.Create(context.Background(), pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: date,
	})
	if err != nil {
		t.Fatal(err)
	}
	return w, created[0]
}

// TestDeleteRemovesOnlyTheTargetedAssignment is the core case behind the bug
// this endpoint exists for: an athlete has two workouts on one date, the
// Coach removes the second, and the first is left exactly as it was. It also
// pins the two things a delete must never take with it — the reusable Workout
// template, and another athlete's copy of the same template.
func TestDeleteRemovesOnlyTheTargetedAssignment(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	marco, kevin := user(t, "ATHLETE"), user(t, "ATHLETE")
	connect(t, coach, marco)
	connect(t, coach, kevin)

	const date = "2026-08-25"
	keepTemplate, keep := scheduleOne(t, coach, marco, date)

	// The accidental second workout, on the same athlete and the same date.
	removeTemplate, remove := scheduleOne(t, coach, marco, date)

	// A third athlete scheduled from the template being removed.
	otherCreated, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: removeTemplate.ID, AthleteIDs: []string{kevin.ID}, ScheduledDate: date,
	})
	if err != nil {
		t.Fatal(err)
	}

	if err := scheduledworkout.Delete(ctx, pool, coach, remove.ID); err != nil {
		t.Fatal(err)
	}

	// The targeted row and its whole snapshot are gone.
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, remove.ID, 0)
	assertCount(t, `SELECT count(*) FROM scheduled_workout_exercises WHERE scheduled_workout_id = $1`, remove.ID, 0)
	assertCount(t,
		`SELECT count(*) FROM scheduled_workout_planned_sets sps
		 JOIN scheduled_workout_exercises swe ON swe.id = sps.scheduled_workout_exercise_id
		 WHERE swe.scheduled_workout_id = $1`, remove.ID, 0)

	// The legitimate first workout on the same athlete/date is untouched.
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, keep.ID, 1)
	assertCount(t, `SELECT count(*) FROM scheduled_workout_exercises WHERE scheduled_workout_id = $1`, keep.ID, 1)
	assertScheduleCount(t, coach.ID, keepTemplate.ID, marco.ID, date, 1)

	// Both reusable Workout templates survive — including the removed
	// assignment's, which stays a normal template in the Workout Library.
	assertCount(t, `SELECT count(*) FROM workouts WHERE id = $1`, keepTemplate.ID, 1)
	assertCount(t, `SELECT count(*) FROM workouts WHERE id = $1`, removeTemplate.ID, 1)

	// Kevin's copy of the removed template is a separate assignment.
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, otherCreated[0].ID, 1)

	// What the Coach Calendar reloads shows only the surviving workout.
	day := time.Date(2026, time.August, 25, 0, 0, 0, 0, time.UTC)
	listed, err := scheduledworkout.ListForCoach(ctx, pool, coach, day, day, &marco.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed) != 1 || listed[0].ID != keep.ID {
		t.Fatalf("calendar after delete = %#v, want only %s", listed, keep.ID)
	}
}

// TestDeleteRejectsWhenSessionAlreadyStarted covers both ACTIVE and
// COMPLETED: real training happened against the assignment, so removing it
// would destroy the athlete's record of it.
func TestDeleteRejectsWhenSessionAlreadyStarted(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	athlete := user(t, "ATHLETE")
	connect(t, coach, athlete)

	_, scheduled := scheduleOne(t, coach, athlete, "2026-08-25")

	sessionID := uuid.NewString()
	if _, err := pool.Exec(ctx,
		`INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at)
		 VALUES ($1, $2, $3, 'ACTIVE', now())`,
		sessionID, scheduled.ID, athlete.ID,
	); err != nil {
		t.Fatal(err)
	}

	if err := scheduledworkout.Delete(ctx, pool, coach, scheduled.ID); !errors.Is(err, scheduledworkout.ErrSessionStarted) {
		t.Fatalf("delete with ACTIVE session = %v, want ErrSessionStarted", err)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, scheduled.ID, 1)
	assertCount(t, `SELECT count(*) FROM scheduled_workout_exercises WHERE scheduled_workout_id = $1`, scheduled.ID, 1)

	if _, err := pool.Exec(ctx,
		`UPDATE workout_sessions SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, sessionID,
	); err != nil {
		t.Fatal(err)
	}

	if err := scheduledworkout.Delete(ctx, pool, coach, scheduled.ID); !errors.Is(err, scheduledworkout.ErrSessionStarted) {
		t.Fatalf("delete with COMPLETED session = %v, want ErrSessionStarted", err)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, scheduled.ID, 1)
	assertCount(t, `SELECT count(*) FROM scheduled_workout_exercises WHERE scheduled_workout_id = $1`, scheduled.ID, 1)
}

// TestDeleteIsForbiddenForNonCoach — role check precedes resource scoping, so
// an athlete gets 403 rather than a 404 that would leak existence.
func TestDeleteIsForbiddenForNonCoach(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	athlete := user(t, "ATHLETE")
	connect(t, coach, athlete)

	_, scheduled := scheduleOne(t, coach, athlete, "2026-08-25")

	if err := scheduledworkout.Delete(ctx, pool, athlete, scheduled.ID); !errors.Is(err, scheduledworkout.ErrForbidden) {
		t.Fatalf("athlete delete = %v, want ErrForbidden", err)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, scheduled.ID, 1)
}

// TestDeleteRejectsAnotherCoachesScheduledWorkout pins the cross-tenant
// contract: 404, never 403, so the response cannot reveal that the id exists
// for a different coach. An unknown id is indistinguishable from it.
func TestDeleteRejectsAnotherCoachesScheduledWorkout(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	owner := user(t, "COACH")
	intruder := user(t, "COACH")
	athlete := user(t, "ATHLETE")
	connect(t, owner, athlete)

	_, scheduled := scheduleOne(t, owner, athlete, "2026-08-25")

	if err := scheduledworkout.Delete(ctx, pool, intruder, scheduled.ID); !errors.Is(err, scheduledworkout.ErrNotFound) {
		t.Fatalf("other coach delete = %v, want ErrNotFound", err)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, scheduled.ID, 1)

	if err := scheduledworkout.Delete(ctx, pool, owner, uuid.NewString()); !errors.Is(err, scheduledworkout.ErrNotFound) {
		t.Fatalf("unknown id delete = %v, want ErrNotFound", err)
	}

	var validationErr *scheduledworkout.ValidationError
	if err := scheduledworkout.Delete(ctx, pool, owner, "not-a-uuid"); !errors.As(err, &validationErr) {
		t.Fatalf("malformed id delete = %v, want ValidationError", err)
	}

	// The owner can still remove it — the refusals above changed nothing.
	if err := scheduledworkout.Delete(ctx, pool, owner, scheduled.ID); err != nil {
		t.Fatal(err)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE id = $1`, scheduled.ID, 0)
}

// TestDeleteIsNotIdempotentSecondCallIsNotFound matches DELETE /athletes:
// a second removal of the same id is a 404, not a silent success.
func TestDeleteIsNotIdempotentSecondCallIsNotFound(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	athlete := user(t, "ATHLETE")
	connect(t, coach, athlete)

	_, scheduled := scheduleOne(t, coach, athlete, "2026-08-25")

	if err := scheduledworkout.Delete(ctx, pool, coach, scheduled.ID); err != nil {
		t.Fatal(err)
	}
	if err := scheduledworkout.Delete(ctx, pool, coach, scheduled.ID); !errors.Is(err, scheduledworkout.ErrNotFound) {
		t.Fatalf("second delete = %v, want ErrNotFound", err)
	}
}
