package scheduledworkout_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
)

var (
	pool       *pgxpool.Pool
	skipReason string
	prefix     = "scheduledworkout-integration-" + uuid.NewString()
)

func TestMain(m *testing.M) {
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		skipReason = "TEST_DATABASE_URL is not set"
		os.Exit(m.Run())
	}
	if !strings.Contains(url, "/performance_coach_test") {
		skipReason = "TEST_DATABASE_URL must target performance_coach_test"
		os.Exit(m.Run())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var err error
	pool, err = pgxpool.New(ctx, url)
	if err != nil {
		skipReason = "cannot connect to TEST_DATABASE_URL"
		os.Exit(m.Run())
	}
	code := m.Run()
	cleanup(context.Background())
	pool.Close()
	os.Exit(code)
}

func TestCreateSnapshotsResolvedPlansForEachAthlete(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	athleteOne, athleteTwo := user(t, "ATHLETE"), user(t, "ATHLETE")
	connect(t, coach, athleteOne)
	connect(t, coach, athleteTwo)

	reps10, reps8 := 10, 8
	load80, load90 := 80.0, 90.0
	rpe8, rpe9 := 8.0, 9.0
	kg := "kg"
	w := createWorkout(t, coach, []workout.CreateExerciseInput{
		{Name: prefix + " complex", Plan: prescription.Plan{SetCount: 5, Defaults: prescription.Defaults{Reps: &reps10, Load: &load80, Unit: &kg, RPE: &rpe8}, Overrides: []prescription.SetOverride{
			{Position: 5, Load: &load90}, {Position: 3, Reps: &reps8}, {Position: 4, RPE: &rpe9},
		}}},
		{Name: prefix + " uniform", Plan: prescription.Plan{SetCount: 5, Defaults: prescription.Defaults{Reps: &reps10, Load: &load80, Unit: &kg, RPE: &rpe8}}},
	})

	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athleteOne.ID, athleteTwo.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 2 || created[0].Athlete.ID != athleteOne.ID || created[1].Athlete.ID != athleteTwo.ID {
		t.Fatalf("created athletes = %#v", created)
	}
	for _, item := range created {
		if len(item.Exercises) != 2 || item.Exercises[0].Position != 1 || item.Exercises[1].Position != 2 {
			t.Fatalf("exercise response ordering = %#v", item.Exercises)
		}
		assertResolvedSets(t, item.Exercises[0].Plan.Sets, []expectedSet{
			{position: 1, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
			{position: 2, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
			{position: 3, reps: intPtr(8), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
			{position: 4, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(9)},
			{position: 5, reps: intPtr(10), load: floatPtr(90), unit: stringPtr("kg"), rpe: floatPtr(8)},
		})
		assertResolvedSets(t, item.Exercises[1].Plan.Sets, []expectedSet{
			{position: 1, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
			{position: 2, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
			{position: 3, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
			{position: 4, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
			{position: 5, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
		})
	}

	first, second := created[0].Exercises[0], created[1].Exercises[0]
	if first.ScheduledWorkoutExerciseID == second.ScheduledWorkoutExerciseID || first.Plan.Sets[0].ScheduledWorkoutPlannedSetID == second.Plan.Sets[0].ScheduledWorkoutPlannedSetID {
		t.Fatal("multi-athlete snapshots reused an ID")
	}
	assertSnapshotRows(t, created[0].ID, first.ScheduledWorkoutExerciseID, 5)
	assertSnapshotRows(t, created[1].ID, second.ScheduledWorkoutExerciseID, 5)
	assertCompatibilityParent(t, first.ScheduledWorkoutExerciseID, 5, 10, nil, 8, "kg")
	assertNoExecutionRows(t, []string{created[0].ID, created[1].ID})
}

func TestCreateSnapshotsTextPrescriptionSwitches(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	reps10, reps8 := 10, 8
	amap, tempo := "AMAP", "3-1-1 tempo"
	w := createWorkout(t, coach, []workout.CreateExerciseInput{
		{Name: prefix + " reps-to-text", Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps10}, Overrides: []prescription.SetOverride{{Position: 3, PrescriptionNote: &amap}}}},
		{Name: prefix + " text-to-reps", Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{PrescriptionNote: &tempo}, Overrides: []prescription.SetOverride{{Position: 2, Reps: &reps8}}}},
	})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16"})
	if err != nil {
		t.Fatal(err)
	}
	assertResolvedSets(t, created[0].Exercises[0].Plan.Sets, []expectedSet{
		{position: 1, reps: intPtr(10)}, {position: 2, reps: intPtr(10)}, {position: 3, note: stringPtr("AMAP")},
	})
	assertResolvedSets(t, created[0].Exercises[1].Plan.Sets, []expectedSet{
		{position: 1, note: stringPtr("3-1-1 tempo")}, {position: 2, reps: intPtr(8)}, {position: 3, note: stringPtr("3-1-1 tempo")},
	})
}

func TestCreateSnapshotIsImmutableAfterTemplateMutation(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	reps10, reps8, reps12 := 10, 8, 12
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " immutable", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps10}, Overrides: []prescription.SetOverride{{Position: 2, Reps: &reps8}}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE workout_exercises SET target_reps = $1 WHERE id = $2`, reps12, w.Exercises[0].WorkoutExerciseID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE workout_exercise_set_overrides SET reps_override = $1 WHERE workout_exercise_id = $2 AND planned_position = 2`, reps12, w.Exercises[0].WorkoutExerciseID); err != nil {
		t.Fatal(err)
	}
	assertStoredSets(t, created[0].Exercises[0].ScheduledWorkoutExerciseID, []expectedSet{{position: 1, reps: intPtr(10)}, {position: 2, reps: intPtr(8)}})
}

func TestListForAthleteReadsCanonicalFrozenPlannedSets(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	athlete, otherAthlete := user(t, "ATHLETE"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	connect(t, coach, otherAthlete)

	reps10, reps8 := 10, 8
	load80, load85 := 80.0, 85.0
	rpe8, rpe9 := 8.0, 9.0
	kg := "kg"
	seconds, repRange := "30 sec", "10–12"
	w := createWorkout(t, coach, []workout.CreateExerciseInput{
		{Name: prefix + " today varied", Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps10, Load: &load80, Unit: &kg, RPE: &rpe8}, Overrides: []prescription.SetOverride{{Position: 3, Reps: &reps8, Load: &load85, RPE: &rpe9}}}},
		{Name: prefix + " today text", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{PrescriptionNote: &seconds}, Overrides: []prescription.SetOverride{{Position: 2, PrescriptionNote: &repRange}}}},
	})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID, otherAthlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}
	athleteScheduled, otherScheduled := created[0], created[1]

	// Deliberately poison compatibility-only scalar columns and the live
	// template. Today must still return the immutable planned-set rows above.
	if _, err := pool.Exec(ctx, `UPDATE scheduled_workout_exercises SET target_sets = 1, target_reps = 1, target_prescription_note = NULL, target_rpe = 1 WHERE scheduled_workout_id = $1`, athleteScheduled.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `UPDATE workout_exercises SET target_reps = 1, target_prescription_note = NULL, target_rpe = 1 WHERE workout_id = $1`, w.ID); err != nil {
		t.Fatal(err)
	}

	got, err := scheduledworkout.ListForAthlete(ctx, pool, athlete, time.Date(2026, time.August, 16, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].ID != athleteScheduled.ID || got[0].WorkoutName != w.Name || got[0].Session != nil {
		t.Fatalf("today result = %#v", got)
	}
	if len(got[0].Exercises) != 2 || got[0].Exercises[0].Position != 1 || got[0].Exercises[1].Position != 2 {
		t.Fatalf("today exercise ordering = %#v", got[0].Exercises)
	}

	varied := got[0].Exercises[0]
	if varied.ScheduledWorkoutExerciseID != athleteScheduled.Exercises[0].ScheduledWorkoutExerciseID || varied.ExerciseID != athleteScheduled.Exercises[0].ExerciseID || varied.Name != athleteScheduled.Exercises[0].Name {
		t.Fatalf("today varied exercise identity = %#v", varied)
	}
	assertResolvedSets(t, varied.Plan.Sets, []expectedSet{
		{position: 1, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
		{position: 2, reps: intPtr(10), load: floatPtr(80), unit: stringPtr("kg"), rpe: floatPtr(8)},
		{position: 3, reps: intPtr(8), load: floatPtr(85), unit: stringPtr("kg"), rpe: floatPtr(9)},
	})
	for i, planned := range varied.Plan.Sets {
		if planned.ScheduledWorkoutPlannedSetID != athleteScheduled.Exercises[0].Plan.Sets[i].ScheduledWorkoutPlannedSetID {
			t.Fatalf("today planned-set ID %d = %q, want %q", i, planned.ScheduledWorkoutPlannedSetID, athleteScheduled.Exercises[0].Plan.Sets[i].ScheduledWorkoutPlannedSetID)
		}
	}

	text := got[0].Exercises[1]
	assertResolvedSets(t, text.Plan.Sets, []expectedSet{
		{position: 1, note: stringPtr("30 sec")},
		{position: 2, note: stringPtr("10–12")},
	})

	otherGot, err := scheduledworkout.ListForAthlete(ctx, pool, otherAthlete, time.Date(2026, time.August, 16, 0, 0, 0, 0, time.UTC))
	if err != nil {
		t.Fatal(err)
	}
	if len(otherGot) != 1 || otherGot[0].ID != otherScheduled.ID {
		t.Fatalf("other athlete today result = %#v", otherGot)
	}
	if _, err := scheduledworkout.ListForAthlete(ctx, pool, coach, time.Date(2026, time.August, 16, 0, 0, 0, 0, time.UTC)); !errors.Is(err, scheduledworkout.ErrForbidden) {
		t.Fatalf("coach ListForAthlete error = %v", err)
	}
}

func TestListForAthletePreservesSessionSummary(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	reps := 5
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{
		Name: prefix + " today session", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}},
	}})
	created, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{
		WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16",
	})
	if err != nil {
		t.Fatal(err)
	}

	date := time.Date(2026, time.August, 16, 0, 0, 0, 0, time.UTC)
	assertTodaySession(t, athlete, date, nil)

	activeID := uuid.NewString()
	if _, err := pool.Exec(ctx, `INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at) VALUES ($1, $2, $3, 'ACTIVE', now())`, activeID, created[0].ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
	assertTodaySession(t, athlete, date, &scheduledworkout.Session{ID: activeID, Status: "ACTIVE"})

	if _, err := pool.Exec(ctx, `UPDATE workout_sessions SET status = 'COMPLETED', completed_at = now() WHERE id = $1`, activeID); err != nil {
		t.Fatal(err)
	}
	assertTodaySession(t, athlete, date, &scheduledworkout.Session{ID: activeID, Status: "COMPLETED"})
}

func TestCreateRollsBackBatchWhenPlannedSetInsertFails(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	athleteOne, athleteTwo := user(t, "ATHLETE"), user(t, "ATHLETE")
	connect(t, coach, athleteOne)
	connect(t, coach, athleteTwo)
	reps := 5
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{Name: prefix + " rollback", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}}}})
	trigger := "scheduled_planned_set_fail_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	function := trigger + "_fn"
	functionSQL := fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF (SELECT count(*) FROM scheduled_workouts WHERE workout_id = '%s') >= 2 THEN RAISE EXCEPTION 'forced planned-set failure'; END IF; RETURN NEW; END; $$`, function, w.ID)
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
	_, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athleteOne.ID, athleteTwo.ID}, ScheduledDate: "2026-08-16"})
	if err == nil {
		t.Fatal("Create succeeded despite forced planned-set failure")
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE workout_id = $1`, w.ID, 0)
	assertCount(t, `SELECT count(*) FROM scheduled_workout_exercises swe JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id WHERE sw.workout_id = $1`, w.ID, 0)
	assertCount(t, `SELECT count(*) FROM scheduled_workout_planned_sets p JOIN scheduled_workout_exercises swe ON swe.id = p.scheduled_workout_exercise_id JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id WHERE sw.workout_id = $1`, w.ID, 0)
}

func TestCreateRejectsInvalidStoredTemplateWithoutScheduling(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	connect(t, coach, athlete)
	reps, rpe := 5, 8.0
	w := createWorkout(t, coach, []workout.CreateExerciseInput{{Name: prefix + " invalid", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}}}})
	if _, err := pool.Exec(ctx, `INSERT INTO workout_exercise_set_overrides (id, workout_exercise_id, planned_position, rpe_override) VALUES ($1, $2, $3, $4)`, uuid.NewString(), w.Exercises[0].WorkoutExerciseID, 2, rpe); err != nil {
		t.Fatal(err)
	}
	_, err := scheduledworkout.Create(ctx, pool, coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16"})
	if !errors.Is(err, scheduledworkout.ErrInvalidStoredPrescription) {
		t.Fatalf("Create error = %v, want invalid stored prescription", err)
	}
	var validationErr *scheduledworkout.ValidationError
	if errors.As(err, &validationErr) {
		t.Fatalf("stored template error leaked as validation error: %v", err)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE workout_id = $1`, w.ID, 0)
}

func TestCreateRejectsOtherCoachWorkoutAndUnrelatedAthlete(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	owner, otherCoach, athlete := user(t, "COACH"), user(t, "COACH"), user(t, "ATHLETE")
	reps := 5
	w := createWorkout(t, owner, []workout.CreateExerciseInput{{Name: prefix + " protected", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}}}})
	if _, err := scheduledworkout.Create(ctx, pool, otherCoach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16"}); !errors.Is(err, scheduledworkout.ErrWorkoutNotFound) {
		t.Fatalf("other coach error = %v", err)
	}
	if _, err := scheduledworkout.Create(ctx, pool, owner, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16"}); !errors.Is(err, scheduledworkout.ErrAthletesNotConnected) {
		t.Fatalf("unrelated athlete error = %v", err)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workouts WHERE workout_id = $1`, w.ID, 0)
}

type expectedSet struct {
	position int
	reps     *int
	note     *string
	load     *float64
	unit     *string
	rpe      *float64
}

func assertResolvedSets(t *testing.T, got []scheduledworkout.PlannedSet, want []expectedSet) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("planned set count = %d, want %d", len(got), len(want))
	}
	for i, expected := range want {
		actual := got[i]
		if actual.ScheduledWorkoutPlannedSetID == "" || actual.Position != expected.position || !sameInt(actual.Reps, expected.reps) || !sameString(actual.PrescriptionNote, expected.note) || !sameFloat(actual.Load, expected.load) || !sameString(actual.Unit, expected.unit) || !sameFloat(actual.RPE, expected.rpe) {
			t.Fatalf("planned set %d = %#v, want %#v", i, actual, expected)
		}
		if (actual.Reps == nil) == (actual.PrescriptionNote == nil) {
			t.Fatalf("planned set %d does not contain exactly one prescription form: %#v", i, actual)
		}
	}
}

func assertStoredSets(t *testing.T, scheduledWorkoutExerciseID string, want []expectedSet) {
	t.Helper()
	rows, err := pool.Query(context.Background(), `SELECT planned_position, target_reps, target_prescription_note, target_load, target_rpe FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id = $1 ORDER BY planned_position`, scheduledWorkoutExerciseID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	got := make([]expectedSet, 0, len(want))
	for rows.Next() {
		var set expectedSet
		if err := rows.Scan(&set.position, &set.reps, &set.note, &set.load, &set.rpe); err != nil {
			t.Fatal(err)
		}
		got = append(got, set)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if len(got) != len(want) {
		t.Fatalf("stored set count = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i].position != want[i].position || !sameInt(got[i].reps, want[i].reps) || !sameString(got[i].note, want[i].note) || !sameFloat(got[i].load, want[i].load) || !sameFloat(got[i].rpe, want[i].rpe) {
			t.Fatalf("stored set %d = %#v, want %#v", i, got[i], want[i])
		}
	}
}

func assertSnapshotRows(t *testing.T, scheduledWorkoutID, scheduledWorkoutExerciseID string, want int) {
	t.Helper()
	var parentCount int
	if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM scheduled_workout_exercises WHERE id = $1 AND scheduled_workout_id = $2`, scheduledWorkoutExerciseID, scheduledWorkoutID).Scan(&parentCount); err != nil {
		t.Fatal(err)
	}
	if parentCount != 1 {
		t.Fatalf("snapshot parent count = %d, want 1", parentCount)
	}
	assertCount(t, `SELECT count(*) FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id = $1`, scheduledWorkoutExerciseID, want)
}

func assertCompatibilityParent(t *testing.T, id string, sets, reps int, note *string, rpe float64, unit string) {
	t.Helper()
	var actualSets int
	var actualReps *int
	var actualNote, actualUnit *string
	var actualRPE *float64
	if err := pool.QueryRow(context.Background(), `SELECT target_sets, target_reps, target_prescription_note, target_rpe, target_load_unit FROM scheduled_workout_exercises WHERE id = $1`, id).Scan(&actualSets, &actualReps, &actualNote, &actualRPE, &actualUnit); err != nil {
		t.Fatal(err)
	}
	if actualSets != sets || !sameInt(actualReps, intPtr(reps)) || !sameString(actualNote, note) || !sameFloat(actualRPE, floatPtr(rpe)) || !sameString(actualUnit, stringPtr(unit)) {
		t.Fatalf("compatibility parent = %d %#v %#v %#v %#v", actualSets, actualReps, actualNote, actualRPE, actualUnit)
	}
}

func assertNoExecutionRows(t *testing.T, scheduledWorkoutIDs []string) {
	t.Helper()
	assertCount(t, `SELECT count(*) FROM workout_sessions WHERE scheduled_workout_id = ANY($1)`, scheduledWorkoutIDs, 0)
	assertCount(t, `SELECT count(*) FROM set_logs sl JOIN scheduled_workout_exercises swe ON swe.id = sl.scheduled_workout_exercise_id WHERE swe.scheduled_workout_id = ANY($1)`, scheduledWorkoutIDs, 0)
}

func assertTodaySession(t *testing.T, athlete authn.User, date time.Time, want *scheduledworkout.Session) {
	t.Helper()
	got, err := scheduledworkout.ListForAthlete(context.Background(), pool, athlete, date)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("today scheduled workout count = %d, want 1", len(got))
	}
	if want == nil {
		if got[0].Session != nil {
			t.Fatalf("today session = %#v, want nil", got[0].Session)
		}
		return
	}
	if got[0].Session == nil || got[0].Session.ID != want.ID || got[0].Session.Status != want.Status {
		t.Fatalf("today session = %#v, want %#v", got[0].Session, want)
	}
}

func assertCount(t *testing.T, query string, arg any, want int) {
	t.Helper()
	var got int
	if err := pool.QueryRow(context.Background(), query, arg).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("count query = %d, want %d", got, want)
	}
}

func createWorkout(t *testing.T, coach authn.User, exercises []workout.CreateExerciseInput) workout.Workout {
	t.Helper()
	w, err := workout.Create(context.Background(), pool, coach, workout.CreateInput{Name: prefix + " workout " + uuid.NewString(), Exercises: exercises})
	if err != nil {
		t.Fatal(err)
	}
	return w
}

func connect(t *testing.T, coach, athlete authn.User) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1, $2)`, coach.ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
}

func user(t *testing.T, role string) authn.User {
	t.Helper()
	u := authn.User{ID: uuid.NewString(), FirebaseUID: prefix + "-uid-" + uuid.NewString(), Name: prefix, Role: role}
	if _, err := pool.Exec(context.Background(), `INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1, $2, $3, $4, now())`, u.ID, u.FirebaseUID, u.Name, u.Role); err != nil {
		t.Fatal(err)
	}
	return u
}

func requireDB(t *testing.T) {
	t.Helper()
	if skipReason != "" {
		t.Skip(skipReason)
	}
}

func cleanup(ctx context.Context) {
	if pool == nil {
		return
	}
	pattern := prefix + "%"
	_, _ = pool.Exec(ctx, `DELETE FROM set_logs WHERE session_id IN (SELECT id FROM workout_sessions WHERE scheduled_workout_id IN (SELECT id FROM scheduled_workouts WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE $1)))`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM workout_sessions WHERE scheduled_workout_id IN (SELECT id FROM scheduled_workouts WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE $1))`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id IN (SELECT swe.id FROM scheduled_workout_exercises swe JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id JOIN workouts w ON w.id = sw.workout_id WHERE w.name LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM scheduled_workout_exercises WHERE scheduled_workout_id IN (SELECT sw.id FROM scheduled_workouts sw JOIN workouts w ON w.id = sw.workout_id WHERE w.name LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM scheduled_workouts WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM workout_exercise_set_overrides WHERE workout_exercise_id IN (SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.name LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM workouts WHERE name LIKE $1`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM exercises WHERE name LIKE $1`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM coach_athletes WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1) OR athlete_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE firebase_uid LIKE $1`, pattern)
}

func intPtr(value int) *int           { return &value }
func floatPtr(value float64) *float64 { return &value }
func stringPtr(value string) *string  { return &value }
func sameInt(left, right *int) bool {
	return (left == nil && right == nil) || (left != nil && right != nil && *left == *right)
}
func sameFloat(left, right *float64) bool {
	return (left == nil && right == nil) || (left != nil && right != nil && *left == *right)
}
func sameString(left, right *string) bool {
	return (left == nil && right == nil) || (left != nil && right != nil && *left == *right)
}
