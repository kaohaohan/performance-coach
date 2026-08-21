package scheduledworkout_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
)

// TestUpdateReplacesSnapshotForOneAthleteOnly covers the core Problem B
// scenario: a Coach edits one athlete's NOT_STARTED ScheduledWorkout, the
// new prescription is what a fresh read returns, and neither the reusable
// Workout template nor a second athlete scheduled from the same template are
// touched.
func TestUpdateReplacesSnapshotForOneAthleteOnly(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	marco, kevin := user(t, "ATHLETE"), user(t, "ATHLETE")
	connect(t, coach, marco)
	connect(t, coach, kevin)

	reps10 := 10
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " squat", Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps10}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{marco.ID, kevin.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}
	marcoScheduled, kevinScheduled := created[0], created[1]

	reps12, load100 := 12, 100.0
	kg := "kg"
	updated, err := scheduledworkout.Update(ctx, pool, coach, marcoScheduled.ID, scheduledworkout.UpdateInput{
		Exercises: []scheduledworkout.UpdateExerciseInput{{
			Name: prefix + " squat",
			Plan: prescription.Plan{SetCount: 4, Defaults: prescription.Defaults{Reps: &reps12, Load: &load100, Unit: &kg}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if updated.ID != marcoScheduled.ID || updated.Athlete.ID != marco.ID || updated.Workout.ID != w.ID || updated.ScheduledDate != "2026-08-16" || updated.Session != nil {
		t.Fatalf("updated header = %#v", updated)
	}
	if len(updated.Exercises) != 1 {
		t.Fatalf("updated exercise count = %d, want 1", len(updated.Exercises))
	}
	assertResolvedSets(t, updated.Exercises[0].Plan.Sets, []expectedSet{
		{position: 1, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
		{position: 2, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
		{position: 3, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
		{position: 4, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
	})

	// A fresh read (ListForAthlete, the same path Athlete Today uses) sees
	// the edit immediately.
	got, err := scheduledworkout.ListForAthlete(ctx, pool, marco, time.Date(2026, time.August, 16, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || len(got[0].Exercises) != 1 {
		t.Fatalf("athlete today after update = %#v", got)
	}
	assertResolvedSets(t, got[0].Exercises[0].Plan.Sets, []expectedSet{
		{position: 1, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
		{position: 2, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
		{position: 3, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
		{position: 4, reps: intPtr(12), load: floatPtr(100), unit: stringPtr("kg")},
	})

	// The reusable Workout template is untouched.
	assertStoredWorkoutExerciseSets(t, w.Exercises[0].WorkoutExerciseID, 3, intPtr(10))

	// Kevin's ScheduledWorkout (same template, same batch) is untouched.
	kevinGot, err := scheduledworkout.ListForAthlete(ctx, pool, kevin, time.Date(2026, time.August, 16, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(kevinGot) != 1 || kevinGot[0].ID != kevinScheduled.ID {
		t.Fatalf("kevin today = %#v", kevinGot)
	}
	assertResolvedSets(t, kevinGot[0].Exercises[0].Plan.Sets, []expectedSet{
		{position: 1, reps: intPtr(10)}, {position: 2, reps: intPtr(10)}, {position: 3, reps: intPtr(10)},
	})
}

// TestUpdateRejectsWhenSessionAlreadyStarted covers both ACTIVE and
// COMPLETED sessions: neither may be edited (§B1).
func TestUpdateRejectsWhenSessionAlreadyStarted(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	reps := 5
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " active-guard", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}
	scheduledID := created[0].ID

	sessionID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at) VALUES ($1, $2, $3, 'ACTIVE', now())`, sessionID, scheduledID, athlete.ID); err != nil {
		t.Fatal(err)
	}

	newReps := 8
	editAttempt := scheduledworkout.UpdateInput{Exercises: []scheduledworkout.UpdateExerciseInput{{
		Name: prefix + " active-guard", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &newReps}},
	}}}
	if _, err := scheduledworkout.Update(ctx, pool, coach, scheduledID, editAttempt); !errors.Is(err, scheduledworkout.ErrSessionStarted) {
		t.Fatalf("edit against ACTIVE session error = %v, want ErrSessionStarted", err)
	}
	assertStoredSets(t, created[0].Exercises[0].ScheduledWorkoutExerciseID, []expectedSet{{position: 1, reps: intPtr(5)}, {position: 2, reps: intPtr(5)}})

	if _, err := pool.Exec(ctx, `UPDATE workout_sessions SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, sessionID); err != nil {
		t.Fatal(err)
	}
	if _, err := scheduledworkout.Update(ctx, pool, coach, scheduledID, editAttempt); !errors.Is(err, scheduledworkout.ErrSessionStarted) {
		t.Fatalf("edit against COMPLETED session error = %v, want ErrSessionStarted", err)
	}
	assertStoredSets(t, created[0].Exercises[0].ScheduledWorkoutExerciseID, []expectedSet{{position: 1, reps: intPtr(5)}, {position: 2, reps: intPtr(5)}})
}

// TestUpdateRejectsAnotherCoachesScheduledWorkout matches the existing
// resource-scoping convention (ErrWorkoutNotFound et al.): a ScheduledWorkout
// belonging to a different coach is reported as not found, not forbidden, and
// nothing is mutated.
func TestUpdateRejectsAnotherCoachesScheduledWorkout(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	owner, otherCoach, athlete := user(t, "COACH"), user(t, "COACH"), user(t, "ATHLETE")
	connect(t, owner, athlete)
	reps := 5
	w := createWorkout(t, owner, []workout.CreateExerciseInput{{
		Name: prefix + " privacy", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, owner, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}

	newReps := 9
	input := scheduledworkout.UpdateInput{Exercises: []scheduledworkout.UpdateExerciseInput{{
		Name: prefix + " privacy", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &newReps}},
	}}}
	if _, err := scheduledworkout.Update(ctx, pool, otherCoach, created[0].ID, input); !errors.Is(err, scheduledworkout.ErrNotFound) {
		t.Fatalf("other coach edit error = %v, want ErrNotFound", err)
	}
	assertStoredSets(t, created[0].Exercises[0].ScheduledWorkoutExerciseID, []expectedSet{{position: 1, reps: intPtr(5)}})

	if _, err := scheduledworkout.Update(ctx, pool, otherCoach, uuid.NewString(), input); !errors.Is(err, scheduledworkout.ErrNotFound) {
		t.Fatalf("nonexistent id edit error = %v, want ErrNotFound", err)
	}
}

// TestUpdateRejectsInvalidPrescriptionWithoutMutation covers §B3's "no
// partial update if validation fails": an invalid incoming plan must be
// rejected before any row is touched.
func TestUpdateRejectsInvalidPrescriptionWithoutMutation(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	reps := 5
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " invalid-edit", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}

	badReps := 0 // reps must be at least 1
	input := scheduledworkout.UpdateInput{Exercises: []scheduledworkout.UpdateExerciseInput{{
		Name: prefix + " invalid-edit", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &badReps}},
	}}}
	_, err = scheduledworkout.Update(ctx, pool, coach, created[0].ID, input)
	var validationErr *scheduledworkout.ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("invalid prescription error = %v, want *ValidationError", err)
	}
	assertStoredSets(t, created[0].Exercises[0].ScheduledWorkoutExerciseID, []expectedSet{{position: 1, reps: intPtr(5)}})

	// Empty exercises list is also rejected without mutation.
	if _, err := scheduledworkout.Update(ctx, pool, coach, created[0].ID, scheduledworkout.UpdateInput{}); !errors.As(err, &validationErr) {
		t.Fatalf("empty exercises error = %v, want *ValidationError", err)
	}
	assertStoredSets(t, created[0].Exercises[0].ScheduledWorkoutExerciseID, []expectedSet{{position: 1, reps: intPtr(5)}})
}

// TestUpdateRollsBackOnPlannedSetInsertFailure forces a failure partway
// through the planned-set insert loop and asserts the original snapshot
// (parent row count and all its sets) is left exactly as it was — the
// transaction rollback leaves nothing half-replaced.
func TestUpdateRollsBackOnPlannedSetInsertFailure(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	reps := 5
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " rollback-edit", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}
	originalExerciseID := created[0].Exercises[0].ScheduledWorkoutExerciseID

	trigger := "scheduled_edit_fail_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	function := trigger + "_fn"
	functionSQL := fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.planned_position >= 3 THEN RAISE EXCEPTION 'forced edit planned-set failure'; END IF; RETURN NEW; END; $$`, function)
	if _, err := pool.Exec(ctx, functionSQL); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(ctx, fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON scheduled_workout_planned_sets", trigger))
		_, _ = pool.Exec(ctx, fmt.Sprintf("DROP FUNCTION IF EXISTS %s()", function))
	}()
	if _, err := pool.Exec(ctx, fmt.Sprintf("CREATE TRIGGER %s BEFORE INSERT ON scheduled_workout_planned_sets FOR EACH ROW EXECUTE FUNCTION %s()", trigger, function)); err != nil {
		t.Fatal(err)
	}

	newReps := 20
	input := scheduledworkout.UpdateInput{Exercises: []scheduledworkout.UpdateExerciseInput{{
		Name: prefix + " rollback-edit", Plan: prescription.Plan{SetCount: 4, Defaults: prescription.Defaults{Reps: &newReps}},
	}}}
	if _, err := scheduledworkout.Update(ctx, pool, coach, created[0].ID, input); err == nil {
		t.Fatal("Update succeeded despite forced planned-set failure")
	}

	// The original snapshot parent row (by id) and its two original sets are
	// intact — nothing was left half-replaced.
	assertSnapshotRows(t, created[0].ID, originalExerciseID, 2)
	assertStoredSets(t, originalExerciseID, []expectedSet{{position: 1, reps: intPtr(5)}, {position: 2, reps: intPtr(5)}})
}

// TestGetForCoachReadsSnapshotAndScopesToOwner covers the read side used to
// prefill the Coach Calendar Edit form: it returns the same snapshot Update
// would replace, includes the current session summary, and is scoped to the
// owning coach exactly like Update.
func TestGetForCoachReadsSnapshotAndScopesToOwner(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	owner, otherCoach, athlete := user(t, "COACH"), user(t, "COACH"), user(t, "ATHLETE")
	connect(t, owner, athlete)
	reps8 := 8
	load60 := 60.0
	kg := "kg"
	w := createWorkout(t, owner, []workout.CreateExerciseInput{{
		Name: prefix + " get-prefill", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps8, Load: &load60, Unit: &kg}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, owner, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-17",
	})
	if err != nil {
		t.Fatal(err)
	}

	got, err := scheduledworkout.GetForCoach(ctx, pool, owner, created[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if got.ID != created[0].ID || got.ScheduledDate != "2026-08-17" || got.Athlete.ID != athlete.ID || got.Workout.ID != w.ID || got.Session != nil {
		t.Fatalf("get header = %#v", got)
	}
	if len(got.Exercises) != 1 {
		t.Fatalf("get exercise count = %d, want 1", len(got.Exercises))
	}
	assertResolvedSets(t, got.Exercises[0].Plan.Sets, []expectedSet{
		{position: 1, reps: intPtr(8), load: floatPtr(60), unit: stringPtr("kg")},
		{position: 2, reps: intPtr(8), load: floatPtr(60), unit: stringPtr("kg")},
	})

	// An ACTIVE session is reflected, unlike POST/PUT's always-nil Session.
	sessionID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at) VALUES ($1, $2, $3, 'ACTIVE', now())`, sessionID, created[0].ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
	gotWithSession, err := scheduledworkout.GetForCoach(ctx, pool, owner, created[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if gotWithSession.Session == nil || gotWithSession.Session.ID != sessionID || gotWithSession.Session.Status != "ACTIVE" {
		t.Fatalf("get session = %#v", gotWithSession.Session)
	}

	if _, err := scheduledworkout.GetForCoach(ctx, pool, otherCoach, created[0].ID); !errors.Is(err, scheduledworkout.ErrNotFound) {
		t.Fatalf("other coach get error = %v, want ErrNotFound", err)
	}
	if _, err := scheduledworkout.GetForCoach(ctx, pool, owner, uuid.NewString()); !errors.Is(err, scheduledworkout.ErrNotFound) {
		t.Fatalf("nonexistent id get error = %v, want ErrNotFound", err)
	}
}

// assertStoredWorkoutExerciseSets reads workout_exercises directly (the
// reusable template, not a snapshot) and asserts its set count and reps
// default are unchanged.
func assertStoredWorkoutExerciseSets(t *testing.T, workoutExerciseID string, wantSets int, wantReps *int) {
	t.Helper()
	var sets int
	var reps *int
	if err := pool.QueryRow(context.Background(), `SELECT target_sets, target_reps FROM workout_exercises WHERE id = $1`, workoutExerciseID).Scan(&sets, &reps); err != nil {
		t.Fatal(err)
	}
	if sets != wantSets || !sameInt(reps, wantReps) {
		t.Fatalf("workout_exercises target_sets/target_reps = %d/%v, want %d/%v", sets, reps, wantSets, wantReps)
	}
}
