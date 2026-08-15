package exercise_test

import (
	"context"
	"errors"
	"net"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/exercise"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
)

var (
	testPool   *pgxpool.Pool
	skipReason string
	testPrefix = "exercise-integration-" + uuid.NewString()
)

func TestMain(m *testing.M) {
	testURL := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if testURL == "" {
		skipReason = "TEST_DATABASE_URL is not set"
		os.Exit(m.Run())
	}

	if developmentURL := strings.TrimSpace(os.Getenv("DATABASE_URL")); developmentURL != "" {
		same, err := sameDatabaseTarget(testURL, developmentURL)
		if err != nil || same {
			skipReason = "TEST_DATABASE_URL is not confirmed to be isolated from DATABASE_URL"
			os.Exit(m.Run())
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, testURL)
	if err != nil {
		skipReason = "cannot connect to TEST_DATABASE_URL"
		os.Exit(m.Run())
	}
	testPool = pool
	code := m.Run()
	cleanupTestRows(context.Background())
	pool.Close()
	os.Exit(code)
}

func TestExerciseLibraryListVisibilitySearchAndOrdering(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coachA := createUser(t, "COACH")
	coachB := createUser(t, "COACH")
	athlete := createUser(t, "ATHLETE")

	insertExercise(t, ctx, testPrefix+" Beta", nil)
	insertExercise(t, ctx, testPrefix+" alpha", nil)
	insertExercise(t, ctx, testPrefix+" Alpha Private", &coachA.ID)
	insertExercise(t, ctx, testPrefix+" gamma private", &coachA.ID)
	insertExercise(t, ctx, testPrefix+" hidden private", &coachB.ID)

	all, err := exercise.ListForCoach(ctx, testPool, coachA, "")
	if err != nil {
		t.Fatal(err)
	}
	visibleFixtures := exercisesWithPrefix(all)
	if len(visibleFixtures) != 4 {
		t.Fatalf("visible fixture count = %d, want 4", len(visibleFixtures))
	}
	if visibleFixtures[0].Scope != "SYSTEM" || visibleFixtures[1].Scope != "SYSTEM" || visibleFixtures[2].Scope != "PRIVATE" || visibleFixtures[3].Scope != "PRIVATE" {
		t.Fatalf("scope ordering = %#v, want SYSTEM, SYSTEM, PRIVATE, PRIVATE", visibleFixtures)
	}
	for i := 1; i < len(visibleFixtures); i++ {
		if visibleFixtures[i-1].Scope == visibleFixtures[i].Scope && strings.ToLower(visibleFixtures[i-1].Name) > strings.ToLower(visibleFixtures[i].Name) {
			t.Fatalf("names are not ordered within scope: %q then %q", visibleFixtures[i-1].Name, visibleFixtures[i].Name)
		}
	}

	for _, rawQuery := range []string{"", "   "} {
		listed, err := exercise.ListForCoach(ctx, testPool, coachA, rawQuery)
		if err != nil || len(exercisesWithPrefix(listed)) != 4 {
			t.Fatalf("query %q returned %d fixture exercises, err=%v; want all 4", rawQuery, len(exercisesWithPrefix(listed)), err)
		}
	}

	matched, err := exercise.ListForCoach(ctx, testPool, coachA, "  ALPHA  ")
	if err != nil {
		t.Fatal(err)
	}
	if len(matched) != 2 || matched[0].Scope != "SYSTEM" || matched[1].Scope != "PRIVATE" {
		t.Fatalf("trimmed case-insensitive substring search = %#v, want system and private alpha", matched)
	}

	if _, err := exercise.ListForCoach(ctx, testPool, athlete, ""); !errors.Is(err, exercise.ErrForbidden) {
		t.Fatalf("athlete list error = %v, want ErrForbidden", err)
	}
}

func TestExerciseLibraryCreateValidationDuplicatesAndOwnership(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coachA := createUser(t, "COACH")
	coachB := createUser(t, "COACH")
	athlete := createUser(t, "ATHLETE")

	for _, name := range []string{"", " \t "} {
		if _, err := exercise.CreatePrivate(ctx, testPool, coachA, name); !hasValidationError(err) {
			t.Fatalf("CreatePrivate(%q) error = %v, want ValidationError", name, err)
		}
	}
	if _, err := exercise.CreatePrivate(ctx, testPool, athlete, testPrefix+" athlete"); !errors.Is(err, exercise.ErrForbidden) {
		t.Fatalf("athlete create error = %v, want ErrForbidden", err)
	}

	privateName := testPrefix + " Tempo Back Squat"
	created, err := exercise.CreatePrivate(ctx, testPool, coachA, "  "+privateName+"  ")
	if err != nil {
		t.Fatal(err)
	}
	if created.Scope != "PRIVATE" || created.Name != privateName {
		t.Fatalf("created = %#v, want trimmed PRIVATE exercise", created)
	}
	var ownerID string
	if err := testPool.QueryRow(ctx, `SELECT owner_coach_id FROM exercises WHERE id = $1`, created.ID).Scan(&ownerID); err != nil {
		t.Fatal(err)
	}
	if ownerID != coachA.ID {
		t.Fatalf("owner_coach_id = %q, want %q", ownerID, coachA.ID)
	}
	if _, err := exercise.CreatePrivate(ctx, testPool, coachA, " "+strings.ToLower(privateName)+" "); !hasConflictError(err) {
		t.Fatalf("case-insensitive own-private duplicate error = %v, want ConflictError", err)
	} else if !strings.Contains(err.Error(), "private exercise") {
		t.Fatalf("own-private duplicate message = %q, want private exercise conflict", err)
	}
	if _, err := exercise.CreatePrivate(ctx, testPool, coachB, privateName); err != nil {
		t.Fatalf("different coach private duplicate should be allowed: %v", err)
	}

	systemName := testPrefix + " Back Squat"
	insertExercise(t, ctx, systemName, nil)
	if _, err := exercise.CreatePrivate(ctx, testPool, coachA, " "+strings.ToLower(systemName)+" "); !hasConflictError(err) {
		t.Fatalf("case-insensitive system duplicate error = %v, want ConflictError", err)
	} else if !strings.Contains(err.Error(), "system library") {
		t.Fatalf("system duplicate message = %q, want system-library conflict", err)
	}
}

func TestExerciseLibraryConcurrentCreateReturnsDomainConflict(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	name := testPrefix + " Concurrent Tempo Squat"

	start := make(chan struct{})
	results := make(chan error, 2)
	var wg sync.WaitGroup
	for range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, err := exercise.CreatePrivate(ctx, testPool, coach, name)
			results <- err
		}()
	}
	close(start)
	wg.Wait()
	close(results)

	successes, conflicts := 0, 0
	for err := range results {
		switch {
		case err == nil:
			successes++
		case hasConflictError(err):
			conflicts++
		default:
			t.Fatalf("concurrent create error = %v, want domain conflict", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent create results: successes=%d conflicts=%d, want 1/1", successes, conflicts)
	}
}

func TestWorkoutCreationReusesPrivateExercise(t *testing.T) {
	requireIntegrationDB(t)
	ctx := context.Background()
	coach := createUser(t, "COACH")
	name := testPrefix + " Reused Tempo Squat"
	created, err := exercise.CreatePrivate(ctx, testPool, coach, name)
	if err != nil {
		t.Fatal(err)
	}
	reps := 5
	createdWorkout, err := workout.Create(ctx, testPool, coach, workout.CreateInput{
		Name: testPrefix + " Workout",
		Exercises: []workout.CreateExerciseInput{{
			Name: "  " + strings.ToLower(name) + "  ",
			Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(createdWorkout.Exercises) != 1 || createdWorkout.Exercises[0].ExerciseID != created.ID {
		t.Fatalf("workout exercise = %#v, want reused exercise ID %q", createdWorkout.Exercises, created.ID)
	}
}

func requireIntegrationDB(t *testing.T) {
	t.Helper()
	if skipReason != "" {
		t.Skip(skipReason)
	}
}

func createUser(t *testing.T, role string) authn.User {
	t.Helper()
	u := authn.User{ID: uuid.NewString(), FirebaseUID: testPrefix + "-uid-" + uuid.NewString(), Name: testPrefix + " user", Role: role}
	if _, err := testPool.Exec(context.Background(),
		`INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1, $2, $3, $4, now())`,
		u.ID, u.FirebaseUID, u.Name, u.Role,
	); err != nil {
		t.Fatalf("TEST_DATABASE_URL must point to a database with the current schema: create user: %v", err)
	}
	return u
}

func insertExercise(t *testing.T, ctx context.Context, name string, ownerID *string) string {
	t.Helper()
	id := uuid.NewString()
	if _, err := testPool.Exec(ctx,
		`INSERT INTO exercises (id, name, owner_coach_id, created_at) VALUES ($1, $2, $3, now())`,
		id, name, ownerID,
	); err != nil {
		t.Fatal(err)
	}
	return id
}

func hasValidationError(err error) bool {
	var target *exercise.ValidationError
	return errors.As(err, &target)
}

func hasConflictError(err error) bool {
	var target *exercise.ConflictError
	return errors.As(err, &target)
}

func exercisesWithPrefix(exercises []exercise.Exercise) []exercise.Exercise {
	filtered := make([]exercise.Exercise, 0)
	for _, item := range exercises {
		if strings.HasPrefix(item.Name, testPrefix) {
			filtered = append(filtered, item)
		}
	}
	return filtered
}

func cleanupTestRows(ctx context.Context) {
	if testPool == nil {
		return
	}
	pattern := testPrefix + "%"
	_, _ = testPool.Exec(ctx, `DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE $1)`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM workouts WHERE name LIKE $1`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM exercises WHERE name LIKE $1`, pattern)
	_, _ = testPool.Exec(ctx, `DELETE FROM users WHERE firebase_uid LIKE $1`, pattern)
}

func sameDatabaseTarget(testURL, developmentURL string) (bool, error) {
	testConfig, err := pgxpool.ParseConfig(testURL)
	if err != nil {
		return false, err
	}
	developmentConfig, err := pgxpool.ParseConfig(developmentURL)
	if err != nil {
		return false, err
	}
	if testConfig.ConnConfig.Database != developmentConfig.ConnConfig.Database || testConfig.ConnConfig.Port != developmentConfig.ConnConfig.Port {
		return false, nil
	}
	if strings.EqualFold(testConfig.ConnConfig.Host, developmentConfig.ConnConfig.Host) {
		return true, nil
	}
	testIPs, err := net.LookupIP(testConfig.ConnConfig.Host)
	if err != nil {
		return false, err
	}
	developmentIPs, err := net.LookupIP(developmentConfig.ConnConfig.Host)
	if err != nil {
		return false, err
	}
	for _, testIP := range testIPs {
		for _, developmentIP := range developmentIPs {
			if testIP.Equal(developmentIP) {
				return true, nil
			}
		}
	}
	return false, nil
}
