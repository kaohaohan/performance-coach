// Package workout implements Coach-owned Workout creation and listing.
//
// A Workout is a reusable template: Coach -> Workout -> WorkoutExercise ->
// Exercise. Creating a workout finds-or-creates each named Exercise (the
// system catalog wins on a name collision; otherwise a private exercise is
// created for the caller) and persists the workout plus its prescriptions
// in one transaction, per docs/go-backend-api-contract-v0.1.md §3.2-3.3.
package workout

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// Plan is the prescription for one exercise inside a workout. It is always
// a nested object, never flattened into the parent, so a future per-set
// prescription can grow this into a slice without a contract rewrite
// (docs/go-backend-api-contract-v0.1.md §3.3, §7.1).
type Plan struct {
	Sets             int      `json:"sets"`
	Reps             *int     `json:"reps,omitempty"`
	PrescriptionNote *string  `json:"prescriptionNote,omitempty"`
	RPE              *float64 `json:"rpe,omitempty"`
}

// Exercise is one prescribed exercise inside a Workout response.
type Exercise struct {
	WorkoutExerciseID string `json:"workoutExerciseId"`
	ExerciseID        string `json:"exerciseId"`
	Name              string `json:"name"`
	Plan              Plan   `json:"plan"`
	Position          int    `json:"position"`
}

// Workout is the response shape for both POST /workouts and GET /workouts.
type Workout struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	Exercises []Exercise `json:"exercises"`
}

// ErrForbidden indicates the caller is authenticated but not authorized to
// create or list workouts (i.e. not a COACH).
var ErrForbidden = errors.New("workout: caller is not a coach")

// ValidationError indicates the request failed validation. Handlers should
// map it to 400 INVALID_ARGUMENT.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// CreateExerciseInput is one exercise entry in a CreateInput.
type CreateExerciseInput struct {
	Name                   string
	TargetSets             int
	TargetReps             *int
	TargetPrescriptionNote *string
	TargetRPE              *float64
}

// CreateInput is the decoded, wire-format-independent request for Create.
type CreateInput struct {
	Name      string
	Exercises []CreateExerciseInput
}

// Create validates input, then in a single transaction: finds-or-creates
// each named exercise, creates the workout, and creates its
// workout_exercises prescriptions with server-assigned position (array
// order, 1-based).
//
// Authorization: only a COACH may call this. Non-coach callers get
// ErrForbidden. A caller can only ever create a workout for themselves —
// there is no "on behalf of" parameter.
func Create(ctx context.Context, pool *pgxpool.Pool, caller authn.User, input CreateInput) (Workout, error) {
	if caller.Role != "COACH" {
		return Workout{}, ErrForbidden
	}
	if err := validate(input); err != nil {
		return Workout{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Workout{}, fmt.Errorf("workout: begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	name := strings.TrimSpace(input.Name)
	workoutID := uuid.NewString()
	if _, err := tx.Exec(ctx,
		`INSERT INTO workouts (id, coach_id, name, created_at) VALUES ($1, $2, $3, now())`,
		workoutID, caller.ID, name,
	); err != nil {
		return Workout{}, fmt.Errorf("workout: insert workout: %w", err)
	}

	exercises := make([]Exercise, 0, len(input.Exercises))
	for i, ex := range input.Exercises {
		exerciseID, exerciseName, err := findOrCreateExercise(ctx, tx, caller.ID, ex.Name)
		if err != nil {
			return Workout{}, fmt.Errorf("workout: resolve exercise %q: %w", ex.Name, err)
		}

		position := i + 1
		workoutExerciseID := uuid.NewString()
		if _, err := tx.Exec(ctx,
			`INSERT INTO workout_exercises
				(id, workout_id, exercise_id, target_sets, target_reps, target_prescription_note, target_rpe, position)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			workoutExerciseID, workoutID, exerciseID, ex.TargetSets, ex.TargetReps, ex.TargetPrescriptionNote, ex.TargetRPE, position,
		); err != nil {
			return Workout{}, fmt.Errorf("workout: insert workout_exercise: %w", err)
		}

		exercises = append(exercises, Exercise{
			WorkoutExerciseID: workoutExerciseID,
			ExerciseID:        exerciseID,
			Name:              exerciseName,
			Plan: Plan{
				Sets:             ex.TargetSets,
				Reps:             ex.TargetReps,
				PrescriptionNote: ex.TargetPrescriptionNote,
				RPE:              ex.TargetRPE,
			},
			Position: position,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return Workout{}, fmt.Errorf("workout: commit: %w", err)
	}

	return Workout{ID: workoutID, Name: name, Exercises: exercises}, nil
}

// validate enforces docs/go-backend-api-contract-v0.1.md §3.3's POST
// /workouts validation rules. Fails on the first violation found.
func validate(input CreateInput) error {
	if strings.TrimSpace(input.Name) == "" {
		return &ValidationError{Message: "name is required"}
	}
	if len(input.Exercises) == 0 {
		return &ValidationError{Message: "exercises must contain at least one entry"}
	}
	for i, ex := range input.Exercises {
		if strings.TrimSpace(ex.Name) == "" {
			return &ValidationError{Message: fmt.Sprintf("exercises[%d].name is required", i)}
		}
		if ex.TargetSets <= 0 {
			return &ValidationError{Message: fmt.Sprintf("exercises[%d].targetSets must be a positive integer", i)}
		}
		hasNote := ex.TargetPrescriptionNote != nil && strings.TrimSpace(*ex.TargetPrescriptionNote) != ""
		if ex.TargetReps == nil && !hasNote {
			return &ValidationError{Message: fmt.Sprintf("exercises[%d] requires targetReps or targetPrescriptionNote", i)}
		}
		if ex.TargetReps != nil && *ex.TargetReps <= 0 {
			return &ValidationError{Message: fmt.Sprintf("exercises[%d].targetReps must be a positive integer", i)}
		}
		if ex.TargetRPE != nil && (*ex.TargetRPE < 1 || *ex.TargetRPE > 10) {
			return &ValidationError{Message: fmt.Sprintf("exercises[%d].targetRpe must be between 1 and 10", i)}
		}
	}
	return nil
}

// findOrCreateExercise resolves rawName to an exercise id, preferring an
// existing system exercise (owner_coach_id IS NULL) over the caller's own
// private exercise of the same name; if neither exists it creates a new
// private exercise owned by caller. Returns the canonical stored name,
// which may differ in whitespace from the caller's input.
func findOrCreateExercise(ctx context.Context, tx pgx.Tx, coachID, rawName string) (id string, name string, err error) {
	trimmed := strings.TrimSpace(rawName)

	const selectQuery = `
		SELECT id, name FROM exercises
		WHERE (owner_coach_id IS NULL OR owner_coach_id = $1)
		  AND lower(name) = lower($2)
		ORDER BY owner_coach_id NULLS FIRST
		LIMIT 1`

	err = tx.QueryRow(ctx, selectQuery, coachID, trimmed).Scan(&id, &name)
	if err == nil {
		return id, name, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", "", err
	}

	newID := uuid.NewString()
	const insertQuery = `
		INSERT INTO exercises (id, name, owner_coach_id, created_at)
		VALUES ($1, $2, $3, now())`
	if _, err := tx.Exec(ctx, insertQuery, newID, trimmed, coachID); err != nil {
		return "", "", err
	}
	return newID, trimmed, nil
}

// ListForCoach returns the caller's own, non-archived workouts, most
// recently created first, each with its full exercise prescription list.
//
// Authorization: only a COACH may call this. Non-coach callers get
// ErrForbidden. Results are always scoped to caller.ID — a coach can never
// see another coach's workouts through this call.
func ListForCoach(ctx context.Context, pool *pgxpool.Pool, caller authn.User) ([]Workout, error) {
	if caller.Role != "COACH" {
		return nil, ErrForbidden
	}

	const workoutsQuery = `
		SELECT id, name FROM workouts
		WHERE coach_id = $1 AND archived_at IS NULL
		ORDER BY created_at DESC`

	rows, err := pool.Query(ctx, workoutsQuery, caller.ID)
	if err != nil {
		return nil, fmt.Errorf("workout: list workouts: %w", err)
	}

	workouts := make([]Workout, 0)
	indexByID := make(map[string]int)
	ids := make([]string, 0)
	for rows.Next() {
		var w Workout
		if err := rows.Scan(&w.ID, &w.Name); err != nil {
			rows.Close()
			return nil, fmt.Errorf("workout: scan workout: %w", err)
		}
		w.Exercises = []Exercise{}
		indexByID[w.ID] = len(workouts)
		workouts = append(workouts, w)
		ids = append(ids, w.ID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, fmt.Errorf("workout: iterate workouts: %w", err)
	}
	rows.Close()

	if len(ids) == 0 {
		return workouts, nil
	}

	const exercisesQuery = `
		SELECT we.workout_id, we.id, we.exercise_id, e.name,
		       we.target_sets, we.target_reps, we.target_prescription_note, we.target_rpe, we.position
		FROM workout_exercises we
		JOIN exercises e ON e.id = we.exercise_id
		WHERE we.workout_id = ANY($1)
		ORDER BY we.workout_id, we.position`

	exRows, err := pool.Query(ctx, exercisesQuery, ids)
	if err != nil {
		return nil, fmt.Errorf("workout: list workout_exercises: %w", err)
	}
	defer exRows.Close()

	for exRows.Next() {
		var workoutID string
		var ex Exercise
		var plan Plan
		if err := exRows.Scan(&workoutID, &ex.WorkoutExerciseID, &ex.ExerciseID, &ex.Name,
			&plan.Sets, &plan.Reps, &plan.PrescriptionNote, &plan.RPE, &ex.Position); err != nil {
			return nil, fmt.Errorf("workout: scan workout_exercise: %w", err)
		}
		ex.Plan = plan
		idx, ok := indexByID[workoutID]
		if !ok {
			continue
		}
		workouts[idx].Exercises = append(workouts[idx].Exercises, ex)
	}
	if err := exRows.Err(); err != nil {
		return nil, fmt.Errorf("workout: iterate workout_exercises: %w", err)
	}

	return workouts, nil
}
