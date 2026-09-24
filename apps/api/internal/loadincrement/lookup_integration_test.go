package loadincrement_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/loadincrement"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
)

var (
	lookupPool       *pgxpool.Pool
	lookupSkipReason string
	lookupPrefix     = "loadincrement-integration-" + uuid.NewString()
)

func TestMain(m *testing.M) {
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		lookupSkipReason = "TEST_DATABASE_URL is not set"
		os.Exit(m.Run())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var err error
	lookupPool, err = pgxpool.New(ctx, url)
	if err != nil {
		lookupSkipReason = "cannot connect to TEST_DATABASE_URL"
		os.Exit(m.Run())
	}
	code := m.Run()
	lookupPool.Close()
	os.Exit(code)
}

func TestLastCompletedLoadsUsesCompletedSessionsOnly(t *testing.T) {
	requireLookupDB(t)
	ctx := context.Background()
	coach := lookupUser(t, "COACH")
	athlete := lookupUser(t, "ATHLETE")
	lookupConnect(t, coach, athlete)

	reps := 5
	load80 := 80.0
	kg := "kg"
	createdWorkout, err := workout.Create(ctx, lookupPool, coach, workout.CreateInput{
		Name: lookupPrefix + " workout",
		Exercises: []workout.CreateExerciseInput{{
			Name: lookupPrefix + " squat",
			Plan: prescription.Plan{SetCount: 1, Defaults: prescription.Defaults{Reps: &reps, Load: &load80, Unit: &kg}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	exerciseID := createdWorkout.Exercises[0].ExerciseID

	activeScheduled, err := scheduledworkout.Create(ctx, lookupPool, coach, scheduledworkout.CreateInput{
		WorkoutID: createdWorkout.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-09-01",
	})
	if err != nil {
		t.Fatal(err)
	}
	activePlannedID := activeScheduled[0].Exercises[0].Plan.Sets[0].ScheduledWorkoutPlannedSetID
	activeSweID := activeScheduled[0].Exercises[0].ScheduledWorkoutExerciseID
	activeSessionID := uuid.NewString()
	if _, err := lookupPool.Exec(ctx, `
		INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at, completed_at)
		VALUES ($1, $2, $3, 'ACTIVE', now(), NULL)`, activeSessionID, activeScheduled[0].ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := lookupPool.Exec(ctx, `
		INSERT INTO set_logs (id, session_id, scheduled_workout_exercise_id, scheduled_workout_planned_set_id, set_number, load, unit, reps, logged_by_user_id, created_at)
		VALUES ($1, $2, $3, $4, 1, 70, 'kg', 5, $5, now())`,
		uuid.NewString(), activeSessionID, activeSweID, activePlannedID, athlete.ID); err != nil {
		t.Fatal(err)
	}

	activeOnly, err := loadincrement.LastCompletedLoads(ctx, lookupPool, athlete.ID, []string{exerciseID}, []string{"kg"})
	if err != nil {
		t.Fatal(err)
	}
	if activeOnly[exerciseID] != nil {
		t.Fatalf("ACTIVE session load = %#v, want nil", activeOnly[exerciseID])
	}

	completedScheduled, err := scheduledworkout.Create(ctx, lookupPool, coach, scheduledworkout.CreateInput{
		WorkoutID: createdWorkout.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: "2026-09-08",
	})
	if err != nil {
		t.Fatal(err)
	}
	completedSweID := completedScheduled[0].Exercises[0].ScheduledWorkoutExerciseID
	completedSessionID := uuid.NewString()
	completedLoad := 100.0
	if _, err := lookupPool.Exec(ctx, `
		INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at, completed_at)
		VALUES ($1, $2, $3, 'COMPLETED', now() - interval '2 days', now() - interval '1 day')`,
		completedSessionID, completedScheduled[0].ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := lookupPool.Exec(ctx, `
		INSERT INTO set_logs (id, session_id, scheduled_workout_exercise_id, set_number, load, unit, reps, logged_by_user_id, created_at)
		VALUES ($1, $2, $3, 1, $4, 'kg', 5, $5, now())`,
		uuid.NewString(), completedSessionID, completedSweID, completedLoad, athlete.ID); err != nil {
		t.Fatal(err)
	}

	got, err := loadincrement.LastCompletedLoads(ctx, lookupPool, athlete.ID, []string{exerciseID}, []string{"kg"})
	if err != nil {
		t.Fatal(err)
	}
	if got[exerciseID] == nil || *got[exerciseID] != completedLoad {
		t.Fatalf("completed load = %#v, want %v", got[exerciseID], completedLoad)
	}
}

func requireLookupDB(t *testing.T) {
	t.Helper()
	if lookupSkipReason != "" {
		t.Skip(lookupSkipReason)
	}
}

func lookupUser(t *testing.T, role string) authn.User {
	t.Helper()
	u := authn.User{ID: uuid.NewString(), FirebaseUID: lookupPrefix + "-uid-" + uuid.NewString(), Name: lookupPrefix, Role: role}
	if _, err := lookupPool.Exec(context.Background(), `INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1, $2, $3, $4, now())`, u.ID, u.FirebaseUID, u.Name, u.Role); err != nil {
		t.Fatal(err)
	}
	return u
}

func lookupConnect(t *testing.T, coach, athlete authn.User) {
	t.Helper()
	if _, err := lookupPool.Exec(context.Background(), `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1, $2)`, coach.ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
}
