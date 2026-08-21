package workoutsession_test

import (
	"context"
	"errors"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

var (
	integrationPool       *pgxpool.Pool
	integrationSkipReason string
	integrationPrefix     = "workoutsession-integration-" + uuid.NewString()
)

func TestMain(m *testing.M) {
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		integrationSkipReason = "TEST_DATABASE_URL is not set"
		os.Exit(m.Run())
	}
	if !strings.Contains(url, "/performance_coach_test") {
		integrationSkipReason = "TEST_DATABASE_URL must target performance_coach_test"
		os.Exit(m.Run())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var err error
	integrationPool, err = pgxpool.New(ctx, url)
	if err != nil {
		integrationSkipReason = "cannot connect to TEST_DATABASE_URL"
		os.Exit(m.Run())
	}

	code := m.Run()
	cleanupIntegration(ctx)
	integrationPool.Close()
	os.Exit(code)
}

func TestGetReturnsFrozenPlannedTargetsAndActualAssociations(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	reps10, reps8 := 10, 8
	load80, rpe8 := 80.0, 8.0
	amap, kg := "AMAP", "kg"
	setup := newSession(t, []workout.CreateExerciseInput{{
		Name: integrationPrefix + " frozen",
		Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps10, Load: &load80, Unit: &kg, RPE: &rpe8}, Overrides: []prescription.SetOverride{
			{Position: 2, Reps: &reps8},
			{Position: 3, PrescriptionNote: &amap},
		}},
	}})
	exercise := setup.created.Exercises[0]
	plannedOne, plannedThree := exercise.Plan.Sets[0], exercise.Plan.Sets[2]

	actualLoad, actualRPE, actualReps, actualUnit := 82.5, 9.0, 7, "lb"
	first, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(exercise.ScheduledWorkoutExerciseID, plannedThree.ScheduledWorkoutPlannedSetID, &actualLoad, &actualUnit, &actualReps, &actualRPE))
	if err != nil {
		t.Fatal(err)
	}
	if first.Kind != "PLANNED" || first.SetNumber != 1 || first.PlannedPosition == nil || *first.PlannedPosition != 3 {
		t.Fatalf("first planned log = %#v", first)
	}

	second, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(exercise.ScheduledWorkoutExerciseID, plannedOne.ScheduledWorkoutPlannedSetID, nil, nil, intPtr(10), nil))
	if err != nil {
		t.Fatal(err)
	}
	if second.SetNumber != 2 || second.PlannedPosition == nil || *second.PlannedPosition != 1 {
		t.Fatalf("second planned log = %#v", second)
	}

	extra, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, extraInput(exercise.ScheduledWorkoutExerciseID, intPtr(8)))
	if err != nil {
		t.Fatal(err)
	}
	if extra.Kind != "EXTRA" || extra.SetNumber != 3 || extra.ScheduledWorkoutPlannedSetID != nil || extra.PlannedPosition != nil {
		t.Fatalf("extra log = %#v", extra)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(exercise.ScheduledWorkoutExerciseID, exercise.Plan.Sets[1].ScheduledWorkoutPlannedSetID, nil, nil, intPtr(8), nil)); err != nil {
		t.Fatal(err)
	}
	extraAfterAllPlanned, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, extraInput(exercise.ScheduledWorkoutExerciseID, intPtr(6)))
	if err != nil {
		t.Fatal(err)
	}
	if extraAfterAllPlanned.Kind != "EXTRA" || extraAfterAllPlanned.SetNumber != 5 {
		t.Fatalf("extra after all planned targets = %#v", extraAfterAllPlanned)
	}

	if _, err := integrationPool.Exec(ctx, `UPDATE workout_exercises SET target_reps = $1 WHERE id = $2`, 99, setup.workout.Exercises[0].WorkoutExerciseID); err != nil {
		t.Fatal(err)
	}

	detail, err := workoutsession.Get(ctx, integrationPool, setup.athlete, setup.session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(detail.Exercises) != 1 || len(detail.Exercises[0].Plan.Sets) != 3 {
		t.Fatalf("detail exercises = %#v", detail.Exercises)
	}
	sets := detail.Exercises[0].Plan.Sets
	if sets[0].Position != 1 || valueInt(sets[0].Reps) != 10 || valueFloat(sets[0].Load) != 80 || valueString(sets[0].Unit) != "kg" || valueFloat(sets[0].RPE) != 8 {
		t.Fatalf("first frozen target = %#v", sets[0])
	}
	if sets[1].Position != 2 || valueInt(sets[1].Reps) != 8 || sets[1].PrescriptionNote != nil {
		t.Fatalf("second frozen target = %#v", sets[1])
	}
	if sets[2].Position != 3 || sets[2].Reps != nil || valueString(sets[2].PrescriptionNote) != "AMAP" {
		t.Fatalf("text frozen target = %#v", sets[2])
	}

	logs := detail.Exercises[0].SetLogs
	if len(logs) != 5 || logs[0].Kind != "PLANNED" || valueInt(logs[0].PlannedPosition) != 3 || logs[0].SetNumber != 1 || valueFloat(logs[0].Load) != 82.5 || valueString(logs[0].Unit) != "lb" || logs[0].Reps != 7 || logs[1].Kind != "PLANNED" || valueInt(logs[1].PlannedPosition) != 1 || logs[1].SetNumber != 2 || logs[2].Kind != "EXTRA" || logs[2].ScheduledWorkoutPlannedSetID != nil || logs[2].PlannedPosition != nil || logs[2].SetNumber != 3 || logs[3].Kind != "PLANNED" || valueInt(logs[3].PlannedPosition) != 2 || logs[3].SetNumber != 4 || logs[4].Kind != "EXTRA" || logs[4].SetNumber != 5 {
		t.Fatalf("actual logs = %#v", logs)
	}
}

func TestCreateSetLogValidationClaimsAuthorizationAndCompletion(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	reps := 5
	setup := newSession(t, []workout.CreateExerciseInput{
		{Name: integrationPrefix + " validation one", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps}}},
		{Name: integrationPrefix + " validation two", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}}},
	})
	exerciseOne, exerciseTwo := setup.created.Exercises[0], setup.created.Exercises[1]

	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, workoutsession.CreateSetLogInput{Kind: "INVALID", ScheduledWorkoutExerciseID: exerciseOne.ScheduledWorkoutExerciseID, Reps: intPtr(5)}); !isValidationError(err) {
		t.Fatalf("invalid kind error = %v", err)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, workoutsession.CreateSetLogInput{Kind: "PLANNED", ScheduledWorkoutExerciseID: exerciseOne.ScheduledWorkoutExerciseID, Reps: intPtr(5)}); !isValidationError(err) {
		t.Fatalf("PLANNED without target error = %v", err)
	}
	wrongTarget := exerciseTwo.Plan.Sets[0].ScheduledWorkoutPlannedSetID
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, workoutsession.CreateSetLogInput{Kind: "EXTRA", ScheduledWorkoutExerciseID: exerciseOne.ScheduledWorkoutExerciseID, ScheduledWorkoutPlannedSetID: &wrongTarget, Reps: intPtr(5)}); !isValidationError(err) {
		t.Fatalf("EXTRA with target error = %v", err)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(exerciseOne.ScheduledWorkoutExerciseID, wrongTarget, nil, nil, intPtr(5), nil)); !errors.Is(err, workoutsession.ErrPlannedSetNotInSession) {
		t.Fatalf("cross-exercise target error = %v", err)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, extraInput(uuid.NewString(), intPtr(5))); !errors.Is(err, workoutsession.ErrExerciseNotInSession) {
		t.Fatalf("exercise outside session error = %v", err)
	}

	otherAthlete := integrationUser(t, "ATHLETE")
	integrationConnect(t, setup.coach, otherAthlete)
	otherCreated, err := scheduledworkout.Create(ctx, integrationPool, setup.coach, scheduledworkout.CreateInput{WorkoutID: setup.workout.ID, AthleteIDs: []string{otherAthlete.ID}, ScheduledDate: "2026-08-17"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(exerciseOne.ScheduledWorkoutExerciseID, otherCreated[0].Exercises[0].Plan.Sets[0].ScheduledWorkoutPlannedSetID, nil, nil, intPtr(5), nil)); !errors.Is(err, workoutsession.ErrPlannedSetNotInSession) {
		t.Fatalf("cross-session target error = %v", err)
	}

	plannedID := exerciseOne.Plan.Sets[0].ScheduledWorkoutPlannedSetID
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(exerciseOne.ScheduledWorkoutExerciseID, plannedID, nil, nil, intPtr(5), nil)); err != nil {
		t.Fatal(err)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, plannedInput(exerciseOne.ScheduledWorkoutExerciseID, plannedID, nil, nil, intPtr(5), nil)); !errors.Is(err, workoutsession.ErrPlannedSetAlreadyLogged) {
		t.Fatalf("duplicate planned target error = %v", err)
	}

	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.coach, setup.session.ID, extraInput(exerciseOne.ScheduledWorkoutExerciseID, intPtr(6))); err != nil {
		t.Fatalf("connected coach extra log: %v", err)
	}
	unrelated := integrationUser(t, "ATHLETE")
	if _, err := workoutsession.Get(ctx, integrationPool, unrelated, setup.session.ID); !errors.Is(err, workoutsession.ErrNotFound) {
		t.Fatalf("unrelated read error = %v", err)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, unrelated, setup.session.ID, extraInput(exerciseOne.ScheduledWorkoutExerciseID, intPtr(6))); !errors.Is(err, workoutsession.ErrNotFound) {
		t.Fatalf("unrelated write error = %v", err)
	}

	if _, err := workoutsession.Complete(ctx, integrationPool, setup.athlete, setup.session.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := workoutsession.CreateSetLog(ctx, integrationPool, setup.athlete, setup.session.ID, extraInput(exerciseOne.ScheduledWorkoutExerciseID, intPtr(6))); !errors.Is(err, workoutsession.ErrSessionNotActive) {
		t.Fatalf("completed session error = %v", err)
	}
}

func TestCreateSetLogConcurrency(t *testing.T) {
	requireIntegrationDB(t)
	reps := 5
	setup := newSession(t, []workout.CreateExerciseInput{{Name: integrationPrefix + " concurrency", Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps}}}})
	exercise := setup.created.Exercises[0]

	results := concurrentlyCreate(t, setup.athlete, setup.session.ID,
		plannedInput(exercise.ScheduledWorkoutExerciseID, exercise.Plan.Sets[0].ScheduledWorkoutPlannedSetID, nil, nil, intPtr(5), nil),
		plannedInput(exercise.ScheduledWorkoutExerciseID, exercise.Plan.Sets[0].ScheduledWorkoutPlannedSetID, nil, nil, intPtr(5), nil),
	)
	if successCount(results) != 1 || conflictCount(results, workoutsession.ErrPlannedSetAlreadyLogged) != 1 {
		t.Fatalf("same-target results = %#v", results)
	}

	secondSetup := newSession(t, []workout.CreateExerciseInput{{Name: integrationPrefix + " chronology", Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps}}}})
	secondExercise := secondSetup.created.Exercises[0]
	results = concurrentlyCreate(t, secondSetup.athlete, secondSetup.session.ID,
		plannedInput(secondExercise.ScheduledWorkoutExerciseID, secondExercise.Plan.Sets[0].ScheduledWorkoutPlannedSetID, nil, nil, intPtr(5), nil),
		plannedInput(secondExercise.ScheduledWorkoutExerciseID, secondExercise.Plan.Sets[1].ScheduledWorkoutPlannedSetID, nil, nil, intPtr(5), nil),
	)
	if successCount(results) != 2 {
		t.Fatalf("different-target results = %#v", results)
	}
	numbers := []int{results[0].setLog.SetNumber, results[1].setLog.SetNumber}
	sort.Ints(numbers)
	if numbers[0] != 1 || numbers[1] != 2 {
		t.Fatalf("chronology set numbers = %v", numbers)
	}
}

// TestStartSerializesWithConcurrentScheduledWorkoutLock covers the
// concurrency guarantee documented on Start: it locks the same
// scheduled_workouts row `FOR UPDATE OF sw` that scheduledworkout.Update
// locks, so the two can never interleave. Rather than racing against
// Update's own (fast, hard-to-pause) transaction, this test holds that
// exact lock directly — simulating Update mid-flight — and asserts Start
// blocks for as long as the lock is held, then proceeds the moment it is
// released.
func TestStartSerializesWithConcurrentScheduledWorkoutLock(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach, athlete := integrationUser(t, "COACH"), integrationUser(t, "ATHLETE")
	integrationConnect(t, coach, athlete)
	reps := 5
	w, err := workout.Create(ctx, integrationPool, coach, workout.CreateInput{
		Name:      integrationPrefix + " lock",
		Exercises: []workout.CreateExerciseInput{{Name: integrationPrefix + " lock exercise", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}}}},
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := scheduledworkout.Create(ctx, integrationPool, coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16"})
	if err != nil {
		t.Fatal(err)
	}
	scheduledWorkoutID := created[0].ID

	lockTx, err := integrationPool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	var lockedAthleteID string
	if err := lockTx.QueryRow(ctx, `SELECT athlete_id FROM scheduled_workouts WHERE id = $1 FOR UPDATE`, scheduledWorkoutID).Scan(&lockedAthleteID); err != nil {
		t.Fatal(err)
	}

	startReturned := make(chan error, 1)
	go func() {
		_, _, err := workoutsession.Start(context.Background(), integrationPool, athlete, scheduledWorkoutID)
		startReturned <- err
	}()

	select {
	case err := <-startReturned:
		t.Fatalf("Start returned (err=%v) while a concurrent transaction still held the scheduled_workouts row lock", err)
	case <-time.After(300 * time.Millisecond):
		// Expected: Start is blocked waiting for the lock.
	}

	if err := lockTx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}

	select {
	case err := <-startReturned:
		if err != nil {
			t.Fatalf("Start after lock release: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("Start did not proceed after the competing lock was released")
	}
}

func TestGetClassifiesLegacyLinkedAndExtraLogs(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	reps := 5
	setup := newSession(t, []workout.CreateExerciseInput{{Name: integrationPrefix + " legacy", Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps}}}})
	exercise := setup.created.Exercises[0]
	plannedID := exercise.Plan.Sets[0].ScheduledWorkoutPlannedSetID
	if _, err := integrationPool.Exec(ctx, `INSERT INTO set_logs (id, session_id, scheduled_workout_exercise_id, scheduled_workout_planned_set_id, set_number, load, unit, reps, rpe, logged_by_user_id, created_at) VALUES ($1, $2, $3, $4, 1, NULL, NULL, 5, NULL, $5, now()), ($6, $2, $3, NULL, 2, NULL, NULL, 4, NULL, $5, now())`, uuid.NewString(), setup.session.ID, exercise.ScheduledWorkoutExerciseID, plannedID, setup.athlete.ID, uuid.NewString()); err != nil {
		t.Fatal(err)
	}
	detail, err := workoutsession.Get(ctx, integrationPool, setup.athlete, setup.session.ID)
	if err != nil {
		t.Fatal(err)
	}
	logs := detail.Exercises[0].SetLogs
	if len(logs) != 2 || logs[0].Kind != "PLANNED" || valueInt(logs[0].PlannedPosition) != 1 || logs[1].Kind != "EXTRA" || logs[1].ScheduledWorkoutPlannedSetID != nil || logs[1].PlannedPosition != nil {
		t.Fatalf("legacy classification = %#v", logs)
	}
}

type sessionSetup struct {
	coach   authn.User
	athlete authn.User
	workout workout.Workout
	created scheduledworkout.Created
	session workoutsession.Session
}

func newSession(t *testing.T, exercises []workout.CreateExerciseInput) sessionSetup {
	t.Helper()
	coach, athlete := integrationUser(t, "COACH"), integrationUser(t, "ATHLETE")
	integrationConnect(t, coach, athlete)
	w, err := workout.Create(context.Background(), integrationPool, coach, workout.CreateInput{Name: integrationPrefix + " workout " + uuid.NewString(), Exercises: exercises})
	if err != nil {
		t.Fatal(err)
	}
	created, err := scheduledworkout.Create(context.Background(), integrationPool, coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-08-16"})
	if err != nil {
		t.Fatal(err)
	}
	session, createdSession, err := workoutsession.Start(context.Background(), integrationPool, athlete, created[0].ID)
	if err != nil || !createdSession {
		t.Fatalf("start session = %#v, created=%v, err=%v", session, createdSession, err)
	}
	return sessionSetup{coach: coach, athlete: athlete, workout: w, created: created[0], session: session}
}

func plannedInput(exerciseID, plannedSetID string, load *float64, unit *string, reps *int, rpe *float64) workoutsession.CreateSetLogInput {
	return workoutsession.CreateSetLogInput{Kind: "PLANNED", ScheduledWorkoutExerciseID: exerciseID, ScheduledWorkoutPlannedSetID: &plannedSetID, Load: load, Unit: unit, Reps: reps, RPE: rpe}
}

func extraInput(exerciseID string, reps *int) workoutsession.CreateSetLogInput {
	return workoutsession.CreateSetLogInput{Kind: "EXTRA", ScheduledWorkoutExerciseID: exerciseID, Reps: reps}
}

type concurrentResult struct {
	setLog workoutsession.SetLog
	err    error
}

func concurrentlyCreate(t *testing.T, caller authn.User, sessionID string, inputs ...workoutsession.CreateSetLogInput) []concurrentResult {
	t.Helper()
	start := make(chan struct{})
	results := make([]concurrentResult, len(inputs))
	var wg sync.WaitGroup
	for i, input := range inputs {
		wg.Add(1)
		go func(index int, in workoutsession.CreateSetLogInput) {
			defer wg.Done()
			<-start
			results[index].setLog, results[index].err = workoutsession.CreateSetLog(context.Background(), integrationPool, caller, sessionID, in)
		}(i, input)
	}
	close(start)
	wg.Wait()
	return results
}

func successCount(results []concurrentResult) int {
	count := 0
	for _, result := range results {
		if result.err == nil {
			count++
		}
	}
	return count
}

func conflictCount(results []concurrentResult, want error) int {
	count := 0
	for _, result := range results {
		if errors.Is(result.err, want) {
			count++
		}
	}
	return count
}

func integrationUser(t *testing.T, role string) authn.User {
	t.Helper()
	u := authn.User{ID: uuid.NewString(), FirebaseUID: integrationPrefix + "-uid-" + uuid.NewString(), Name: integrationPrefix, Role: role}
	if _, err := integrationPool.Exec(context.Background(), `INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1, $2, $3, $4, now())`, u.ID, u.FirebaseUID, u.Name, u.Role); err != nil {
		t.Fatal(err)
	}
	return u
}

func integrationConnect(t *testing.T, coach, athlete authn.User) {
	t.Helper()
	if _, err := integrationPool.Exec(context.Background(), `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1, $2)`, coach.ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
}

func requireIntegrationDB(t *testing.T) {
	t.Helper()
	if integrationSkipReason != "" {
		t.Skip(integrationSkipReason)
	}
}

func cleanupIntegration(ctx context.Context) {
	if integrationPool == nil {
		return
	}
	pattern := integrationPrefix + "%"
	_, _ = integrationPool.Exec(ctx, `DELETE FROM set_logs WHERE session_id IN (SELECT ws.id FROM workout_sessions ws JOIN users u ON u.id = ws.athlete_id WHERE u.firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workout_sessions WHERE athlete_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id IN (SELECT swe.id FROM scheduled_workout_exercises swe JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id WHERE sw.coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM scheduled_workout_exercises WHERE scheduled_workout_id IN (SELECT id FROM scheduled_workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM scheduled_workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workout_exercise_set_overrides WHERE workout_exercise_id IN (SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM exercises WHERE owner_coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM coach_athletes WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1) OR athlete_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM users WHERE firebase_uid LIKE $1`, pattern)
}

func isValidationError(err error) bool {
	var validationErr *workoutsession.ValidationError
	return errors.As(err, &validationErr)
}

func intPtr(value int) *int { return &value }

func valueInt(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func valueFloat(value *float64) float64 {
	if value == nil {
		return 0
	}
	return *value
}

func valueString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}
