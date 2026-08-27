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
//
// Complete implements POST /sessions/{id}/complete (§3.7): the ACTIVE ->
// COMPLETED transition that makes a session permanently read-only.
//
// CreateSetLog implements POST /sessions/{id}/set-logs (§3.8) — the sole
// SetLog write entry point in V0.1 (Story 4). Manual UI, voice, and future
// AI commands all converge here.
package workoutsession

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// ErrCompleted indicates the session is already COMPLETED: either Start
// found an existing COMPLETED session for the ScheduledWorkout, or
// Complete was called on a session that is already COMPLETED. Neither
// case reactivates or mutates it. Handlers should map it to 409 CONFLICT.
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
// (200) an ordinary second call would take.
//
// Start also runs inside a transaction that takes the same `FOR UPDATE OF
// sw` lock on the scheduled_workouts row that scheduledworkout.Update takes
// (Problem B — editing a NOT_STARTED assignment). That is the mutual-
// exclusion boundary between the two: whichever of a concurrent Start/
// Update pair locks the row first runs to completion before the other
// proceeds, so Update's "no session yet" check can never be stale by the
// time it commits, and Start can never insert a session referencing a
// half-replaced snapshot.
func Start(ctx context.Context, pool *pgxpool.Pool, caller authn.User, scheduledWorkoutID string) (Session, bool, error) {
	if _, err := uuid.Parse(scheduledWorkoutID); err != nil {
		return Session{}, false, &ValidationError{Message: "id must be a valid UUID"}
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return Session{}, false, fmt.Errorf("workoutsession: begin transaction: %w", err)
	}
	defer tx.Rollback(ctx) // no-op once Commit succeeds

	athleteID, err := lookupAccessibleScheduledWorkout(ctx, tx, caller, scheduledWorkoutID)
	if err != nil {
		return Session{}, false, err
	}

	const insert = `
		INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at, completed_at)
		VALUES ($1, $2, $3, 'ACTIVE', now(), NULL)
		ON CONFLICT (scheduled_workout_id) DO NOTHING
		RETURNING id, status`

	var session Session
	var created bool
	err = tx.QueryRow(ctx, insert, uuid.NewString(), scheduledWorkoutID, athleteID).Scan(&session.ID, &session.Status)
	switch {
	case err == nil:
		created = true
	case errors.Is(err, pgx.ErrNoRows):
		// ON CONFLICT DO NOTHING fired: a session already exists (either
		// from a prior call, or a concurrent Start that just won the
		// race). Look it up and branch on its status.
		const existing = `SELECT id, status FROM workout_sessions WHERE scheduled_workout_id = $1`
		if err := tx.QueryRow(ctx, existing, scheduledWorkoutID).Scan(&session.ID, &session.Status); err != nil {
			return Session{}, false, fmt.Errorf("workoutsession: lookup existing session: %w", err)
		}
	default:
		return Session{}, false, fmt.Errorf("workoutsession: insert session: %w", err)
	}

	if !created && session.Status == "COMPLETED" {
		return Session{}, false, ErrCompleted
	}

	if err := tx.Commit(ctx); err != nil {
		return Session{}, false, fmt.Errorf("workoutsession: commit: %w", err)
	}
	return session, created, nil
}

// querier is satisfied by both *pgxpool.Pool and pgx.Tx, letting
// lookupAccessibleScheduledWorkout run either as a standalone read or (as
// Start uses it) inside a transaction that also holds the row lock its
// query takes.
type querier interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// lookupAccessibleScheduledWorkout returns scheduledWorkoutID's athlete_id
// if it exists and caller is authorized to start/resume its session (the
// athlete themself, or a coach with an **active** relationship: the
// coach_athletes row exists and both users have deleted_at IS NULL);
// otherwise ErrNotFound. Tombstoned counterparties cannot start/resume.
//
// The scheduled_workouts row is locked FOR UPDATE — see Start's concurrency
// comment above for why.
func lookupAccessibleScheduledWorkout(ctx context.Context, q querier, caller authn.User, scheduledWorkoutID string) (string, error) {
	const query = `SELECT athlete_id FROM scheduled_workouts WHERE id = $1 FOR UPDATE`

	var athleteID string
	err := q.QueryRow(ctx, query, scheduledWorkoutID).Scan(&athleteID)
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
		ok, err := hasActiveRelationship(ctx, q, caller.ID, athleteID)
		if err != nil {
			return "", err
		}
		if ok {
			return athleteID, nil
		}
	}

	return "", ErrNotFound
}

// Complete transitions sessionID from ACTIVE to COMPLETED
// (docs/go-backend-api-contract-v0.1.md §3.7). A completed session is
// permanently read-only: Complete never transitions COMPLETED back to
// ACTIVE, and does not touch completed_at on a session that is already
// COMPLETED.
//
// Authorization, checked in order:
//  1. sessionID must be a well-formed UUID -> else *ValidationError
//  2. the WorkoutSession must exist -> else ErrNotFound
//  3. caller must be that session's athlete, or a coach connected to that
//     athlete via coach_athletes -> else ErrNotFound
//
// The ACTIVE -> COMPLETED transition and the "already COMPLETED" check
// share one atomic UPDATE ... WHERE status = 'ACTIVE' statement rather
// than a separate read-then-write: whichever caller's UPDATE actually
// matches the row (status still ACTIVE at the time Postgres evaluates the
// WHERE clause) performs the transition; RETURNING producing no row means
// the session was already COMPLETED, mapped to ErrCompleted (the same
// sentinel Start uses for "session already completed" — both represent
// the same underlying session state).
//
// No explicit transaction, FOR UPDATE, or extra locking is needed: a
// single UPDATE statement takes Postgres's implicit row-level write lock
// for its own duration, which is exactly what CreateSetLog's per-attempt
// `SELECT status ... FOR SHARE` already waits on (or is waited on by) —
// see insertSetLogWithRetry. Two concurrent Complete calls on the same
// session serialize on that same row lock: the second one's WHERE clause
// is evaluated after the first commits, sees status is no longer ACTIVE,
// and matches zero rows.
func Complete(ctx context.Context, pool *pgxpool.Pool, caller authn.User, sessionID string) (Session, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return Session{}, &ValidationError{Message: "sessionId must be a valid UUID"}
	}

	header, err := lookupAccessibleSession(ctx, pool, caller, sessionID)
	if err != nil {
		return Session{}, err
	}
	if err := requireActiveCoachMutation(ctx, pool, caller, header.athleteID); err != nil {
		return Session{}, err
	}

	const complete = `
		UPDATE workout_sessions
		SET status = 'COMPLETED', completed_at = now()
		WHERE id = $1 AND status = 'ACTIVE'
		RETURNING id, status`

	var session Session
	err = pool.QueryRow(ctx, complete, sessionID).Scan(&session.ID, &session.Status)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Session{}, ErrCompleted
		}
		return Session{}, fmt.Errorf("workoutsession: complete session: %w", err)
	}

	return session, nil
}

// Athlete is the athlete summary embedded in a GET /sessions/{id} response
// (docs/go-backend-api-contract-v0.1.md §3.7).
type Athlete struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Plan is the fully resolved frozen prescription for one exercise. Its rows
// come from scheduled_workout_planned_sets; target_load_unit is inherited
// from the scheduled_workout_exercises snapshot parent. Neither field is
// ever read from the reusable Workout template.
type Plan struct {
	Sets []PlannedSet `json:"sets"`
}

// PlannedSet is one immutable planned target in an exercise's scheduled
// snapshot. Unit is only present when the target has a load.
type PlannedSet struct {
	ScheduledWorkoutPlannedSetID string   `json:"scheduledWorkoutPlannedSetId"`
	Position                     int      `json:"position"`
	Reps                         *int     `json:"reps,omitempty"`
	PrescriptionNote             *string  `json:"prescriptionNote,omitempty"`
	Load                         *float64 `json:"load,omitempty"`
	Unit                         *string  `json:"unit,omitempty"`
	RPE                          *float64 `json:"rpe,omitempty"`
}

// SetLog is one recorded set, scoped to a session and a
// scheduled_workout_exercise (docs/go-backend-api-contract-v0.1.md §3.7).
// Deliberately excludes createdAt — not part of this endpoint's response.
type SetLog struct {
	ID                           string   `json:"id"`
	Kind                         string   `json:"kind"`
	ScheduledWorkoutPlannedSetID *string  `json:"scheduledWorkoutPlannedSetId,omitempty"`
	PlannedPosition              *int     `json:"plannedPosition,omitempty"`
	SetNumber                    int      `json:"setNumber"`
	Load                         *float64 `json:"load,omitempty"`
	Unit                         *string  `json:"unit,omitempty"`
	Reps                         int      `json:"reps"`
	RPE                          *float64 `json:"rpe,omitempty"`
	LoggedByUserID               string   `json:"loggedByUserId"`
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

// lookupAccessibleSession resolves sessionID to its header if it exists
// and caller is authorized to **read** it: the session's athlete, or a
// coach with historical coach_athletes access (row exists even if a
// party is tombstoned). Mutations must also call requireActiveCoachMutation.
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

func requireActiveCoachMutation(ctx context.Context, q querier, caller authn.User, athleteID string) error {
	if caller.Role != "COACH" {
		return nil
	}
	ok, err := hasActiveRelationship(ctx, q, caller.ID, athleteID)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotFound
	}
	return nil
}

func hasActiveRelationship(ctx context.Context, q querier, coachID, athleteID string) (bool, error) {
	const query = `
		SELECT 1
		FROM coach_athletes ca
		JOIN users c ON c.id = ca.coach_id
		JOIN users a ON a.id = ca.athlete_id
		WHERE ca.coach_id = $1 AND ca.athlete_id = $2
		  AND c.deleted_at IS NULL
		  AND a.deleted_at IS NULL`
	var exists int
	err := q.QueryRow(ctx, query, coachID, athleteID).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("workoutsession: check active relationship: %w", err)
	}
	return true, nil
}

// loadExercisesWithSetLogs returns scheduledWorkoutID's snapshot exercises,
// canonical planned targets, and actual logs recorded during sessionID.
// Planned targets and actual logs deliberately use separate queries: joining
// both 1:N relationships would multiply each planned row by every SetLog.
func loadExercisesWithSetLogs(ctx context.Context, pool *pgxpool.Pool, sessionID, scheduledWorkoutID string) ([]Exercise, error) {
	exercises, byID, err := loadSnapshotExercises(ctx, pool, scheduledWorkoutID)
	if err != nil {
		return nil, err
	}

	if err := loadActualSetLogs(ctx, pool, sessionID, scheduledWorkoutID, byID); err != nil {
		return nil, err
	}
	for i := range exercises {
		exercises[i] = *byID[exercises[i].ScheduledWorkoutExerciseID]
	}
	return exercises, nil
}

// loadSnapshotExercises reads only the immutable snapshot rows. The scalar
// target_* compatibility columns on scheduled_workout_exercises are not read.
func loadSnapshotExercises(ctx context.Context, pool *pgxpool.Pool, scheduledWorkoutID string) ([]Exercise, map[string]*Exercise, error) {
	const query = `
		SELECT swe.id, swe.exercise_name,
		       p.id, p.planned_position, p.target_reps, p.target_prescription_note, p.target_load,
		       CASE WHEN p.target_load IS NULL THEN NULL ELSE swe.target_load_unit END,
		       p.target_rpe
		FROM scheduled_workout_exercises swe
		JOIN scheduled_workout_planned_sets p ON p.scheduled_workout_exercise_id = swe.id
		WHERE swe.scheduled_workout_id = $1
		ORDER BY swe.position, p.planned_position`

	rows, err := pool.Query(ctx, query, scheduledWorkoutID)
	if err != nil {
		return nil, nil, fmt.Errorf("workoutsession: load planned exercises: %w", err)
	}
	defer rows.Close()

	order := make([]string, 0)
	byID := make(map[string]*Exercise)
	for rows.Next() {
		var (
			swExerciseID, exerciseName string
			plannedSet                 PlannedSet
		)
		if err := rows.Scan(
			&swExerciseID, &exerciseName,
			&plannedSet.ScheduledWorkoutPlannedSetID, &plannedSet.Position, &plannedSet.Reps, &plannedSet.PrescriptionNote, &plannedSet.Load, &plannedSet.Unit, &plannedSet.RPE,
		); err != nil {
			return nil, nil, fmt.Errorf("workoutsession: scan planned exercise row: %w", err)
		}

		ex, ok := byID[swExerciseID]
		if !ok {
			ex = &Exercise{
				ScheduledWorkoutExerciseID: swExerciseID,
				Name:                       exerciseName,
				Plan:                       Plan{Sets: make([]PlannedSet, 0)},
				SetLogs:                    make([]SetLog, 0),
			}
			byID[swExerciseID] = ex
			order = append(order, swExerciseID)
		}
		ex.Plan.Sets = append(ex.Plan.Sets, plannedSet)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, fmt.Errorf("workoutsession: iterate planned exercise rows: %w", err)
	}

	exercises := make([]Exercise, 0, len(order))
	for _, id := range order {
		exercises = append(exercises, *byID[id])
	}
	return exercises, byID, nil
}

// loadActualSetLogs reads actual performance separately from planned targets.
// planned_position is joined only to label a non-null explicit association;
// it is never inferred from set_number.
func loadActualSetLogs(ctx context.Context, pool *pgxpool.Pool, sessionID, scheduledWorkoutID string, byID map[string]*Exercise) error {
	const query = `
		SELECT sl.scheduled_workout_exercise_id,
		       sl.id, sl.scheduled_workout_planned_set_id, p.planned_position,
		       sl.set_number, sl.load, sl.unit, sl.reps, sl.rpe, sl.logged_by_user_id
		FROM set_logs sl
		JOIN scheduled_workout_exercises swe ON swe.id = sl.scheduled_workout_exercise_id
		LEFT JOIN scheduled_workout_planned_sets p
		  ON p.id = sl.scheduled_workout_planned_set_id
		 AND p.scheduled_workout_exercise_id = sl.scheduled_workout_exercise_id
		WHERE sl.session_id = $1 AND swe.scheduled_workout_id = $2
		ORDER BY swe.position, sl.set_number`

	rows, err := pool.Query(ctx, query, sessionID, scheduledWorkoutID)
	if err != nil {
		return fmt.Errorf("workoutsession: load actual set logs: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			swExerciseID string
			setLog       SetLog
		)
		if err := rows.Scan(
			&swExerciseID,
			&setLog.ID, &setLog.ScheduledWorkoutPlannedSetID, &setLog.PlannedPosition,
			&setLog.SetNumber, &setLog.Load, &setLog.Unit, &setLog.Reps, &setLog.RPE, &setLog.LoggedByUserID,
		); err != nil {
			return fmt.Errorf("workoutsession: scan actual set-log row: %w", err)
		}

		ex, ok := byID[swExerciseID]
		if !ok {
			return fmt.Errorf("workoutsession: actual set log belongs to an exercise outside the snapshot")
		}
		if setLog.ScheduledWorkoutPlannedSetID == nil {
			setLog.Kind = "EXTRA"
		} else {
			setLog.Kind = "PLANNED"
		}
		ex.SetLogs = append(ex.SetLogs, setLog)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("workoutsession: iterate actual set-log rows: %w", err)
	}
	return nil
}

// ErrSessionNotActive indicates the session exists and is accessible to
// caller, but is not ACTIVE (i.e. COMPLETED). SetLog writes are only valid
// against an ACTIVE session (docs/go-backend-api-contract-v0.1.md §3.8).
// Handlers should map it to 409 CONFLICT.
var ErrSessionNotActive = errors.New("workoutsession: session is not ACTIVE")

// ErrExerciseNotInSession indicates the request's scheduledWorkoutExerciseId
// does not belong to this session's scheduled_workout — either it doesn't
// exist, or it belongs to a different ScheduledWorkout entirely. Handlers
// should map it to 400 INVALID_ARGUMENT, not 404: this is a request-shape
// error, not a resource-scoping privacy check (docs/
// go-backend-api-contract-v0.1.md §3.8).
var ErrExerciseNotInSession = errors.New("workoutsession: scheduledWorkoutExerciseId does not belong to this session")

// ErrPlannedSetNotInSession indicates a PLANNED request references a frozen
// target that is not part of the requested snapshot exercise in this session.
// This is invalid request association, not a resource-scoping lookup.
var ErrPlannedSetNotInSession = errors.New("workoutsession: scheduledWorkoutPlannedSetId does not belong to this session exercise")

// ErrPlannedSetAlreadyLogged indicates a normal actual log has already
// claimed the frozen target. Handlers map it to 409 CONFLICT.
var ErrPlannedSetAlreadyLogged = errors.New("workoutsession: scheduled planned set already logged")

// setLogSetNumberConstraint is the exact, auto-generated name of the
// UNIQUE (session_id, scheduled_workout_exercise_id, set_number) constraint
// (confirmed against the live schema, not assumed from naming convention —
// Postgres truncates it to 63 bytes). CreateSetLog retries only a 23505
// naming this constraint; any other unique violation (e.g. an id/pkey
// collision) is a genuine bug and must not be silently retried.
const setLogSetNumberConstraint = "set_logs_session_id_scheduled_workout_exercise_id_set_numbe_key"

// plannedTargetClaimIndex is the partial uniqueness backstop for PLANNED
// logs. It is intentionally distinct from setLogSetNumberConstraint: target
// claim conflicts are domain conflicts, never chronology retries.
const plannedTargetClaimIndex = "set_logs_one_planned_target_per_session_idx"

// maxSetLogInsertAttempts is one initial attempt plus up to three
// whole-transaction retries on the expected set-number 23505 (docs/
// go-backend-api-contract-v0.1.md §3.8 setNumber concurrency handling).
const maxSetLogInsertAttempts = 4

// CreateSetLogInput is the decoded, wire-format-independent request for
// CreateSetLog. Pointer fields preserve optional-field semantics: Load 0 is
// valid while nil means bodyweight/no load, and nil Reps means the required
// field was omitted rather than supplied as an invalid zero.
type CreateSetLogInput struct {
	ScheduledWorkoutExerciseID   string
	Kind                         string
	ScheduledWorkoutPlannedSetID *string
	Load                         *float64
	Unit                         *string
	Reps                         *int
	RPE                          *float64
}

// validate applies §3.8's request and actual-field rules, independent of DB
// access:
//   - kind: exactly PLANNED or EXTRA, with its matching target-ID rule
//   - reps: required, integer, >= 1
//   - load: optional; if present, >= 0 and unit is required (kg or lb)
//   - unit: must be nil exactly when load is nil
//   - rpe: optional; if present, 1-10
func (in CreateSetLogInput) validate() error {
	if in.Kind != "PLANNED" && in.Kind != "EXTRA" {
		return &ValidationError{Message: "kind must be 'PLANNED' or 'EXTRA'"}
	}
	if in.Kind == "PLANNED" && in.ScheduledWorkoutPlannedSetID == nil {
		return &ValidationError{Message: "scheduledWorkoutPlannedSetId is required when kind is PLANNED"}
	}
	if in.Kind == "EXTRA" && in.ScheduledWorkoutPlannedSetID != nil {
		return &ValidationError{Message: "scheduledWorkoutPlannedSetId must be omitted when kind is EXTRA"}
	}
	if in.Reps == nil {
		return &ValidationError{Message: "reps is required"}
	}
	if *in.Reps < 1 {
		return &ValidationError{Message: "reps must be >= 1"}
	}
	if in.Load == nil {
		if in.Unit != nil {
			return &ValidationError{Message: "unit must be omitted when load is omitted"}
		}
	} else {
		if *in.Load < 0 {
			return &ValidationError{Message: "load must be >= 0"}
		}
		if in.Unit == nil {
			return &ValidationError{Message: "unit is required when load is present"}
		}
		if *in.Unit != "kg" && *in.Unit != "lb" {
			return &ValidationError{Message: "unit must be 'kg' or 'lb'"}
		}
	}
	if in.RPE != nil && (*in.RPE < 1 || *in.RPE > 10) {
		return &ValidationError{Message: "rpe must be between 1 and 10"}
	}
	return nil
}

// CreateSetLog records one performed set against an ACTIVE session's
// scheduled_workout_exercise (docs/go-backend-api-contract-v0.1.md §3.8).
//
// Checked in order:
//  1. sessionID must be a well-formed UUID -> else *ValidationError
//  2. the session must exist and caller must be its athlete, or a coach
//     connected to that athlete -> else ErrNotFound
//  3. the session must be ACTIVE -> else ErrSessionNotActive
//  4. input.ScheduledWorkoutExerciseID must be a well-formed UUID -> else
//     *ValidationError
//  5. field validation (reps/load/unit/rpe) -> else *ValidationError
//  6. input.ScheduledWorkoutExerciseID must belong to this session's
//     scheduled_workout -> else ErrExerciseNotInSession
//  7. a PLANNED target must belong to that same snapshot exercise -> else
//     ErrPlannedSetNotInSession
//
// setNumber is always server-computed, never trusted from the client;
// loggedByUserId is always caller.ID.
func CreateSetLog(ctx context.Context, pool *pgxpool.Pool, caller authn.User, sessionID string, input CreateSetLogInput) (SetLog, error) {
	if _, err := uuid.Parse(sessionID); err != nil {
		return SetLog{}, &ValidationError{Message: "sessionId must be a valid UUID"}
	}

	header, err := lookupAccessibleSession(ctx, pool, caller, sessionID)
	if err != nil {
		return SetLog{}, err
	}
	if err := requireActiveCoachMutation(ctx, pool, caller, header.athleteID); err != nil {
		return SetLog{}, err
	}
	if header.status != "ACTIVE" {
		return SetLog{}, ErrSessionNotActive
	}

	if _, err := uuid.Parse(input.ScheduledWorkoutExerciseID); err != nil {
		return SetLog{}, &ValidationError{Message: "scheduledWorkoutExerciseId must be a valid UUID"}
	}
	if err := input.validate(); err != nil {
		return SetLog{}, err
	}
	if input.ScheduledWorkoutPlannedSetID != nil {
		if _, err := uuid.Parse(*input.ScheduledWorkoutPlannedSetID); err != nil {
			return SetLog{}, &ValidationError{Message: "scheduledWorkoutPlannedSetId must be a valid UUID"}
		}
	}

	belongs, err := scheduledWorkoutExerciseBelongsTo(ctx, pool, input.ScheduledWorkoutExerciseID, header.scheduledWorkoutID)
	if err != nil {
		return SetLog{}, fmt.Errorf("workoutsession: check exercise ownership: %w", err)
	}
	if !belongs {
		return SetLog{}, ErrExerciseNotInSession
	}
	if input.Kind == "PLANNED" {
		belongs, err := plannedSetBelongsToSessionExercise(ctx, pool, *input.ScheduledWorkoutPlannedSetID, input.ScheduledWorkoutExerciseID, header.scheduledWorkoutID)
		if err != nil {
			return SetLog{}, fmt.Errorf("workoutsession: check planned-set ownership: %w", err)
		}
		if !belongs {
			return SetLog{}, ErrPlannedSetNotInSession
		}
	}

	return insertSetLogWithRetry(ctx, pool, caller, sessionID, header.scheduledWorkoutID, input)
}

// scheduledWorkoutExerciseBelongsTo reports whether scheduledWorkoutExerciseID
// is a snapshot exercise of scheduledWorkoutID — the session's own
// scheduled_workout, not some other one (docs/go-backend-api-contract-v0.1.md
// §3.8 rule 3).
func scheduledWorkoutExerciseBelongsTo(ctx context.Context, pool *pgxpool.Pool, scheduledWorkoutExerciseID, scheduledWorkoutID string) (bool, error) {
	const query = `SELECT 1 FROM scheduled_workout_exercises WHERE id = $1 AND scheduled_workout_id = $2`
	var exists int
	err := pool.QueryRow(ctx, query, scheduledWorkoutExerciseID, scheduledWorkoutID).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// plannedSetBelongsToSessionExercise verifies the complete request chain:
// planned target -> requested snapshot exercise -> session snapshot.
func plannedSetBelongsToSessionExercise(ctx context.Context, pool *pgxpool.Pool, plannedSetID, scheduledWorkoutExerciseID, scheduledWorkoutID string) (bool, error) {
	const query = `
		SELECT 1
		FROM scheduled_workout_planned_sets p
		JOIN scheduled_workout_exercises swe ON swe.id = p.scheduled_workout_exercise_id
		WHERE p.id = $1
		  AND p.scheduled_workout_exercise_id = $2
		  AND swe.scheduled_workout_id = $3`
	var exists int
	err := pool.QueryRow(ctx, query, plannedSetID, scheduledWorkoutExerciseID, scheduledWorkoutID).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// insertSetLogWithRetry computes setNumber and inserts the SetLog inside a
// fresh transaction per attempt (docs/go-backend-api-contract-v0.1.md §3.8
// setNumber concurrency handling).
//
// Each attempt is its own whole transaction, not a single transaction
// retried in place: PostgreSQL aborts a transaction on any statement error,
// including the unique violation this function expects to sometimes hit, so
// nothing further can run on that same transaction until it is rolled back.
// Rather than working around that with a SAVEPOINT, each retry opens a
// brand-new transaction and recomputes MAX(set_number) — simpler to reason
// about, and retries are the uncommon case (only genuine concurrent writes
// to the same session+exercise).
//
// Every attempt re-reads workout_sessions.status FOR SHARE before computing
// setNumber, guarding against a concurrent session-completion transition
// mid-retry-loop (no such endpoint exists yet in V0.1, but the guard is
// cheap and matches the contract's "session must be ACTIVE" rule holding at
// insert time, not just at the start of the request).
//
// Only a 23505 on setLogSetNumberConstraint is treated as expected and
// retried; any other error (including a 23505 on a different constraint,
// e.g. a pkey collision) is returned immediately, not masked as a
// setNumber race.
func insertSetLogWithRetry(ctx context.Context, pool *pgxpool.Pool, caller authn.User, sessionID, scheduledWorkoutID string, input CreateSetLogInput) (SetLog, error) {
	const statusForShare = `SELECT status FROM workout_sessions WHERE id = $1 FOR SHARE`
	const lockPlannedSet = `
		SELECT p.planned_position
		FROM scheduled_workout_planned_sets p
		JOIN scheduled_workout_exercises swe ON swe.id = p.scheduled_workout_exercise_id
		WHERE p.id = $1
		  AND p.scheduled_workout_exercise_id = $2
		  AND swe.scheduled_workout_id = $3
		FOR UPDATE OF p`
	const plannedSetAlreadyClaimed = `
		SELECT EXISTS (
			SELECT 1 FROM set_logs
			WHERE session_id = $1 AND scheduled_workout_planned_set_id = $2
		)`
	const nextSetNumber = `
		SELECT COALESCE(MAX(set_number), 0) + 1
		FROM set_logs
		WHERE session_id = $1 AND scheduled_workout_exercise_id = $2`
	const insert = `
		INSERT INTO set_logs (id, session_id, scheduled_workout_exercise_id, scheduled_workout_planned_set_id, set_number, load, unit, reps, rpe, logged_by_user_id, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
		RETURNING id, set_number, load, unit, reps, rpe, logged_by_user_id`

	var lastErr error
	for attempt := 1; attempt <= maxSetLogInsertAttempts; attempt++ {
		setLog, err := func() (SetLog, error) {
			tx, err := pool.Begin(ctx)
			if err != nil {
				return SetLog{}, fmt.Errorf("workoutsession: begin set-log transaction: %w", err)
			}
			defer tx.Rollback(ctx)

			var status string
			if err := tx.QueryRow(ctx, statusForShare, sessionID).Scan(&status); err != nil {
				return SetLog{}, fmt.Errorf("workoutsession: lock session status: %w", err)
			}
			if status != "ACTIVE" {
				return SetLog{}, ErrSessionNotActive
			}

			var plannedPosition *int
			if input.Kind == "PLANNED" {
				var position int
				if err := tx.QueryRow(ctx, lockPlannedSet, *input.ScheduledWorkoutPlannedSetID, input.ScheduledWorkoutExerciseID, scheduledWorkoutID).Scan(&position); err != nil {
					if errors.Is(err, pgx.ErrNoRows) {
						return SetLog{}, ErrPlannedSetNotInSession
					}
					return SetLog{}, fmt.Errorf("workoutsession: lock planned set: %w", err)
				}
				plannedPosition = &position

				var claimed bool
				if err := tx.QueryRow(ctx, plannedSetAlreadyClaimed, sessionID, *input.ScheduledWorkoutPlannedSetID).Scan(&claimed); err != nil {
					return SetLog{}, fmt.Errorf("workoutsession: check planned-set claim: %w", err)
				}
				if claimed {
					return SetLog{}, ErrPlannedSetAlreadyLogged
				}
			}

			var setNumber int
			if err := tx.QueryRow(ctx, nextSetNumber, sessionID, input.ScheduledWorkoutExerciseID).Scan(&setNumber); err != nil {
				return SetLog{}, fmt.Errorf("workoutsession: compute next set number: %w", err)
			}

			var s SetLog
			err = tx.QueryRow(ctx, insert,
				uuid.NewString(), sessionID, input.ScheduledWorkoutExerciseID, input.ScheduledWorkoutPlannedSetID, setNumber,
				input.Load, input.Unit, *input.Reps, input.RPE, caller.ID,
			).Scan(&s.ID, &s.SetNumber, &s.Load, &s.Unit, &s.Reps, &s.RPE, &s.LoggedByUserID)
			if err != nil {
				return SetLog{}, err
			}
			s.Kind = input.Kind
			if input.Kind == "PLANNED" {
				s.ScheduledWorkoutPlannedSetID = input.ScheduledWorkoutPlannedSetID
				s.PlannedPosition = plannedPosition
			}

			if err := tx.Commit(ctx); err != nil {
				return SetLog{}, fmt.Errorf("workoutsession: commit set-log transaction: %w", err)
			}
			return s, nil
		}()

		if err == nil {
			return setLog, nil
		}
		if errors.Is(err, ErrSessionNotActive) {
			return SetLog{}, err
		}
		if errors.Is(err, ErrPlannedSetNotInSession) || errors.Is(err, ErrPlannedSetAlreadyLogged) {
			return SetLog{}, err
		}
		if isPlannedTargetClaimConflict(err) {
			return SetLog{}, ErrPlannedSetAlreadyLogged
		}
		if isSetNumberConflict(err) {
			lastErr = err
			continue
		}
		return SetLog{}, fmt.Errorf("workoutsession: insert set log: %w", err)
	}

	return SetLog{}, fmt.Errorf("workoutsession: exhausted %d set-log insert attempts, last error: %w", maxSetLogInsertAttempts, lastErr)
}

// isSetNumberConflict reports whether err is exactly the expected
// UNIQUE (session_id, scheduled_workout_exercise_id, set_number) violation
// — the only conflict CreateSetLog's retry loop should ever swallow.
func isSetNumberConflict(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == setLogSetNumberConstraint
}

// isPlannedTargetClaimConflict identifies the partial unique index used as
// the final concurrency backstop for normal planned-target claims.
func isPlannedTargetClaimConflict(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505" && pgErr.ConstraintName == plannedTargetClaimIndex
}
