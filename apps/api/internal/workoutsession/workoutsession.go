// Package workoutsession implements Start/Resume for WorkoutSession
// (docs/go-backend-api-contract-v0.1.md §3.7): POST
// /scheduled-workouts/{id}/session.
//
// A ScheduledWorkout has at most one WorkoutSession
// (workout_sessions.scheduled_workout_id is UNIQUE — docs/
// database-schema-relationships.md §6). Start is idempotent: calling it
// again on an ACTIVE session resumes it instead of erroring; calling it on
// a COMPLETED session conflicts rather than reactivating it.
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
