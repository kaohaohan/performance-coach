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
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/exercise"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
)

// Plan is the editable, uniform-first prescription for one exercise inside a
// workout template. Defaults and overrides deliberately remain authoring
// metadata; resolved positions belong to scheduling snapshots.
type Plan struct {
	SetCount  int           `json:"setCount"`
	Defaults  Defaults      `json:"defaults"`
	Overrides []SetOverride `json:"overrides"`
}

type Defaults struct {
	Reps             *int     `json:"reps,omitempty"`
	PrescriptionNote *string  `json:"prescriptionNote,omitempty"`
	Load             *float64 `json:"load,omitempty"`
	Unit             *string  `json:"unit,omitempty"`
	RPE              *float64 `json:"rpe,omitempty"`
}

type SetOverride struct {
	Position         int      `json:"position"`
	Reps             *int     `json:"reps,omitempty"`
	PrescriptionNote *string  `json:"prescriptionNote,omitempty"`
	Load             *float64 `json:"load,omitempty"`
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
	Name string
	Plan prescription.Plan
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
	for i, ex := range input.Exercises {
		if _, err := prescription.Resolve(ex.Plan); err != nil {
			var validationErr *prescription.ValidationError
			if errors.As(err, &validationErr) {
				return Workout{}, &ValidationError{Message: fmt.Sprintf("exercises[%d].plan: %s", i, validationErr.Message)}
			}
			return Workout{}, fmt.Errorf("workout: resolve plan: %w", err)
		}
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
		exerciseID, exerciseName, err := exercise.FindOrCreateVisible(ctx, tx, caller.ID, ex.Name)
		if err != nil {
			return Workout{}, fmt.Errorf("workout: resolve exercise %q: %w", ex.Name, err)
		}

		position := i + 1
		workoutExerciseID := uuid.NewString()
		if _, err := tx.Exec(ctx,
			`INSERT INTO workout_exercises
				(id, workout_id, exercise_id, target_sets, target_reps, target_prescription_note, target_load, target_load_unit, target_rpe, position)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			workoutExerciseID, workoutID, exerciseID, ex.Plan.SetCount, ex.Plan.Defaults.Reps, ex.Plan.Defaults.PrescriptionNote,
			ex.Plan.Defaults.Load, ex.Plan.Defaults.Unit, ex.Plan.Defaults.RPE, position,
		); err != nil {
			return Workout{}, fmt.Errorf("workout: insert workout_exercise: %w", err)
		}
		for _, override := range ex.Plan.Overrides {
			if _, err := tx.Exec(ctx,
				`INSERT INTO workout_exercise_set_overrides
					(id, workout_exercise_id, planned_position, reps_override, prescription_note_override, load_override, rpe_override)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				uuid.NewString(), workoutExerciseID, override.Position, override.Reps, override.PrescriptionNote, override.Load, override.RPE,
			); err != nil {
				return Workout{}, fmt.Errorf("workout: insert set override: %w", err)
			}
		}

		exercises = append(exercises, Exercise{
			WorkoutExerciseID: workoutExerciseID,
			ExerciseID:        exerciseID,
			Name:              exerciseName,
			Plan:              planFromPrescription(ex.Plan),
			Position:          position,
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
	}
	return nil
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
		       we.target_sets, we.target_reps, we.target_prescription_note, we.target_load, we.target_load_unit, we.target_rpe, we.position
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
			&plan.SetCount, &plan.Defaults.Reps, &plan.Defaults.PrescriptionNote, &plan.Defaults.Load, &plan.Defaults.Unit, &plan.Defaults.RPE, &ex.Position); err != nil {
			return nil, fmt.Errorf("workout: scan workout_exercise: %w", err)
		}
		plan.Overrides = []SetOverride{}
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

	const overridesQuery = `
		SELECT o.workout_exercise_id, o.planned_position, o.reps_override,
		       o.prescription_note_override, o.load_override, o.rpe_override
		FROM workout_exercise_set_overrides o
		JOIN workout_exercises we ON we.id = o.workout_exercise_id
		WHERE we.workout_id = ANY($1)
		ORDER BY o.workout_exercise_id, o.planned_position`
	overrideRows, err := pool.Query(ctx, overridesQuery, ids)
	if err != nil {
		return nil, fmt.Errorf("workout: list set overrides: %w", err)
	}
	defer overrideRows.Close()
	exerciseIndexes := make(map[string]struct{ workout, exercise int })
	for wi := range workouts {
		for ei := range workouts[wi].Exercises {
			exerciseIndexes[workouts[wi].Exercises[ei].WorkoutExerciseID] = struct{ workout, exercise int }{wi, ei}
		}
	}
	for overrideRows.Next() {
		var workoutExerciseID string
		var override SetOverride
		if err := overrideRows.Scan(&workoutExerciseID, &override.Position, &override.Reps, &override.PrescriptionNote, &override.Load, &override.RPE); err != nil {
			return nil, fmt.Errorf("workout: scan set override: %w", err)
		}
		if index, ok := exerciseIndexes[workoutExerciseID]; ok {
			workouts[index.workout].Exercises[index.exercise].Plan.Overrides = append(workouts[index.workout].Exercises[index.exercise].Plan.Overrides, override)
		}
	}
	if err := overrideRows.Err(); err != nil {
		return nil, fmt.Errorf("workout: iterate set overrides: %w", err)
	}

	return workouts, nil
}

func planFromPrescription(plan prescription.Plan) Plan {
	overrides := make([]SetOverride, len(plan.Overrides))
	for i, override := range plan.Overrides {
		overrides[i] = SetOverride{Position: override.Position, Reps: override.Reps, PrescriptionNote: override.PrescriptionNote, Load: override.Load, RPE: override.RPE}
	}
	return Plan{SetCount: plan.SetCount, Defaults: Defaults{Reps: plan.Defaults.Reps, PrescriptionNote: plan.Defaults.PrescriptionNote, Load: plan.Defaults.Load, Unit: plan.Defaults.Unit, RPE: plan.Defaults.RPE}, Overrides: overrides}
}
