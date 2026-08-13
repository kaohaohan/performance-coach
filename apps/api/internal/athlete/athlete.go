// Package athlete implements the Coach-only view of a coach's connected
// athletes, via the coach_athletes relationship.
package athlete

import (
	"context"
	"errors"

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
// list athletes (i.e. not a COACH).
var ErrForbidden = errors.New("athlete: caller is not a coach")

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
