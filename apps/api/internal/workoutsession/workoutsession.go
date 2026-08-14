// Package workoutsession implements WorkoutSession Start/Resume and the
// shared plan-vs-actual read model (docs/go-backend-api-contract-v0.1.md
// §3.7): POST /scheduled-workouts/{id}/session and GET /sessions/{id}.
//
// A ScheduledWorkout has at most one WorkoutSession
// (workout_sessions.scheduled_workout_id is UNIQUE — docs/
// database-schema-relationships.md §6). Start is idempotent: calling it
// again on an ACTIVE session resumes it instead of erroring; calling it on
// a COMPLETED session conflicts rather than reactivating it.
//
// Get returns the same session detail to both the athlete themself and a
// connected coach — Story 2 (live 1:1 coaching) and Story 7 (coach review)
// share this one read model rather than a coach-only view. Both ACTIVE and
// COMPLETED sessions are readable; a completed session is read-only, not
// hidden.
package workoutsession

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// Session is the response shape for POST /scheduled-workouts/{id}/session
// (docs/go-backend-api-contract-v0.1.md §3.7). Deliberately minimal — no
// athleteId/scheduledWorkoutId/startedAt/completedAt: full session detail
// belongs to the future GET /sessions/{id}, not this endpoint.
type Session struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// ErrNotFound covers both "no such ScheduledWorkout" and "caller is not
// that ScheduledWorkout's athlete or a connected coach". These are
// deliberately indistinguishable to the caller: this is a resource-scoping
// check, not a role check, and the API's privacy principle (docs/
// go-backend-api-contract-v0.1.md §1) avoids leaking whether an
// inaccessible ScheduledWorkout exists.
var ErrNotFound = errors.New("workoutsession: scheduled workout not found or not accessible to caller")

// ErrCompleted indicates the ScheduledWorkout's session already exists and
// is COMPLETED. Start does not reactivate or mutate it.
var ErrCompleted = errors.New("workoutsession: session already completed")

// ValidationError indicates the request failed shape validation before any
// DB access. Handlers should map it to 400 INVALID_ARGUMENT.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// Start begins training for scheduledWorkoutID, or resumes its existing
// ACTIVE session (docs/go-backend-api-contract-v0.1.md §3.7).
//
// created reports whether this call created the session (true -> handler
// sends 201) versus resumed an existing ACTIVE one (false -> handler sends
// 200).
//
// Authorization, checked in order:
//  1. scheduledWorkoutID must be a well-formed UUID -> else *ValidationError
//  2. the ScheduledWorkout must exist -> else ErrNotFound
//  3. caller must be that ScheduledWorkout's athlete, or a coach connected
//     to that athlete via coach_athletes -> else ErrNotFound
//
// Concurrency: two concurrent first-time Start calls for the same
// scheduledWorkoutID can both pass authorization and both attempt the
// INSERT below. workout_sessions.scheduled_workout_id's UNIQUE constraint
// is the correctness boundary, not application logic: INSERT ... ON
// CONFLICT DO NOTHING lets exactly one caller's INSERT return a row (the
// creator, 201); the other gets no row back and falls through to the
// existing-row SELECT below, converging on the same idempotent-resume path
// (200) an ordinary second call would take. No transaction, lock, or
// elevated isolation level is used or needed.
func Start(ctx context.Context, pool *pgxpool.Pool, caller authn.User, scheduledWorkoutID string) (Session, bool, error) {
	if _, err := uuid.Parse(scheduledWorkoutID); err != nil {
		return Session{}, false, &ValidationError{Message: "id must be a valid UUID"}
	}

	athleteID, err := lookupAccessibleScheduledWorkout(ctx, pool, caller, scheduledWorkoutID)
	if err != nil {
		return Session{}, false, err
	}

	const insert = `
		INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at, completed_at)
		VALUES ($1, $2, $3, 'ACTIVE', now(), NULL)
		ON CONFLICT (scheduled_workout_id) DO NOTHING
		RETURNING id, status`

	var session Session
	err = pool.QueryRow(ctx, insert, uuid.NewString(), scheduledWorkoutID, athleteID).Scan(&session.ID, &session.Status)
	if err == nil {
		return session, true, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Session{}, false, fmt.Errorf("workoutsession: insert session: %w", err)
	}

	// ON CONFLICT DO NOTHING fired: a session already exists (either from a
	// prior call, or a concurrent Start that just won the race). Look it up
	// and branch on its status.
	const existing = `SELECT id, status FROM workout_sessions WHERE scheduled_workout_id = $1`
	if err := pool.QueryRow(ctx, existing, scheduledWorkoutID).Scan(&session.ID, &session.Status); err != nil {
		return Session{}, false, fmt.Errorf("workoutsession: lookup existing session: %w", err)
	}

	if session.Status == "COMPLETED" {
		return Session{}, false, ErrCompleted
	}
	return session, false, nil
}

// lookupAccessibleScheduledWorkout returns scheduledWorkoutID's athlete_id
// if it exists and caller is authorized to start/resume its session (the
// athlete themself, or a coach connected to that athlete via
// coach_athletes); otherwise ErrNotFound. Deliberately does not export or
// reuse scheduledworkout.isConnected — this is a small, local lookup
// specific to this endpoint's authorization needs.
func lookupAccessibleScheduledWorkout(ctx context.Context, pool *pgxpool.Pool, caller authn.User, scheduledWorkoutID string) (string, error) {
	const query = `SELECT athlete_id FROM scheduled_workouts WHERE id = $1`

	var athleteID string
	err := pool.QueryRow(ctx, query, scheduledWorkoutID).Scan(&athleteID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", ErrNotFound
		}
		return "", fmt.Errorf("workoutsession: lookup scheduled workout: %w", err)
	}

	if caller.Role == "ATHLETE" && caller.ID == athleteID {
		return athleteID, nil
	}

	if caller.Role == "COACH" {
		const connectedQuery = `SELECT 1 FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`
		var exists int
		err := pool.QueryRow(ctx, connectedQuery, caller.ID, athleteID).Scan(&exists)
		if err == nil {
			return athleteID, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("workoutsession: check coach connection: %w", err)
		}
	}

	return "", ErrNotFound
}

// Athlete is the athlete summary embedded in a GET /sessions/{id} response
// (docs/go-backend-api-contract-v0.1.md §3.7).
type Athlete struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Plan is the frozen prescription for one exercise, read from
// scheduled_workout_exercises only — never from the current workout
// template or exercise (docs/go-backend-api-contract-v0.1.md §2 snapshot
// precedence rule).
type Plan struct {
	Sets             int      `json:"sets"`
	Reps             *int     `json:"reps,omitempty"`
	PrescriptionNote *string  `json:"prescriptionNote,omitempty"`
	RPE              *float64 `json:"rpe,omitempty"`
}

// SetLog is one recorded set, scoped to a session and a
// scheduled_workout_exercise (docs/go-backend-api-contract-v0.1.md §3.7).
// Deliberately excludes createdAt — not part of this endpoint's response.
type SetLog struct {
	ID             string   `json:"id"`
	SetNumber      int      `json:"setNumber"`
	Load           *float64 `json:"load,omitempty"`
	Unit           *string  `json:"unit,omitempty"`
	Reps           int      `json:"reps"`
	RPE            *float64 `json:"rpe,omitempty"`
	LoggedByUserID string   `json:"loggedByUserId"`
}

// Exercise is one ScheduledWorkoutExercise with its plan and the SetLogs
// performed against it during this session. SetLogs is never null — an
// exercise with zero recorded sets still appears with an empty array.
type Exercise struct {
	ScheduledWorkoutExerciseID string   `json:"scheduledWorkoutExerciseId"`
	Name                       string   `json:"name"`
	Plan                       Plan     `json:"plan"`
	SetLogs                    []SetLog `json:"setLogs"`
}

// SessionDetail is the response shape for GET /sessions/{sessionId}
// (docs/go-backend-api-contract-v0.1.md §3.7): the shared plan-vs-actual
// read model for Story 2 (live 1:1 coaching) and Story 7 (coach review).
type SessionDetail struct {
	ID        string     `json:"id"`
	Status    string     `json:"status"`
	Athlete   Athlete    `json:"athlete"`
	Exercises []Exercise `json:"exercises"`
}

// sessionHeader is the internal result of the authorization lookup in Get.
// scheduledWorkoutID is not part of the public response — it's only used
// to scope the exercises/set-logs query in step 2.
type sessionHeader struct {
	id                 string
	status             string
	athleteID          string
	athleteName        string
	scheduledWorkoutID string
}

// Get returns the plan-vs-actual detail for sessionID
// (docs/go-backend-api-contract-v0.1.md §3.7).
//
// Authorization, checked in order:
//  1. sessionID must be a well-formed UUID -> else *ValidationError
//  2. the WorkoutSession must exist -> else ErrNotFound
//  3. caller must be that session's athlete, or a coach connected to that
//     athlete via coach_athletes -> else ErrNotFound
//
// Both ACTIVE and COMPLETED sessions are returned; unlike Start, Get never
// returns ErrCompleted — a completed session is read-only, not invisible.
//
// Loading is two queries, not one: a header query resolves and
// authorizes the session, then a second query loads its snapshot
// exercises LEFT JOINed to this session's SetLogs, grouped in Go so each
// ScheduledWorkoutExercise appears exactly once regardless of how many
// SetLogs (including zero) it has.
func Get(ctx context.Context, pool *pgxpool.Pool, caller authn.User, sessionID string) (SessionDetail, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return SessionDetail{}, &ValidationError{Message: "sessionId must be a valid UUID"}
	}

	header, err := lookupAccessibleSession(ctx, pool, caller, sessionID)
	if err != nil {
		return SessionDetail{}, err
	}

	exercises, err := loadExercisesWithSetLogs(ctx, pool, sessionID, header.scheduledWorkoutID)
	if err != nil {
		return SessionDetail{}, err
	}

	return SessionDetail{
		ID:     header.id,
		Status: header.status,
		Athlete: Athlete{
			ID:   header.athleteID,
			Name: header.athleteName,
		},
		Exercises: exercises,
	}, nil
}

// lookupAccessibleSession resolves sessionID to its header (status,
// athlete, and owning scheduled_workout_id) if it exists and caller is
// authorized to read it (the session's athlete, or a coach connected to
// that athlete via coach_athletes); otherwise ErrNotFound. Nonexistent and
// inaccessible are deliberately indistinguishable, matching Start's
// privacy principle (docs/go-backend-api-contract-v0.1.md §1).
func lookupAccessibleSession(ctx context.Context, pool *pgxpool.Pool, caller authn.User, sessionID string) (sessionHeader, error) {
	const query = `
		SELECT ws.id, ws.status, ws.scheduled_workout_id, u.id, u.name
		FROM workout_sessions ws
		JOIN users u ON u.id = ws.athlete_id
		WHERE ws.id = $1`

	var h sessionHeader
	err := pool.QueryRow(ctx, query, sessionID).Scan(&h.id, &h.status, &h.scheduledWorkoutID, &h.athleteID, &h.athleteName)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return sessionHeader{}, ErrNotFound
		}
		return sessionHeader{}, fmt.Errorf("workoutsession: lookup session: %w", err)
	}

	if caller.Role == "ATHLETE" && caller.ID == h.athleteID {
		return h, nil
	}

	if caller.Role == "COACH" {
		const connectedQuery = `SELECT 1 FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`
		var exists int
		err := pool.QueryRow(ctx, connectedQuery, caller.ID, h.athleteID).Scan(&exists)
		if err == nil {
			return h, nil
		}
		if !errors.Is(err, pgx.ErrNoRows) {
			return sessionHeader{}, fmt.Errorf("workoutsession: check coach connection: %w", err)
		}
	}

	return sessionHeader{}, ErrNotFound
}

// loadExercisesWithSetLogs returns scheduledWorkoutID's snapshot exercises,
// each with the SetLogs recorded against it during sessionID.
//
// The LEFT JOIN is scoped by BOTH sl.session_id = sessionID AND
// sl.scheduled_workout_exercise_id = swe.id: the double condition keeps
// another WorkoutSession's SetLogs (a prior attempt at the same
// ScheduledWorkoutExercise, in principle) from ever leaking into this
// response, and still preserves exercises with zero logs via the LEFT
// JOIN (an inner join would silently drop them).
//
// Display fields (name, target sets/reps/note/rpe) come from
// scheduled_workout_exercises only, never from workout_exercises or
// exercises — the frozen-snapshot rule (docs/go-backend-api-contract-v0.1.md
// §2). Rows are ordered by swe.position then sl.set_number, and grouped in
// Go keyed by scheduled_workout_exercise id in first-seen order, so each
// exercise appears exactly once with its SetLogs in setNumber order.
func loadExercisesWithSetLogs(ctx context.Context, pool *pgxpool.Pool, sessionID, scheduledWorkoutID string) ([]Exercise, error) {
	const query = `
		SELECT swe.id, swe.exercise_name, swe.target_sets, swe.target_reps, swe.target_prescription_note, swe.target_rpe,
		       sl.id, sl.set_number, sl.load, sl.unit, sl.reps, sl.rpe, sl.logged_by_user_id
		FROM scheduled_workout_exercises swe
		LEFT JOIN set_logs sl ON sl.session_id = $1 AND sl.scheduled_workout_exercise_id = swe.id
		WHERE swe.scheduled_workout_id = $2
		ORDER BY swe.position, sl.set_number`

	rows, err := pool.Query(ctx, query, sessionID, scheduledWorkoutID)
	if err != nil {
		return nil, fmt.Errorf("workoutsession: load exercises: %w", err)
	}
	defer rows.Close()

	order := make([]string, 0)
	byID := make(map[string]*Exercise)
	for rows.Next() {
		var (
			swExerciseID, exerciseName string
			targetSets                 int
			targetReps                 *int
			targetPrescriptionNote     *string
			targetRPE                  *float64
			setLogID                   *string
			setNumber                  *int
			load                       *float64
			unit                       *string
			reps                       *int
			rpe                        *float64
			loggedByUserID             *string
		)
		if err := rows.Scan(
			&swExerciseID, &exerciseName, &targetSets, &targetReps, &targetPrescriptionNote, &targetRPE,
			&setLogID, &setNumber, &load, &unit, &reps, &rpe, &loggedByUserID,
		); err != nil {
			return nil, fmt.Errorf("workoutsession: scan exercise row: %w", err)
		}

		ex, ok := byID[swExerciseID]
		if !ok {
			ex = &Exercise{
				ScheduledWorkoutExerciseID: swExerciseID,
				Name:                       exerciseName,
				Plan: Plan{
					Sets:             targetSets,
					Reps:             targetReps,
					PrescriptionNote: targetPrescriptionNote,
					RPE:              targetRPE,
				},
				SetLogs: make([]SetLog, 0),
			}
			byID[swExerciseID] = ex
			order = append(order, swExerciseID)
		}

		if setLogID != nil {
			ex.SetLogs = append(ex.SetLogs, SetLog{
				ID:             *setLogID,
				SetNumber:      *setNumber,
				Load:           load,
				Unit:           unit,
				Reps:           *reps,
				RPE:            rpe,
				LoggedByUserID: *loggedByUserID,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("workoutsession: iterate exercise rows: %w", err)
	}

	exercises := make([]Exercise, 0, len(order))
	for _, id := range order {
		exercises = append(exercises, *byID[id])
	}
	return exercises, nil
}
