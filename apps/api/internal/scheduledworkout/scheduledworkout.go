// Package scheduledworkout implements the Coach-only, date-range list of
// ScheduledWorkouts that powers the Calendar frontend IA
// (docs/frontend-ui-spec.md, docs/go-backend-api-contract-v0.1.md §3.5).
//
// This is a read/list endpoint only: it returns summary data (athlete,
// workout, session status) for rendering a Calendar. Exercise prescriptions
// and set logs stay behind GET /sessions/{id} — deliberately not duplicated
// here.
package scheduledworkout

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

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

// ErrForbidden indicates the caller is authenticated but not authorized to
// list scheduled workouts (i.e. not a COACH).
var ErrForbidden = errors.New("scheduledworkout: caller is not a coach")

// ErrAthleteNotFound indicates the caller requested a specific athleteId
// that is not connected to them (or does not exist). Handlers map this to
// 404 NOT_FOUND rather than 403: this is a resource-scoping check, not a
// role check, and the API's general privacy principle avoids leaking
// whether the athlete account exists (docs/go-backend-api-contract-v0.1.md
// §1). Note this deliberately diverges from POST /scheduled-workouts, which
// still uses 403 for the analogous check — flagged as a future consistency
// cleanup, not addressed in this change.
var ErrAthleteNotFound = errors.New("scheduledworkout: athlete not found or not connected to caller")

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
		sw.ScheduledDate = scheduledDate.Format("2006-01-02")
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
