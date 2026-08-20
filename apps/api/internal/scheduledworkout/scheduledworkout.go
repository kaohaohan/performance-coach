// Package scheduledworkout implements ScheduledWorkout creation (Coach-only
// batch assignment), the Coach-only date-range list that powers the
// Calendar frontend IA, and the Athlete-only "today" list (docs/
// frontend-ui-spec.md, docs/go-backend-api-contract-v0.1.md §3.5, §3.6).
//
// Create is a write endpoint: it schedules one Workout to one or more
// connected Athletes on one date, snapshotting the workout's current
// prescription independently into scheduled_workout_exercises for each
// created ScheduledWorkout so later template edits never mutate assigned
// training. ListForCoach and ListForAthlete are read/list endpoints only.
// ListForCoach returns summary data (athlete, workout, session status) for
// rendering a Calendar; exercise prescriptions and set logs stay behind GET
// /sessions/{id} — deliberately not duplicated there. ListForAthlete does
// expand exercises, since that's the point of the Athlete Today view, but
// always from the frozen snapshot, never the live workout template.
package scheduledworkout

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/exercise"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
)

const dateLayout = "2006-01-02"

// Athlete is the athlete summary embedded in a ScheduledWorkout list item.
type Athlete struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Workout is the workout template summary embedded in a ScheduledWorkout
// list item.
type Workout struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Session is the WorkoutSession summary embedded in a ScheduledWorkout list
// item. Nil (JSON null) means the athlete hasn't started the session yet.
type Session struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// ScheduledWorkout is one row of GET /api/v1/scheduled-workouts.
type ScheduledWorkout struct {
	ID            string   `json:"id"`
	ScheduledDate string   `json:"scheduledDate"`
	Athlete       Athlete  `json:"athlete"`
	Workout       Workout  `json:"workout"`
	Session       *Session `json:"session"`
}

// ErrForbidden indicates the caller is authenticated but their role is not
// authorized for the requested operation (Create/ListForCoach require
// COACH; ListForAthlete requires ATHLETE).
var ErrForbidden = errors.New("scheduledworkout: caller's role is not authorized for this operation")

// ErrAthleteNotFound indicates the caller requested a specific athleteId
// that is not connected to them (or does not exist). Handlers map this to
// 404 NOT_FOUND rather than 403: this is a resource-scoping check, not a
// role check, and the API's general privacy principle avoids leaking
// whether the athlete account exists (docs/go-backend-api-contract-v0.1.md
// §1). Note this deliberately diverges from POST /scheduled-workouts, which
// still uses 403 for the analogous check — flagged as a future consistency
// cleanup, not addressed in this change.
var ErrAthleteNotFound = errors.New("scheduledworkout: athlete not found or not connected to caller")

// ErrWorkoutNotFound indicates the requested workoutId does not exist, is
// archived, or does not belong to caller. Handlers map this to 404
// NOT_FOUND (docs/go-backend-api-contract-v0.1.md §3.5) — a
// resource-scoping check, not a role check, so it does not reveal whether a
// workout with this id exists for a different coach.
var ErrWorkoutNotFound = errors.New("scheduledworkout: workout not found or not owned by caller")

// ErrAthletesNotConnected indicates at least one requested athleteId has no
// coach_athletes row with caller. Handlers map this to 403 FORBIDDEN. The
// whole batch is rejected when this occurs — no partial scheduling.
var ErrAthletesNotConnected = errors.New("scheduledworkout: one or more athletes are not connected to caller")

// ErrNotFound indicates the requested scheduled workout id does not parse,
// does not exist, or does not belong to caller. Handlers map this to 404
// NOT_FOUND — a resource-scoping check, not a role check, so it does not
// reveal whether a ScheduledWorkout with this id exists for a different
// coach or a different athlete.
var ErrNotFound = errors.New("scheduledworkout: scheduled workout not found or not owned by caller")

// ErrSessionStarted indicates Update was called for a ScheduledWorkout that
// already has a WorkoutSession (ACTIVE or COMPLETED) — the editability
// invariant (docs/mvp-specification.md, "Editing an Assigned Workout") only
// allows editing a ScheduledWorkout before training starts. Handlers map
// this to 409 CONFLICT.
var ErrSessionStarted = errors.New("scheduledworkout: a session has already started for this scheduled workout and it can no longer be edited")

// ErrInvalidStoredPrescription indicates that a persisted Workout template no
// longer satisfies the prescription domain rules. It is deliberately distinct
// from ValidationError: the client did not submit this data, so handlers must
// retain their generic 500 INTERNAL behavior rather than report 400.
var ErrInvalidStoredPrescription = errors.New("scheduledworkout: stored workout prescription is invalid")

// ValidationError indicates the request failed shape validation before any
// DB access. Handlers should map it to 400 INVALID_ARGUMENT.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// ScheduledExercise is one frozen prescription snapshot exercise embedded in
// the Athlete Today response.
type ScheduledExercise struct {
	ScheduledWorkoutExerciseID string      `json:"scheduledWorkoutExerciseId"`
	ExerciseID                 string      `json:"exerciseId"`
	Name                       string      `json:"name"`
	Plan                       CreatedPlan `json:"plan"`
	Position                   int         `json:"position"`
}

// PlannedSet is one resolved, frozen planned position returned by POST
// /api/v1/scheduled-workouts. Unit is derived from the snapshot parent; it is
// intentionally not stored per planned-set row.
type PlannedSet struct {
	ScheduledWorkoutPlannedSetID string   `json:"scheduledWorkoutPlannedSetId"`
	Position                     int      `json:"position"`
	Reps                         *int     `json:"reps,omitempty"`
	PrescriptionNote             *string  `json:"prescriptionNote,omitempty"`
	Load                         *float64 `json:"load,omitempty"`
	Unit                         *string  `json:"unit,omitempty"`
	RPE                          *float64 `json:"rpe,omitempty"`
}

// CreatedPlan is the resolved snapshot plan returned by scheduling and
// Athlete Today responses.
type CreatedPlan struct {
	Sets []PlannedSet `json:"sets"`
}

// CreatedScheduledExercise is a POST-specific representation so the current
// scalar GET response shapes are not migrated by this write phase.
type CreatedScheduledExercise struct {
	ScheduledWorkoutExerciseID string      `json:"scheduledWorkoutExerciseId"`
	ExerciseID                 string      `json:"exerciseId"`
	Name                       string      `json:"name"`
	Plan                       CreatedPlan `json:"plan"`
	Position                   int         `json:"position"`
}

// Created is one item of the POST /api/v1/scheduled-workouts response, and
// is also reused by PUT and GET /api/v1/scheduled-workouts/{id}: a
// ScheduledWorkout with its frozen prescription snapshot expanded,
// sufficient for frontend confirmation or prefill without a follow-up call.
// From POST and PUT, Session is always nil — POST because a ScheduledWorkout
// has no session until training starts, PUT because editing is only ever
// allowed before training starts. GetForCoach is the one caller that can
// return a non-nil Session, since it reads whatever currently exists.
type Created struct {
	ID            string                     `json:"id"`
	ScheduledDate string                     `json:"scheduledDate"`
	Athlete       Athlete                    `json:"athlete"`
	Workout       Workout                    `json:"workout"`
	Session       *Session                   `json:"session"`
	Exercises     []CreatedScheduledExercise `json:"exercises"`
}

// CreateInput is the decoded, wire-format-independent request for Create.
type CreateInput struct {
	WorkoutID     string
	AthleteIDs    []string
	ScheduledDate string
}

// Create schedules workoutId to every athlete in athleteIds on
// scheduledDate, in one transaction, snapshotting the workout's current
// prescription independently into scheduled_workout_exercises for each
// created ScheduledWorkout (docs/go-backend-api-contract-v0.1.md §3.5).
//
// Authorization, checked in order (matching §3.5's documented order —
// workout ownership before athleteIds, so an unauthorized workoutId always
// surfaces as 404 rather than a 400 shape error on athleteIds):
//  1. caller must be a COACH -> else ErrForbidden
//  2. workoutId must be a well-formed UUID, and scheduledDate a valid date
//     -> else *ValidationError. This runs before any DB access purely
//     because neither field can be evaluated against the DB without it —
//     it is not one of §3.5's ordered business checks.
//  3. workout must exist, be un-archived, and be owned by caller -> else
//     ErrWorkoutNotFound
//  4. athleteIds shape (non-empty, well-formed UUIDs, no duplicates) ->
//     else *ValidationError
//  5. every athleteId must have a coach_athletes row with caller -> else
//     ErrAthletesNotConnected
//
// Steps 3-5 and every insert happen inside a single transaction: if any
// athlete is unauthorized, or any row fails to insert, nothing is created
// (all-or-nothing, no partial scheduling).
//
// V0.1 does not deduplicate (workoutId, athleteId, scheduledDate): the
// domain has no time-of-day/session-slot concept yet, so the same workout
// may legitimately be scheduled to the same athlete on the same date more
// than once. This is an explicit product decision, not an oversight.
func Create(ctx context.Context, pool *pgxpool.Pool, caller authn.User, input CreateInput) ([]Created, error) {
	if caller.Role != "COACH" {
		return nil, ErrForbidden
	}

	scheduledDate, err := validateWorkoutIDAndDate(input)
	if err != nil {
		return nil, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	workoutName, err := lookupOwnedWorkout(ctx, tx, caller.ID, input.WorkoutID)
	if err != nil {
		return nil, err
	}

	if err := validateAthleteIDs(input.AthleteIDs); err != nil {
		return nil, err
	}

	athletes, err := lookupConnectedAthletes(ctx, tx, caller.ID, input.AthleteIDs)
	if err != nil {
		return nil, err
	}

	// Read the prescription once into memory, before the per-athlete loop
	// below, so every athlete created in this batch receives this same
	// captured prescription. That guarantee is an application-level one,
	// not a database one: PostgreSQL's default READ COMMITTED isolation
	// does not stop workout_exercises from being modified by another
	// transaction while this one is open. We simply never re-query it
	// after this point.
	prescription, err := lookupResolvedPrescription(ctx, tx, input.WorkoutID)
	if err != nil {
		return nil, err
	}

	created := make([]Created, 0, len(athletes))
	for _, a := range athletes {
		scheduledWorkoutID := uuid.NewString()
		if _, err := tx.Exec(ctx,
			`INSERT INTO scheduled_workouts (id, workout_id, coach_id, athlete_id, scheduled_date, created_at)
			 VALUES ($1, $2, $3, $4, $5, now())`,
			scheduledWorkoutID, input.WorkoutID, caller.ID, a.ID, scheduledDate,
		); err != nil {
			return nil, fmt.Errorf("scheduledworkout: insert scheduled_workout: %w", err)
		}

		exercises := make([]CreatedScheduledExercise, 0, len(prescription))
		for _, p := range prescription {
			scheduledWorkoutExerciseID := uuid.NewString()
			if _, err := tx.Exec(ctx,
				`INSERT INTO scheduled_workout_exercises
					(id, scheduled_workout_id, exercise_id, exercise_name, target_load_unit, target_sets, target_reps, target_prescription_note, target_rpe, position)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				scheduledWorkoutExerciseID, scheduledWorkoutID, p.ExerciseID, p.ExerciseName,
				p.TargetLoadUnit, p.TargetSets, p.TargetReps, p.TargetPrescriptionNote, p.TargetRPE, p.Position,
			); err != nil {
				return nil, fmt.Errorf("scheduledworkout: insert scheduled_workout_exercise: %w", err)
			}

			plannedSets := make([]PlannedSet, 0, len(p.ResolvedSets))
			for _, set := range p.ResolvedSets {
				plannedSetID := uuid.NewString()
				if _, err := tx.Exec(ctx,
					`INSERT INTO scheduled_workout_planned_sets
						(id, scheduled_workout_exercise_id, planned_position, target_reps, target_prescription_note, target_load, target_rpe)
					 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
					plannedSetID, scheduledWorkoutExerciseID, set.Position, set.Reps, set.PrescriptionNote, set.Load, set.RPE,
				); err != nil {
					return nil, fmt.Errorf("scheduledworkout: insert scheduled_workout_planned_set: %w", err)
				}

				var unit *string
				if set.Load != nil {
					unit = p.TargetLoadUnit
				}
				plannedSets = append(plannedSets, PlannedSet{
					ScheduledWorkoutPlannedSetID: plannedSetID,
					Position:                     set.Position,
					Reps:                         set.Reps,
					PrescriptionNote:             set.PrescriptionNote,
					Load:                         set.Load,
					Unit:                         unit,
					RPE:                          set.RPE,
				})
			}

			exercises = append(exercises, CreatedScheduledExercise{
				ScheduledWorkoutExerciseID: scheduledWorkoutExerciseID,
				ExerciseID:                 p.ExerciseID,
				Name:                       p.ExerciseName,
				Plan:                       CreatedPlan{Sets: plannedSets},
				Position:                   p.Position,
			})
		}

		created = append(created, Created{
			ID:            scheduledWorkoutID,
			ScheduledDate: input.ScheduledDate,
			Athlete:       Athlete{ID: a.ID, Name: a.Name},
			Workout:       Workout{ID: input.WorkoutID, Name: workoutName},
			Session:       nil,
			Exercises:     exercises,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("scheduledworkout: commit: %w", err)
	}

	return created, nil
}

// validateWorkoutIDAndDate checks the two request fields that must be
// well-formed before any DB access can happen at all: workoutId (needed to
// query workouts) and scheduledDate (needed to insert scheduled_workouts).
// Deliberately does not touch athleteIds — see validateAthleteIDs, which
// runs later, after the workout-ownership check.
func validateWorkoutIDAndDate(input CreateInput) (time.Time, error) {
	if _, err := uuid.Parse(input.WorkoutID); err != nil {
		return time.Time{}, &ValidationError{Message: "workoutId must be a valid UUID"}
	}

	scheduledDate, err := time.Parse(dateLayout, input.ScheduledDate)
	if err != nil {
		return time.Time{}, &ValidationError{Message: "scheduledDate must be a valid date (YYYY-MM-DD)"}
	}
	return scheduledDate, nil
}

// validateAthleteIDs checks athleteIds shape only (no DB access): non-empty,
// well-formed UUIDs, no duplicates. Called after the workout-ownership
// check succeeds, so that a missing/archived/not-owned workoutId always
// surfaces as ErrWorkoutNotFound (404) rather than a shape error on
// athleteIds (400) — matching docs/go-backend-api-contract-v0.1.md §3.5's
// documented check order.
func validateAthleteIDs(athleteIDs []string) error {
	if len(athleteIDs) == 0 {
		return &ValidationError{Message: "athleteIds must contain at least one entry"}
	}

	seen := make(map[string]bool, len(athleteIDs))
	for i, id := range athleteIDs {
		if _, err := uuid.Parse(id); err != nil {
			return &ValidationError{Message: fmt.Sprintf("athleteIds[%d] must be a valid UUID", i)}
		}
		if seen[id] {
			return &ValidationError{Message: fmt.Sprintf("athleteIds[%d] is a duplicate of an earlier entry", i)}
		}
		seen[id] = true
	}
	return nil
}

// lookupOwnedWorkout returns the workout's name if it exists, is not
// archived, and belongs to coachID; otherwise ErrWorkoutNotFound.
func lookupOwnedWorkout(ctx context.Context, tx pgx.Tx, coachID, workoutID string) (string, error) {
	const query = `
		SELECT name FROM workouts
		WHERE id = $1 AND coach_id = $2 AND archived_at IS NULL`

	var name string
	err := tx.QueryRow(ctx, query, workoutID, coachID).Scan(&name)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrWorkoutNotFound
		}
		return "", fmt.Errorf("scheduledworkout: lookup workout: %w", err)
	}
	return name, nil
}

// connectedAthlete is an (id, name) pair returned by lookupConnectedAthletes.
type connectedAthlete struct {
	ID   string
	Name string
}

// lookupConnectedAthletes resolves athleteIDs to (id, name) pairs, requiring
// every one to have a coach_athletes row with coachID. If any requested
// athleteId is not connected, ErrAthletesNotConnected is returned and no
// rows are returned at all — the batch is all-or-nothing, so there is no
// value in reporting which ones matched.
func lookupConnectedAthletes(ctx context.Context, tx pgx.Tx, coachID string, athleteIDs []string) ([]connectedAthlete, error) {
	const query = `
		SELECT u.id, u.name
		FROM coach_athletes ca
		JOIN users u ON u.id = ca.athlete_id
		WHERE ca.coach_id = $1 AND ca.athlete_id = ANY($2)`

	rows, err := tx.Query(ctx, query, coachID, athleteIDs)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: lookup athletes: %w", err)
	}
	defer rows.Close()

	byID := make(map[string]connectedAthlete, len(athleteIDs))
	for rows.Next() {
		var a connectedAthlete
		if err := rows.Scan(&a.ID, &a.Name); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan athlete: %w", err)
		}
		byID[a.ID] = a
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate athletes: %w", err)
	}

	if len(byID) != len(athleteIDs) {
		return nil, ErrAthletesNotConnected
	}

	// Preserve request order in the response.
	athletes := make([]connectedAthlete, len(athleteIDs))
	for i, id := range athleteIDs {
		athletes[i] = byID[id]
	}
	return athletes, nil
}

// resolvedPrescription is one template exercise with its authoring defaults
// and effective resolved planned positions. The scalar default fields are
// copied only into retained compatibility columns on the snapshot parent;
// ResolvedSets is the canonical prescription being frozen.
type resolvedPrescription struct {
	ExerciseID             string
	ExerciseName           string
	TargetSets             int
	TargetReps             *int
	TargetPrescriptionNote *string
	TargetLoad             *float64
	TargetLoadUnit         *string
	TargetRPE              *float64
	Position               int
	Overrides              []prescription.SetOverride
	ResolvedSets           []prescription.ResolvedPlannedSet
}

// lookupResolvedPrescription reads each template exercise and its sparse
// overrides in one ordered query, groups by workout_exercise id, and resolves
// every exercise once. The joined query gives defaults and overrides the same
// statement snapshot before any athlete-specific inserts begin.
func lookupResolvedPrescription(ctx context.Context, tx pgx.Tx, workoutID string) ([]resolvedPrescription, error) {
	const query = `
		SELECT we.id, we.exercise_id, e.name,
		       we.target_sets, we.target_reps, we.target_prescription_note, we.target_load, we.target_load_unit, we.target_rpe, we.position,
		       o.planned_position, o.reps_override, o.prescription_note_override, o.load_override, o.rpe_override
		FROM workout_exercises we
		JOIN exercises e ON e.id = we.exercise_id
		LEFT JOIN workout_exercise_set_overrides o ON o.workout_exercise_id = we.id
		WHERE we.workout_id = $1
		ORDER BY we.position, o.planned_position`

	rows, err := tx.Query(ctx, query, workoutID)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: lookup prescription: %w", err)
	}
	defer rows.Close()

	prescriptions := make([]resolvedPrescription, 0)
	byWorkoutExerciseID := make(map[string]int)
	for rows.Next() {
		var (
			workoutExerciseID string
			plannedPosition   *int
			override          prescription.SetOverride
		)
		var p resolvedPrescription
		if err := rows.Scan(
			&workoutExerciseID, &p.ExerciseID, &p.ExerciseName,
			&p.TargetSets, &p.TargetReps, &p.TargetPrescriptionNote, &p.TargetLoad, &p.TargetLoadUnit, &p.TargetRPE, &p.Position,
			&plannedPosition, &override.Reps, &override.PrescriptionNote, &override.Load, &override.RPE,
		); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan prescription: %w", err)
		}

		idx, ok := byWorkoutExerciseID[workoutExerciseID]
		if !ok {
			idx = len(prescriptions)
			byWorkoutExerciseID[workoutExerciseID] = idx
			prescriptions = append(prescriptions, p)
		}
		if plannedPosition != nil {
			override.Position = *plannedPosition
			prescriptions[idx].Overrides = append(prescriptions[idx].Overrides, override)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate prescription: %w", err)
	}
	if len(prescriptions) == 0 {
		return nil, ErrInvalidStoredPrescription
	}

	for i := range prescriptions {
		p := &prescriptions[i]
		resolved, err := prescription.Resolve(prescription.Plan{
			SetCount: p.TargetSets,
			Defaults: prescription.Defaults{
				Reps:             p.TargetReps,
				PrescriptionNote: p.TargetPrescriptionNote,
				Load:             p.TargetLoad,
				Unit:             p.TargetLoadUnit,
				RPE:              p.TargetRPE,
			},
			Overrides: p.Overrides,
		})
		if err != nil {
			var validationErr *prescription.ValidationError
			if errors.As(err, &validationErr) {
				return nil, fmt.Errorf("%w: workout exercise %s", ErrInvalidStoredPrescription, p.ExerciseID)
			}
			return nil, fmt.Errorf("scheduledworkout: resolve prescription: %w", err)
		}
		p.ResolvedSets = resolved
	}

	return prescriptions, nil
}

// UpdateExerciseInput is one exercise entry in an UpdateInput, mirroring
// workout.CreateExerciseInput's shape (exercise identity by name, resolved
// the same find-or-create way, plus a full authoring plan).
type UpdateExerciseInput struct {
	Name string
	Plan prescription.Plan
}

// UpdateInput is the decoded, wire-format-independent request for Update.
// There is no editable name here: a ScheduledWorkout has no name of its
// own — the displayed name always comes from a live join to the reusable
// Workout template (see Workout / ScheduledWorkout in ListForCoach), which
// Update deliberately never touches.
type UpdateInput struct {
	Exercises []UpdateExerciseInput
}

// Update replaces scheduledWorkoutID's frozen prescription snapshot with
// input's exercises, in one transaction (docs/mvp-specification.md,
// "Editing an Assigned Workout"). It intentionally reuses Created as its
// return shape: a full expansion of the new snapshot, exactly like a fresh
// POST /scheduled-workouts response, so the frontend can confirm the save
// without a follow-up GET.
//
// This is the one supported way to fix an accidentally-misprogrammed
// assignment. It must never be reimplemented as "edit the Workout template
// and re-snapshot every athlete" — that would silently rewrite every other
// athlete (and every other date) the template was ever assigned to. Update
// touches exactly one ScheduledWorkout's own snapshot rows and nothing else:
// not workouts, not workout_exercises, not any other scheduled_workouts row.
//
// Authorization and state, checked in order:
//  1. caller must be a COACH -> else ErrForbidden
//  2. scheduledWorkoutID must be a well-formed UUID -> else *ValidationError
//  3. input.Exercises must be non-empty with well-formed per-exercise names
//     and valid prescription plans -> else *ValidationError. This runs
//     before any DB access, same rationale as Create's early shape checks.
//  4. the ScheduledWorkout must exist and belong to caller -> else
//     ErrNotFound (not 403 — see ErrNotFound's doc comment)
//  5. no WorkoutSession may exist yet for it (NOT_STARTED only) -> else
//     ErrSessionStarted
//
// Steps 4-5 and every mutation happen inside a single transaction, with the
// ScheduledWorkout row locked FOR UPDATE for the duration: a concurrent
// Start (POST .../session) that has already committed is caught by step 5;
// one racing in mid-edit blocks on that lock (workout_sessions.
// scheduled_workout_id's foreign key needs a FOR KEY SHARE lock on the same
// row to insert) until this transaction commits or rolls back, so Start
// never observes a half-replaced snapshot and Update never commits over a
// session that just started. If validation or any statement fails, nothing
// is written — the original snapshot is left exactly as it was.
func Update(ctx context.Context, pool *pgxpool.Pool, caller authn.User, scheduledWorkoutID string, input UpdateInput) (Created, error) {
	if caller.Role != "COACH" {
		return Created{}, ErrForbidden
	}
	if _, err := uuid.Parse(scheduledWorkoutID); err != nil {
		return Created{}, &ValidationError{Message: "id must be a valid UUID"}
	}

	resolvedPlans, err := validateAndResolveUpdateExercises(input.Exercises)
	if err != nil {
		return Created{}, err
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Created{}, fmt.Errorf("scheduledworkout: begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	header, err := lookupOwnedScheduledWorkoutForUpdate(ctx, tx, caller.ID, scheduledWorkoutID)
	if err != nil {
		return Created{}, err
	}

	hasSession, err := scheduledWorkoutHasSession(ctx, tx, scheduledWorkoutID)
	if err != nil {
		return Created{}, err
	}
	if hasSession {
		return Created{}, ErrSessionStarted
	}

	// Replace the frozen snapshot: planned sets first (they reference
	// scheduled_workout_exercises), then the exercises themselves. Safe
	// unconditionally — the hasSession check above guarantees no set_logs
	// row can reference either table for this scheduled workout yet.
	if _, err := tx.Exec(ctx,
		`DELETE FROM scheduled_workout_planned_sets
		 WHERE scheduled_workout_exercise_id IN (
		     SELECT id FROM scheduled_workout_exercises WHERE scheduled_workout_id = $1
		 )`,
		scheduledWorkoutID,
	); err != nil {
		return Created{}, fmt.Errorf("scheduledworkout: delete planned sets: %w", err)
	}
	if _, err := tx.Exec(ctx,
		`DELETE FROM scheduled_workout_exercises WHERE scheduled_workout_id = $1`,
		scheduledWorkoutID,
	); err != nil {
		return Created{}, fmt.Errorf("scheduledworkout: delete scheduled workout exercises: %w", err)
	}

	exercises := make([]CreatedScheduledExercise, 0, len(input.Exercises))
	for i, ex := range input.Exercises {
		exerciseID, exerciseName, err := exercise.FindOrCreateVisible(ctx, tx, caller.ID, ex.Name)
		if err != nil {
			return Created{}, fmt.Errorf("scheduledworkout: resolve exercise %q: %w", ex.Name, err)
		}

		position := i + 1
		scheduledWorkoutExerciseID := uuid.NewString()
		if _, err := tx.Exec(ctx,
			`INSERT INTO scheduled_workout_exercises
				(id, scheduled_workout_id, exercise_id, exercise_name, target_load_unit, target_sets, target_reps, target_prescription_note, target_rpe, position)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
			scheduledWorkoutExerciseID, scheduledWorkoutID, exerciseID, exerciseName, ex.Plan.Defaults.Unit,
			ex.Plan.SetCount, ex.Plan.Defaults.Reps, ex.Plan.Defaults.PrescriptionNote, ex.Plan.Defaults.RPE, position,
		); err != nil {
			return Created{}, fmt.Errorf("scheduledworkout: insert scheduled_workout_exercise: %w", err)
		}

		plannedSets := make([]PlannedSet, 0, len(resolvedPlans[i]))
		for _, set := range resolvedPlans[i] {
			plannedSetID := uuid.NewString()
			if _, err := tx.Exec(ctx,
				`INSERT INTO scheduled_workout_planned_sets
					(id, scheduled_workout_exercise_id, planned_position, target_reps, target_prescription_note, target_load, target_rpe)
				 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
				plannedSetID, scheduledWorkoutExerciseID, set.Position, set.Reps, set.PrescriptionNote, set.Load, set.RPE,
			); err != nil {
				return Created{}, fmt.Errorf("scheduledworkout: insert scheduled_workout_planned_set: %w", err)
			}

			var unit *string
			if set.Load != nil {
				unit = ex.Plan.Defaults.Unit
			}
			plannedSets = append(plannedSets, PlannedSet{
				ScheduledWorkoutPlannedSetID: plannedSetID,
				Position:                     set.Position,
				Reps:                         set.Reps,
				PrescriptionNote:             set.PrescriptionNote,
				Load:                         set.Load,
				Unit:                         unit,
				RPE:                          set.RPE,
			})
		}

		exercises = append(exercises, CreatedScheduledExercise{
			ScheduledWorkoutExerciseID: scheduledWorkoutExerciseID,
			ExerciseID:                 exerciseID,
			Name:                       exerciseName,
			Plan:                       CreatedPlan{Sets: plannedSets},
			Position:                   position,
		})
	}

	if err := tx.Commit(ctx); err != nil {
		return Created{}, fmt.Errorf("scheduledworkout: commit: %w", err)
	}

	return Created{
		ID:            scheduledWorkoutID,
		ScheduledDate: header.scheduledDate,
		Athlete:       Athlete{ID: header.athleteID, Name: header.athleteName},
		Workout:       Workout{ID: header.workoutID, Name: header.workoutName},
		Session:       nil,
		Exercises:     exercises,
	}, nil
}

// validateAndResolveUpdateExercises checks input.Exercises shape (no DB
// access) and resolves each plan via prescription.Resolve, returning the
// resolved sets in request order for Update's insert loop to reuse without
// re-validating. Mirrors workout.Create's per-exercise validate-then-resolve
// pairing.
func validateAndResolveUpdateExercises(exercises []UpdateExerciseInput) ([][]prescription.ResolvedPlannedSet, error) {
	if len(exercises) == 0 {
		return nil, &ValidationError{Message: "exercises must contain at least one entry"}
	}
	resolved := make([][]prescription.ResolvedPlannedSet, len(exercises))
	for i, ex := range exercises {
		if strings.TrimSpace(ex.Name) == "" {
			return nil, &ValidationError{Message: fmt.Sprintf("exercises[%d].name is required", i)}
		}
		sets, err := prescription.Resolve(ex.Plan)
		if err != nil {
			var validationErr *prescription.ValidationError
			if errors.As(err, &validationErr) {
				return nil, &ValidationError{Message: fmt.Sprintf("exercises[%d].plan: %s", i, validationErr.Message)}
			}
			return nil, fmt.Errorf("scheduledworkout: resolve plan: %w", err)
		}
		resolved[i] = sets
	}
	return resolved, nil
}

// updateHeader is the pre-mutation identity of a ScheduledWorkout being
// edited: everything Update's response needs that doesn't change.
type updateHeader struct {
	athleteID, athleteName string
	workoutID, workoutName string
	scheduledDate          string
}

// lookupOwnedScheduledWorkoutForUpdate locks scheduledWorkoutID's row FOR
// UPDATE and returns its identity if it exists and belongs to coachID;
// otherwise ErrNotFound. The lock is held for the rest of the caller's
// transaction — see Update's doc comment for why that matters.
func lookupOwnedScheduledWorkoutForUpdate(ctx context.Context, tx pgx.Tx, coachID, scheduledWorkoutID string) (updateHeader, error) {
	const query = `
		SELECT sw.athlete_id, u.name, sw.workout_id, w.name, sw.scheduled_date
		FROM scheduled_workouts sw
		JOIN users u ON u.id = sw.athlete_id
		JOIN workouts w ON w.id = sw.workout_id
		WHERE sw.id = $1 AND sw.coach_id = $2
		FOR UPDATE OF sw`

	var h updateHeader
	var scheduledDate time.Time
	err := tx.QueryRow(ctx, query, scheduledWorkoutID, coachID).Scan(
		&h.athleteID, &h.athleteName, &h.workoutID, &h.workoutName, &scheduledDate,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return updateHeader{}, ErrNotFound
		}
		return updateHeader{}, fmt.Errorf("scheduledworkout: lookup scheduled workout for update: %w", err)
	}
	h.scheduledDate = scheduledDate.Format(dateLayout)
	return h, nil
}

// scheduledWorkoutHasSession reports whether a workout_sessions row already
// exists for scheduledWorkoutID, regardless of status — ACTIVE and
// COMPLETED are both "already started" for editability purposes.
func scheduledWorkoutHasSession(ctx context.Context, tx pgx.Tx, scheduledWorkoutID string) (bool, error) {
	const query = `SELECT 1 FROM workout_sessions WHERE scheduled_workout_id = $1`
	var exists int
	err := tx.QueryRow(ctx, query, scheduledWorkoutID).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("scheduledworkout: check session: %w", err)
	}
	return true, nil
}

// GetForCoach returns one ScheduledWorkout belonging to caller, with its
// frozen prescription snapshot and current session (if any) expanded — the
// read side of Update: the Coach Calendar's Edit action uses this to prefill
// the Build Workout form from the exact snapshot it is about to replace,
// since GET /scheduled-workouts (the list) deliberately omits exercises
// (see ListForCoach's doc comment).
//
// Authorization: only a COACH may call this; the ScheduledWorkout must
// belong to caller -> else ErrNotFound (same resource-scoping convention as
// Update, not a role check).
func GetForCoach(ctx context.Context, pool *pgxpool.Pool, caller authn.User, scheduledWorkoutID string) (Created, error) {
	if caller.Role != "COACH" {
		return Created{}, ErrForbidden
	}
	if _, err := uuid.Parse(scheduledWorkoutID); err != nil {
		return Created{}, &ValidationError{Message: "id must be a valid UUID"}
	}

	const headerQuery = `
		SELECT sw.scheduled_date, u.id, u.name, w.id, w.name, ws.id, ws.status
		FROM scheduled_workouts sw
		JOIN users u ON u.id = sw.athlete_id
		JOIN workouts w ON w.id = sw.workout_id
		LEFT JOIN workout_sessions ws ON ws.scheduled_workout_id = sw.id
		WHERE sw.id = $1 AND sw.coach_id = $2`

	var (
		result                   Created
		scheduledDate            time.Time
		sessionID, sessionStatus *string
	)
	err := pool.QueryRow(ctx, headerQuery, scheduledWorkoutID, caller.ID).Scan(
		&scheduledDate, &result.Athlete.ID, &result.Athlete.Name, &result.Workout.ID, &result.Workout.Name, &sessionID, &sessionStatus,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Created{}, ErrNotFound
		}
		return Created{}, fmt.Errorf("scheduledworkout: lookup scheduled workout: %w", err)
	}
	result.ID = scheduledWorkoutID
	result.ScheduledDate = scheduledDate.Format(dateLayout)
	if sessionID != nil {
		result.Session = &Session{ID: *sessionID, Status: *sessionStatus}
	}

	const exercisesQuery = `
		SELECT id, exercise_id, exercise_name, position
		FROM scheduled_workout_exercises
		WHERE scheduled_workout_id = $1
		ORDER BY position`
	exRows, err := pool.Query(ctx, exercisesQuery, scheduledWorkoutID)
	if err != nil {
		return Created{}, fmt.Errorf("scheduledworkout: list snapshot exercises: %w", err)
	}
	defer exRows.Close()

	exerciseOrder := make([]string, 0)
	indexByID := make(map[string]int)
	exercises := make([]CreatedScheduledExercise, 0)
	for exRows.Next() {
		var ex CreatedScheduledExercise
		var id string
		if err := exRows.Scan(&id, &ex.ExerciseID, &ex.Name, &ex.Position); err != nil {
			return Created{}, fmt.Errorf("scheduledworkout: scan snapshot exercise: %w", err)
		}
		ex.ScheduledWorkoutExerciseID = id
		ex.Plan = CreatedPlan{Sets: make([]PlannedSet, 0)}
		indexByID[id] = len(exercises)
		exercises = append(exercises, ex)
		exerciseOrder = append(exerciseOrder, id)
	}
	if err := exRows.Err(); err != nil {
		return Created{}, fmt.Errorf("scheduledworkout: iterate snapshot exercises: %w", err)
	}

	if len(exerciseOrder) > 0 {
		const plannedSetsQuery = `
			SELECT p.scheduled_workout_exercise_id,
			       p.id, p.planned_position, p.target_reps, p.target_prescription_note, p.target_load,
			       CASE WHEN p.target_load IS NULL THEN NULL ELSE swe.target_load_unit END,
			       p.target_rpe
			FROM scheduled_workout_planned_sets p
			JOIN scheduled_workout_exercises swe ON swe.id = p.scheduled_workout_exercise_id
			WHERE p.scheduled_workout_exercise_id = ANY($1)
			ORDER BY p.scheduled_workout_exercise_id, p.planned_position`
		setRows, err := pool.Query(ctx, plannedSetsQuery, exerciseOrder)
		if err != nil {
			return Created{}, fmt.Errorf("scheduledworkout: list snapshot planned sets: %w", err)
		}
		defer setRows.Close()

		for setRows.Next() {
			var exerciseID string
			var set PlannedSet
			if err := setRows.Scan(&exerciseID, &set.ScheduledWorkoutPlannedSetID, &set.Position, &set.Reps, &set.PrescriptionNote, &set.Load, &set.Unit, &set.RPE); err != nil {
				return Created{}, fmt.Errorf("scheduledworkout: scan snapshot planned set: %w", err)
			}
			idx := indexByID[exerciseID]
			exercises[idx].Plan.Sets = append(exercises[idx].Plan.Sets, set)
		}
		if err := setRows.Err(); err != nil {
			return Created{}, fmt.Errorf("scheduledworkout: iterate snapshot planned sets: %w", err)
		}
	}

	result.Exercises = exercises
	return result, nil
}

// ListForCoach returns the caller's scheduled workouts with a
// scheduled_date in [from, to] (inclusive), optionally filtered to one
// athlete.
//
// Authorization: only a COACH may call this; results are always scoped to
// caller.ID — a coach can never see another coach's schedule. If athleteID
// is non-nil, the caller must be connected to that athlete via
// coach_athletes, or ErrAthleteNotFound is returned.
func ListForCoach(ctx context.Context, pool *pgxpool.Pool, caller authn.User, from, to time.Time, athleteID *string) ([]ScheduledWorkout, error) {
	if caller.Role != "COACH" {
		return nil, ErrForbidden
	}

	if athleteID != nil {
		connected, err := isConnected(ctx, pool, caller.ID, *athleteID)
		if err != nil {
			return nil, fmt.Errorf("scheduledworkout: check connection: %w", err)
		}
		if !connected {
			return nil, ErrAthleteNotFound
		}
	}

	const query = `
		SELECT sw.id, sw.scheduled_date,
		       u.id, u.name,
		       w.id, w.name,
		       ws.id, ws.status
		FROM scheduled_workouts sw
		JOIN users u ON u.id = sw.athlete_id
		JOIN workouts w ON w.id = sw.workout_id
		LEFT JOIN workout_sessions ws ON ws.scheduled_workout_id = sw.id
		WHERE sw.coach_id = $1
		  AND sw.scheduled_date BETWEEN $2 AND $3
		  AND ($4::uuid IS NULL OR sw.athlete_id = $4)
		ORDER BY sw.scheduled_date, u.name, sw.id`

	rows, err := pool.Query(ctx, query, caller.ID, from, to, athleteID)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: list: %w", err)
	}
	defer rows.Close()

	scheduled := make([]ScheduledWorkout, 0)
	for rows.Next() {
		var (
			sw            ScheduledWorkout
			scheduledDate time.Time
			sessionID     *string
			sessionStatus *string
		)
		if err := rows.Scan(
			&sw.ID, &scheduledDate,
			&sw.Athlete.ID, &sw.Athlete.Name,
			&sw.Workout.ID, &sw.Workout.Name,
			&sessionID, &sessionStatus,
		); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan: %w", err)
		}
		sw.ScheduledDate = scheduledDate.Format(dateLayout)
		if sessionID != nil {
			sw.Session = &Session{ID: *sessionID, Status: *sessionStatus}
		}
		scheduled = append(scheduled, sw)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate: %w", err)
	}

	return scheduled, nil
}

// isConnected reports whether a coach_athletes row links coachID to
// athleteID. It does not distinguish "athlete doesn't exist" from "athlete
// exists but isn't connected" — both are ErrAthleteNotFound to the caller.
func isConnected(ctx context.Context, pool *pgxpool.Pool, coachID, athleteID string) (bool, error) {
	const query = `SELECT 1 FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`
	var exists int
	err := pool.QueryRow(ctx, query, coachID, athleteID).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// TodayScheduledWorkout is one item of the GET
// /api/v1/me/scheduled-workouts response
// (docs/go-backend-api-contract-v0.1.md §3.6): one of the caller athlete's
// own ScheduledWorkouts on the requested date, with its frozen prescription
// snapshot expanded. Deliberately a separate type from Created and
// ScheduledWorkout — its envelope (flat workoutName, no embedded athlete)
// doesn't match either, even though it reuses their Exercise/Plan/Session
// building blocks.
type TodayScheduledWorkout struct {
	ID            string              `json:"id"`
	ScheduledDate string              `json:"scheduledDate"`
	WorkoutName   string              `json:"workoutName"`
	Exercises     []ScheduledExercise `json:"exercises"`
	Session       *Session            `json:"session"`
}

// ListForAthlete returns the caller's own ScheduledWorkouts on exactly one
// date, with exercises and resolved positions expanded from the frozen
// snapshot (docs/go-backend-api-contract-v0.1.md §3.6, §2 snapshot
// precedence rule). Exercise identity/display name and frozen unit come from
// scheduled_workout_exercises; prescription values come only from
// scheduled_workout_planned_sets. It never reads a live Workout template's
// prescription, so later template edits cannot change the athlete's plan.
//
// Authorization: only an ATHLETE may call this; results are always scoped
// to caller.ID — an athlete can never see another athlete's schedule. There
// is no resource-scoping 404 here (unlike ListForCoach's athleteId filter):
// identity comes solely from the caller, so "no rows" is a legitimate empty
// result, not a hidden-resource case.
//
// The header, snapshot-exercise, and planned-set reads are deliberately
// separate: joining both 1:N relationships would multiply planned rows.
// Rows are grouped in Go, preserving scheduled-workout, exercise, and
// planned-position order. Multiple ScheduledWorkouts on the same date (the
// schedule intentionally allows this — see §3.5) remain separate entries,
// never merged or deduplicated.
func ListForAthlete(ctx context.Context, pool *pgxpool.Pool, caller authn.User, date time.Time) ([]TodayScheduledWorkout, error) {
	if caller.Role != "ATHLETE" {
		return nil, ErrForbidden
	}

	const headersQuery = `
		SELECT sw.id, sw.scheduled_date, w.name,
		       ws.id, ws.status
		FROM scheduled_workouts sw
		JOIN workouts w ON w.id = sw.workout_id
		LEFT JOIN workout_sessions ws ON ws.scheduled_workout_id = sw.id
		WHERE sw.athlete_id = $1 AND sw.scheduled_date = $2
		ORDER BY sw.id`

	rows, err := pool.Query(ctx, headersQuery, caller.ID, date)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: list athlete headers: %w", err)
	}
	defer rows.Close()

	order := make([]string, 0)
	byID := make(map[string]*TodayScheduledWorkout)
	for rows.Next() {
		var (
			id, workoutName      string
			scheduledDate        time.Time
			sessionID, sessionSt *string
		)
		if err := rows.Scan(
			&id, &scheduledDate, &workoutName,
			&sessionID, &sessionSt,
		); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan today header: %w", err)
		}

		sw := &TodayScheduledWorkout{
			ID:            id,
			ScheduledDate: scheduledDate.Format(dateLayout),
			WorkoutName:   workoutName,
			Exercises:     make([]ScheduledExercise, 0),
		}
		if sessionID != nil {
			sw.Session = &Session{ID: *sessionID, Status: *sessionSt}
		}
		byID[id] = sw
		order = append(order, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate today headers: %w", err)
	}
	if len(order) == 0 {
		return make([]TodayScheduledWorkout, 0), nil
	}

	const exercisesQuery = `
		SELECT swe.id, swe.scheduled_workout_id, swe.exercise_id, swe.exercise_name, swe.position
		FROM scheduled_workout_exercises swe
		WHERE swe.scheduled_workout_id = ANY($1)
		ORDER BY swe.scheduled_workout_id, swe.position`

	rows, err = pool.Query(ctx, exercisesQuery, order)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: list athlete snapshot exercises: %w", err)
	}
	defer rows.Close()

	type exerciseReference struct {
		scheduledWorkoutID string
		index              int
	}
	exerciseByID := make(map[string]exerciseReference)
	exerciseOrder := make([]string, 0)
	for rows.Next() {
		var (
			exerciseID, scheduledWorkoutID, exerciseDefinitionID, exerciseName string
			position                                                           int
		)
		if err := rows.Scan(&exerciseID, &scheduledWorkoutID, &exerciseDefinitionID, &exerciseName, &position); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan today snapshot exercise: %w", err)
		}

		sw := byID[scheduledWorkoutID]
		index := len(sw.Exercises)
		sw.Exercises = append(sw.Exercises, ScheduledExercise{
			ScheduledWorkoutExerciseID: exerciseID,
			ExerciseID:                 exerciseDefinitionID,
			Name:                       exerciseName,
			Plan:                       CreatedPlan{Sets: make([]PlannedSet, 0)},
			Position:                   position,
		})
		exerciseByID[exerciseID] = exerciseReference{scheduledWorkoutID: scheduledWorkoutID, index: index}
		exerciseOrder = append(exerciseOrder, exerciseID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate today snapshot exercises: %w", err)
	}

	const plannedSetsQuery = `
		SELECT p.scheduled_workout_exercise_id,
		       p.id, p.planned_position, p.target_reps, p.target_prescription_note, p.target_load,
		       CASE WHEN p.target_load IS NULL THEN NULL ELSE swe.target_load_unit END,
		       p.target_rpe
		FROM scheduled_workout_planned_sets p
		JOIN scheduled_workout_exercises swe ON swe.id = p.scheduled_workout_exercise_id
		WHERE p.scheduled_workout_exercise_id = ANY($1)
		ORDER BY p.scheduled_workout_exercise_id, p.planned_position`

	rows, err = pool.Query(ctx, plannedSetsQuery, exerciseOrder)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: list athlete planned sets: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			exerciseID string
			plannedSet PlannedSet
		)
		if err := rows.Scan(
			&exerciseID,
			&plannedSet.ScheduledWorkoutPlannedSetID, &plannedSet.Position, &plannedSet.Reps, &plannedSet.PrescriptionNote, &plannedSet.Load, &plannedSet.Unit, &plannedSet.RPE,
		); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan today planned set: %w", err)
		}

		ref := exerciseByID[exerciseID]
		byID[ref.scheduledWorkoutID].Exercises[ref.index].Plan.Sets = append(byID[ref.scheduledWorkoutID].Exercises[ref.index].Plan.Sets, plannedSet)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate today planned sets: %w", err)
	}

	scheduled := make([]TodayScheduledWorkout, 0, len(order))
	for _, id := range order {
		scheduled = append(scheduled, *byID[id])
	}
	return scheduled, nil
}
