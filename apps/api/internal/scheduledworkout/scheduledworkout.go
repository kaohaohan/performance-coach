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
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
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

// ValidationError indicates the request failed shape validation before any
// DB access. Handlers should map it to 400 INVALID_ARGUMENT.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// Plan is the prescription for one exercise inside a created
// ScheduledWorkout's snapshot. Mirrors workout.Plan's shape
// (docs/go-backend-api-contract-v0.1.md §3.3, §7.1): always a nested
// object, never flattened, so a future per-set prescription can grow this
// into a slice without a contract rewrite.
type Plan struct {
	Sets             int      `json:"sets"`
	Reps             *int     `json:"reps,omitempty"`
	PrescriptionNote *string  `json:"prescriptionNote,omitempty"`
	RPE              *float64 `json:"rpe,omitempty"`
}

// ScheduledExercise is one frozen prescription snapshot row embedded in a
// created ScheduledWorkout response.
type ScheduledExercise struct {
	ScheduledWorkoutExerciseID string `json:"scheduledWorkoutExerciseId"`
	ExerciseID                 string `json:"exerciseId"`
	Name                       string `json:"name"`
	Plan                       Plan   `json:"plan"`
	Position                   int    `json:"position"`
}

// Created is one item of the POST /api/v1/scheduled-workouts response: a
// newly created ScheduledWorkout with its frozen prescription snapshot
// expanded, sufficient for frontend confirmation without a follow-up call.
// Session is always null — a ScheduledWorkout has no session until training
// starts.
type Created struct {
	ID            string              `json:"id"`
	ScheduledDate string              `json:"scheduledDate"`
	Athlete       Athlete             `json:"athlete"`
	Workout       Workout             `json:"workout"`
	Session       *Session            `json:"session"`
	Exercises     []ScheduledExercise `json:"exercises"`
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
	prescription, err := lookupPrescription(ctx, tx, input.WorkoutID)
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

		exercises := make([]ScheduledExercise, 0, len(prescription))
		for _, p := range prescription {
			scheduledWorkoutExerciseID := uuid.NewString()
			if _, err := tx.Exec(ctx,
				`INSERT INTO scheduled_workout_exercises
					(id, scheduled_workout_id, exercise_id, exercise_name, target_sets, target_reps, target_prescription_note, target_rpe, position)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
				scheduledWorkoutExerciseID, scheduledWorkoutID, p.ExerciseID, p.ExerciseName,
				p.TargetSets, p.TargetReps, p.TargetPrescriptionNote, p.TargetRPE, p.Position,
			); err != nil {
				return nil, fmt.Errorf("scheduledworkout: insert scheduled_workout_exercise: %w", err)
			}

			exercises = append(exercises, ScheduledExercise{
				ScheduledWorkoutExerciseID: scheduledWorkoutExerciseID,
				ExerciseID:                 p.ExerciseID,
				Name:                       p.ExerciseName,
				Plan: Plan{
					Sets:             p.TargetSets,
					Reps:             p.TargetReps,
					PrescriptionNote: p.TargetPrescriptionNote,
					RPE:              p.TargetRPE,
				},
				Position: p.Position,
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

// prescriptionRow is one workout_exercises row (joined to its exercise
// name) to be copied into scheduled_workout_exercises.
type prescriptionRow struct {
	ExerciseID             string
	ExerciseName           string
	TargetSets             int
	TargetReps             *int
	TargetPrescriptionNote *string
	TargetRPE              *float64
	Position               int
}

// lookupPrescription reads workoutID's current prescription (its
// workout_exercises rows joined to exercise names), ordered by position.
func lookupPrescription(ctx context.Context, tx pgx.Tx, workoutID string) ([]prescriptionRow, error) {
	const query = `
		SELECT we.exercise_id, e.name, we.target_sets, we.target_reps, we.target_prescription_note, we.target_rpe, we.position
		FROM workout_exercises we
		JOIN exercises e ON e.id = we.exercise_id
		WHERE we.workout_id = $1
		ORDER BY we.position`

	rows, err := tx.Query(ctx, query, workoutID)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: lookup prescription: %w", err)
	}
	defer rows.Close()

	prescription := make([]prescriptionRow, 0)
	for rows.Next() {
		var p prescriptionRow
		if err := rows.Scan(&p.ExerciseID, &p.ExerciseName, &p.TargetSets, &p.TargetReps, &p.TargetPrescriptionNote, &p.TargetRPE, &p.Position); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan prescription: %w", err)
		}
		prescription = append(prescription, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate prescription: %w", err)
	}
	return prescription, nil
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
// date, exercises expanded from the frozen scheduled_workout_exercises
// snapshot (docs/go-backend-api-contract-v0.1.md §3.6, §2 snapshot
// precedence rule). Display fields (exercise name, target sets/reps/note/
// rpe) always come from the snapshot row, never from the current exercises
// or workout_exercises tables, so a later rename/edit of the template does
// not change what the athlete already saw scheduled.
//
// Authorization: only an ATHLETE may call this; results are always scoped
// to caller.ID — an athlete can never see another athlete's schedule. There
// is no resource-scoping 404 here (unlike ListForCoach's athleteId filter):
// identity comes solely from the caller, so "no rows" is a legitimate empty
// result, not a hidden-resource case.
//
// scheduled_workouts joins 1:N to scheduled_workout_exercises (every
// ScheduledWorkout has at least one snapshot exercise by construction — see
// Create), so the query produces one SQL row per exercise. Rows are grouped
// in Go, keyed by scheduled_workout id and in first-seen order, so each
// ScheduledWorkout appears exactly once in the response with its exercises
// appended in snapshot position order; multiple ScheduledWorkouts on the
// same date (the schedule intentionally allows this — see §3.5) remain
// separate entries, never merged or deduplicated.
func ListForAthlete(ctx context.Context, pool *pgxpool.Pool, caller authn.User, date time.Time) ([]TodayScheduledWorkout, error) {
	if caller.Role != "ATHLETE" {
		return nil, ErrForbidden
	}

	const query = `
		SELECT sw.id, sw.scheduled_date, w.name,
		       swe.id, swe.exercise_id, swe.exercise_name,
		       swe.target_sets, swe.target_reps, swe.target_prescription_note, swe.target_rpe, swe.position,
		       ws.id, ws.status
		FROM scheduled_workouts sw
		JOIN workouts w ON w.id = sw.workout_id
		JOIN scheduled_workout_exercises swe ON swe.scheduled_workout_id = sw.id
		LEFT JOIN workout_sessions ws ON ws.scheduled_workout_id = sw.id
		WHERE sw.athlete_id = $1 AND sw.scheduled_date = $2
		ORDER BY sw.id, swe.position`

	rows, err := pool.Query(ctx, query, caller.ID, date)
	if err != nil {
		return nil, fmt.Errorf("scheduledworkout: list for athlete: %w", err)
	}
	defer rows.Close()

	order := make([]string, 0)
	byID := make(map[string]*TodayScheduledWorkout)
	for rows.Next() {
		var (
			id, workoutName      string
			scheduledDate        time.Time
			swExerciseID, exID   string
			exName               string
			targetSets, position int
			targetReps           *int
			targetPrescriptNote  *string
			targetRPE            *float64
			sessionID, sessionSt *string
		)
		if err := rows.Scan(
			&id, &scheduledDate, &workoutName,
			&swExerciseID, &exID, &exName,
			&targetSets, &targetReps, &targetPrescriptNote, &targetRPE, &position,
			&sessionID, &sessionSt,
		); err != nil {
			return nil, fmt.Errorf("scheduledworkout: scan today row: %w", err)
		}

		sw, ok := byID[id]
		if !ok {
			sw = &TodayScheduledWorkout{
				ID:            id,
				ScheduledDate: scheduledDate.Format(dateLayout),
				WorkoutName:   workoutName,
				Exercises:     make([]ScheduledExercise, 0, 1),
			}
			if sessionID != nil {
				sw.Session = &Session{ID: *sessionID, Status: *sessionSt}
			}
			byID[id] = sw
			order = append(order, id)
		}

		sw.Exercises = append(sw.Exercises, ScheduledExercise{
			ScheduledWorkoutExerciseID: swExerciseID,
			ExerciseID:                 exID,
			Name:                       exName,
			Plan: Plan{
				Sets:             targetSets,
				Reps:             targetReps,
				PrescriptionNote: targetPrescriptNote,
				RPE:              targetRPE,
			},
			Position: position,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("scheduledworkout: iterate today rows: %w", err)
	}

	scheduled := make([]TodayScheduledWorkout, 0, len(order))
	for _, id := range order {
		scheduled = append(scheduled, *byID[id])
	}
	return scheduled, nil
}
