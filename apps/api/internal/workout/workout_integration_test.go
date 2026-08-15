package workout_test

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
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
)

var (
	pool       *pgxpool.Pool
	skipReason string
	prefix     = "workout-integration-" + uuid.NewString()
)

func TestMain(m *testing.M) {
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		skipReason = "TEST_DATABASE_URL is not set"
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

func TestCreatePersistsAuthoringPlanAndListReconstructsIt(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	var snapshotsBefore int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM scheduled_workout_planned_sets`).Scan(&snapshotsBefore); err != nil {
		t.Fatal(err)
	}
	reps10, reps8 := 10, 8
	load80, load90 := 80.0, 90.0
	rpe8, rpe9 := 8.0, 9.0
	kg := "kg"
	created, err := workout.Create(ctx, pool, coach, workout.CreateInput{Name: "  " + prefix + " Lower  ", Exercises: []workout.CreateExerciseInput{
		{Name: prefix + " Back Squat", Plan: prescription.Plan{SetCount: 5, Defaults: prescription.Defaults{Reps: &reps10, Load: &load80, Unit: &kg, RPE: &rpe8}, Overrides: []prescription.SetOverride{
			{Position: 5, Load: &load90, RPE: &rpe9}, {Position: 3, Reps: &reps8},
		}}},
		{Name: prefix + " Row", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps10}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if created.Name != prefix+" Lower" || len(created.Exercises) != 2 {
		t.Fatalf("created = %#v", created)
	}
	if created.Exercises[0].Position != 1 || created.Exercises[1].Position != 2 {
		t.Fatalf("exercise ordering = %#v", created.Exercises)
	}

	var sets int
	var gotReps *int
	var gotLoad *float64
	var gotUnit *string
	var gotRPE *float64
	if err := pool.QueryRow(ctx, `SELECT target_sets, target_reps, target_load, target_load_unit, target_rpe FROM workout_exercises WHERE id = $1`, created.Exercises[0].WorkoutExerciseID).Scan(&sets, &gotReps, &gotLoad, &gotUnit, &gotRPE); err != nil {
		t.Fatal(err)
	}
	if sets != 5 || *gotReps != 10 || *gotLoad != 80 || *gotUnit != "kg" || *gotRPE != 8 {
		t.Fatalf("defaults persisted as %d %#v %#v %#v %#v", sets, gotReps, gotLoad, gotUnit, gotRPE)
	}
	rows, err := pool.Query(ctx, `SELECT planned_position, reps_override, prescription_note_override, load_override, rpe_override FROM workout_exercise_set_overrides WHERE workout_exercise_id = $1 ORDER BY planned_position`, created.Exercises[0].WorkoutExerciseID)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var positions []int
	for rows.Next() {
		var pos int
		var reps *int
		var note *string
		var load *float64
		var rpe *float64
		if err := rows.Scan(&pos, &reps, &note, &load, &rpe); err != nil {
			t.Fatal(err)
		}
		positions = append(positions, pos)
		if pos == 3 && (reps == nil || *reps != 8 || note != nil || load != nil || rpe != nil) {
			t.Fatalf("sparse reps override = %#v %#v %#v %#v", reps, note, load, rpe)
		}
		if pos == 5 && (reps != nil || note != nil || load == nil || *load != 90 || rpe == nil || *rpe != 9) {
			t.Fatalf("sparse load/rpe override = %#v %#v %#v %#v", reps, note, load, rpe)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if fmt.Sprint(positions) != "[3 5]" {
		t.Fatalf("override ordering = %v", positions)
	}
	listed, err := workout.ListForCoach(ctx, pool, coach)
	if err != nil {
		t.Fatal(err)
	}
	got := findWorkout(t, listed, created.ID)
	if got.Exercises[0].Plan.SetCount != 5 || len(got.Exercises[0].Plan.Overrides) != 2 || got.Exercises[0].Plan.Overrides[0].Position != 3 || got.Exercises[0].Plan.Overrides[1].Position != 5 {
		t.Fatalf("authoring response = %#v", got.Exercises[0].Plan)
	}
	var snapshotsAfter int
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM scheduled_workout_planned_sets`).Scan(&snapshotsAfter); err != nil {
		t.Fatal(err)
	}
	if snapshotsAfter != snapshotsBefore {
		t.Fatalf("workout authoring changed scheduled snapshot count from %d to %d", snapshotsBefore, snapshotsAfter)
	}
}

func TestCreateSupportsTextDefaultsAndPrescriptionSwitchOverrides(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	reps10, reps8 := 10, 8
	amap, tempo := "AMAP", "3-1-1 tempo"
	created, err := workout.Create(ctx, pool, coach, workout.CreateInput{Name: prefix + " text", Exercises: []workout.CreateExerciseInput{
		{Name: prefix + " reps text", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps10}, Overrides: []prescription.SetOverride{{Position: 2, PrescriptionNote: &amap}}}},
		{Name: prefix + " text reps", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{PrescriptionNote: &tempo}, Overrides: []prescription.SetOverride{{Position: 2, Reps: &reps8}}}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if created.Exercises[0].Plan.Defaults.Reps == nil || created.Exercises[1].Plan.Defaults.PrescriptionNote == nil {
		t.Fatalf("text response = %#v", created)
	}
	var note *string
	var reps *int
	if err := pool.QueryRow(ctx, `SELECT prescription_note_override, reps_override FROM workout_exercise_set_overrides WHERE workout_exercise_id = $1`, created.Exercises[0].WorkoutExerciseID).Scan(&note, &reps); err != nil {
		t.Fatal(err)
	}
	if note == nil || *note != amap || reps != nil {
		t.Fatalf("reps to text override = %#v %#v", note, reps)
	}
	if err := pool.QueryRow(ctx, `SELECT prescription_note_override, reps_override FROM workout_exercise_set_overrides WHERE workout_exercise_id = $1`, created.Exercises[1].WorkoutExerciseID).Scan(&note, &reps); err != nil {
		t.Fatal(err)
	}
	if note != nil || reps == nil || *reps != 8 {
		t.Fatalf("text to reps override = %#v %#v", note, reps)
	}
}

func TestCreateAuthorizationAndValidation(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach, athlete := user(t, "COACH"), user(t, "ATHLETE")
	reps := 5
	valid := workout.CreateInput{Name: prefix + " valid", Exercises: []workout.CreateExerciseInput{{Name: prefix + " exercise", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}}}}}
	if _, err := workout.Create(ctx, pool, athlete, valid); !errors.Is(err, workout.ErrForbidden) {
		t.Fatalf("athlete create = %v", err)
	}
	if _, err := workout.ListForCoach(ctx, pool, athlete); !errors.Is(err, workout.ErrForbidden) {
		t.Fatalf("athlete list = %v", err)
	}
	invalid := valid
	invalid.Name = prefix + " invalid"
	invalid.Exercises[0].Plan.Defaults.Reps = nil
	if _, err := workout.Create(ctx, pool, coach, invalid); !isValidation(err) {
		t.Fatalf("invalid plan = %v", err)
	}
	legacy := workout.CreateInput{Name: prefix + " legacy", Exercises: []workout.CreateExerciseInput{{Name: prefix + " legacy exercise"}}}
	if _, err := workout.Create(ctx, pool, coach, legacy); !isValidation(err) {
		t.Fatalf("missing canonical plan = %v", err)
	}
}

func TestCreateRollsBackWhenOverrideInsertFails(t *testing.T) {
	requireDB(t)
	ctx := context.Background()
	coach := user(t, "COACH")
	trigger := "workout_override_fail_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	function := trigger + "_fn"
	if _, err := pool.Exec(ctx, fmt.Sprintf(`CREATE FUNCTION %s() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced override failure'; END; $$`, function)); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = pool.Exec(ctx, fmt.Sprintf("DROP TRIGGER IF EXISTS %s ON workout_exercise_set_overrides", trigger))
		_, _ = pool.Exec(ctx, fmt.Sprintf("DROP FUNCTION IF EXISTS %s()", function))
	}()
	if _, err := pool.Exec(ctx, fmt.Sprintf("CREATE TRIGGER %s BEFORE INSERT ON workout_exercise_set_overrides FOR EACH ROW EXECUTE FUNCTION %s()", trigger, function)); err != nil {
		t.Fatal(err)
	}
	reps, changed := 5, 4
	name := prefix + " rollback private"
	_, err := workout.Create(ctx, pool, coach, workout.CreateInput{Name: prefix + " rollback workout", Exercises: []workout.CreateExerciseInput{{Name: name, Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps}, Overrides: []prescription.SetOverride{{Position: 2, Reps: &changed}}}}}})
	if err == nil {
		t.Fatal("Create succeeded despite forced override persistence failure")
	}
	for _, query := range []string{
		`SELECT count(*) FROM workouts WHERE name = $1`,
		`SELECT count(*) FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.name = $1`,
		`SELECT count(*) FROM workout_exercise_set_overrides o JOIN workout_exercises we ON we.id = o.workout_exercise_id JOIN workouts w ON w.id = we.workout_id WHERE w.name = $1`,
		`SELECT count(*) FROM exercises WHERE owner_coach_id = $1 AND name = $2`,
	} {
		var count int
		var queryErr error
		if strings.Contains(query, "owner_coach_id") {
			queryErr = pool.QueryRow(ctx, query, coach.ID, name).Scan(&count)
		} else {
			queryErr = pool.QueryRow(ctx, query, prefix+" rollback workout").Scan(&count)
		}
		if queryErr != nil {
			t.Fatal(queryErr)
		}
		if count != 0 {
			t.Fatalf("rollback leak for %q: %d rows", query, count)
		}
	}
}

func requireDB(t *testing.T) {
	t.Helper()
	if skipReason != "" {
		t.Skip(skipReason)
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
func isValidation(err error) bool {
	var target *workout.ValidationError
	return errors.As(err, &target)
}
func findWorkout(t *testing.T, workouts []workout.Workout, id string) workout.Workout {
	t.Helper()
	for _, item := range workouts {
		if item.ID == id {
			return item
		}
	}
	t.Fatalf("workout %s not found", id)
	return workout.Workout{}
}
func cleanup(ctx context.Context) {
	if pool == nil {
		return
	}
	pattern := prefix + "%"
	_, _ = pool.Exec(ctx, `DELETE FROM workout_exercise_set_overrides WHERE workout_exercise_id IN (SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.name LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE $1)`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM workouts WHERE name LIKE $1`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM exercises WHERE name LIKE $1`, pattern)
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE firebase_uid LIKE $1`, pattern)
}
