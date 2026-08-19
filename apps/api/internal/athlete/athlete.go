// Package athlete implements the Coach-only view of a coach's connected
// athletes, via the coach_athletes relationship.
package athlete

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// Athlete is the response shape for GET /api/v1/athletes.
type Athlete struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

// ErrForbidden indicates the caller is authenticated but not authorized to
// list or remove athletes (i.e. not a COACH).
var ErrForbidden = errors.New("athlete: caller is not a coach")

// ErrNotFound indicates athleteID does not exist, or is not connected to
// the caller — deliberately one indistinguishable outcome
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.4), matching the
// "resource-scoping, not a role check" pattern used elsewhere (e.g.
// scheduledworkout.ErrAthleteNotFound). Handlers map this to 404 NOT_FOUND.
var ErrNotFound = errors.New("athlete: not found")

// ListForCoach returns the athletes connected to caller via coach_athletes.
// Authorization decision: only a COACH may call this. Callers that are not
// a COACH get ErrForbidden; the handler maps that to 403 FORBIDDEN.
func ListForCoach(ctx context.Context, pool *pgxpool.Pool, caller authn.User) ([]Athlete, error) {
	if caller.Role != "COACH" {
		return nil, ErrForbidden
	}
	return listByCoachID(ctx, pool, caller.ID)
}

// listByCoachID queries the athletes connected to the given coach. The
// u.role filter is a defensive check: coach_athletes has no DB constraint
// restricting athlete_id to ATHLETE-role users.
func listByCoachID(ctx context.Context, pool *pgxpool.Pool, coachID string) ([]Athlete, error) {
	const query = `
		SELECT u.id, u.name, u.role
		FROM coach_athletes ca
		JOIN users u ON u.id = ca.athlete_id
		WHERE ca.coach_id = $1 AND u.role = 'ATHLETE'
		ORDER BY u.name`

	rows, err := pool.Query(ctx, query, coachID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	athletes := make([]Athlete, 0)
	for rows.Next() {
		var a Athlete
		if err := rows.Scan(&a.ID, &a.Name, &a.Role); err != nil {
			return nil, err
		}
		athletes = append(athletes, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return athletes, nil
}

// Remove detaches the coach_athletes relationship between caller and
// athleteID. It never deletes the athlete's users row, never touches
// Firebase, and never cascades into scheduled_workouts / workout_sessions
// / set_logs — historical training data is frozen-snapshot by design
// (AGENTS.md §5) and is untouched by removal
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.4, decision #10). Only
// a COACH may call this, and only for an athlete connected to them; an
// unknown athleteID or one connected only to a different coach both
// produce ErrNotFound — one indistinguishable outcome, so this endpoint
// cannot be used to confirm another coach's roster.
//
// A removed athlete's Today view may still show workouts the removed
// coach already scheduled (scheduledworkout.ListForAthlete filters on
// athlete_id alone, not coach_athletes) — that is the same frozen-snapshot
// principle at work, not a leak. What Remove actually cuts off is
// forward-looking: the athlete drops out of ListForCoach, and a later
// POST /scheduled-workouts for this pair fails with the existing
// "not connected" behavior, exactly as for any never-connected athlete.
func Remove(ctx context.Context, pool *pgxpool.Pool, caller authn.User, athleteID string) error {
	if caller.Role != "COACH" {
		return ErrForbidden
	}

	// An athleteID that isn't even a well-formed UUID cannot be connected
	// to the caller; treat it the same as "not found" rather than a
	// separate 400 — resource-scoping, not shape validation.
	if _, err := uuid.Parse(athleteID); err != nil {
		return ErrNotFound
	}

	tag, err := pool.Exec(ctx, `DELETE FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2`, caller.ID, athleteID)
	if err != nil {
		return fmt.Errorf("athlete: remove: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
