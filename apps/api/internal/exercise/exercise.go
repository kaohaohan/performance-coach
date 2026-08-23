// Package exercise implements the Coach Exercise Library and the shared
// visible-name resolution used while creating Workouts.
package exercise

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

// Exercise is the Exercise Library API response shape. Scope is derived from
// ownership and is deliberately not persisted.
type Exercise struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Scope string `json:"scope"`
}

// ErrForbidden indicates the caller is authenticated but is not a coach.
var ErrForbidden = errors.New("exercise: caller is not a coach")

// ValidationError is returned when a submitted exercise name is empty after
// normalization. Handlers map it to 400 INVALID_ARGUMENT.
type ValidationError struct {
	Message string
}

func (e *ValidationError) Error() string { return e.Message }

// ConflictError is returned for a system or caller-private name collision.
// Handlers map it to 409 CONFLICT without exposing database details.
type ConflictError struct {
	Message string
}

func (e *ConflictError) Error() string { return e.Message }

// ListForCoach returns visible system and caller-private Exercises. A trimmed,
// empty query returns all visible records; non-empty queries are
// case-insensitive literal substring searches.
//
// Ordering is system-before-private, then within each block: an earlier
// match position ranks above a later one (a no-op when the query is empty),
// then this coach's own usage count (via scheduled_workout_exercises →
// scheduled_workouts) descending, most-recently-used first, then
// alphabetical. This surfaces exercises the coach actually programs above
// ones that merely sort earlier, without requiring any exercise
// category/tag field.
func ListForCoach(ctx context.Context, pool *pgxpool.Pool, caller authn.User, rawQuery string) ([]Exercise, error) {
	if caller.Role != "COACH" {
		return nil, ErrForbidden
	}

	query := strings.TrimSpace(rawQuery)
	const listQuery = `
		SELECT e.id, e.name, e.owner_coach_id IS NULL AS is_system
		FROM exercises e
		LEFT JOIN (
			SELECT swe.exercise_id,
			       count(*) AS uses,
			       max(sw.scheduled_date) AS last_used
			FROM scheduled_workout_exercises swe
			JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id
			WHERE sw.coach_id = $1
			GROUP BY swe.exercise_id
		) usage ON usage.exercise_id = e.id
		WHERE (e.owner_coach_id IS NULL OR e.owner_coach_id = $1)
		  AND ($2 = '' OR strpos(lower(e.name), lower($2)) > 0)
		ORDER BY CASE WHEN e.owner_coach_id IS NULL THEN 0 ELSE 1 END,
		         CASE WHEN $2 = '' THEN 0 ELSE strpos(lower(e.name), lower($2)) END,
		         COALESCE(usage.uses, 0) DESC,
		         usage.last_used DESC NULLS LAST,
		         lower(e.name),
		         e.id`

	rows, err := pool.Query(ctx, listQuery, caller.ID, query)
	if err != nil {
		return nil, fmt.Errorf("exercise: list visible exercises: %w", err)
	}
	defer rows.Close()

	exercises := make([]Exercise, 0)
	for rows.Next() {
		var item Exercise
		var isSystem bool
		if err := rows.Scan(&item.ID, &item.Name, &isSystem); err != nil {
			return nil, fmt.Errorf("exercise: scan visible exercise: %w", err)
		}
		item.Scope = scopeFor(isSystem)
		exercises = append(exercises, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("exercise: iterate visible exercises: %w", err)
	}
	return exercises, nil
}

// CreatePrivate validates and creates a caller-owned private Exercise. System
// matches take precedence over private matches, including legacy data that
// contains both. INSERT ... ON CONFLICT makes the unique indexes the safe
// concurrency backstop without exposing a PostgreSQL unique-violation error.
func CreatePrivate(ctx context.Context, pool *pgxpool.Pool, caller authn.User, rawName string) (Exercise, error) {
	if caller.Role != "COACH" {
		return Exercise{}, ErrForbidden
	}

	name, err := normalizeName(rawName)
	if err != nil {
		return Exercise{}, err
	}

	if existing, found, err := findVisibleByName(ctx, pool, caller.ID, name); err != nil {
		return Exercise{}, err
	} else if found {
		return Exercise{}, conflictFor(existing)
	}

	created, inserted, err := insertPrivate(ctx, pool, caller.ID, name)
	if err != nil {
		return Exercise{}, err
	}
	if inserted {
		return created, nil
	}

	// A concurrent insert won the unique index race. Re-read to report the
	// contract's semantic conflict instead of a storage error.
	existing, found, err := findVisibleByName(ctx, pool, caller.ID, name)
	if err != nil {
		return Exercise{}, err
	}
	if found {
		return Exercise{}, conflictFor(existing)
	}
	return Exercise{}, fmt.Errorf("exercise: private insert conflicted but no visible exercise was found")
}

// FindOrCreateVisible resolves a name inside a caller-owned transaction. It
// preserves POST /workouts semantics: system first, then caller-private, then
// a newly-created caller-private Exercise. It never starts a transaction.
func FindOrCreateVisible(ctx context.Context, tx pgx.Tx, coachID, rawName string) (id string, name string, err error) {
	name = strings.TrimSpace(rawName)
	if existing, found, err := findVisibleByName(ctx, tx, coachID, name); err != nil {
		return "", "", err
	} else if found {
		return existing.ID, existing.Name, nil
	}

	created, inserted, err := insertPrivate(ctx, tx, coachID, name)
	if err != nil {
		return "", "", err
	}
	if inserted {
		return created.ID, created.Name, nil
	}

	// ON CONFLICT DO NOTHING leaves this transaction usable, so a concurrent
	// winner can be read and reused rather than aborting Workout creation.
	existing, found, err := findVisibleByName(ctx, tx, coachID, name)
	if err != nil {
		return "", "", err
	}
	if found {
		return existing.ID, existing.Name, nil
	}
	return "", "", fmt.Errorf("exercise: visible insert conflicted but no exercise was found")
}

type queryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func normalizeName(rawName string) (string, error) {
	name := strings.TrimSpace(rawName)
	if name == "" {
		return "", &ValidationError{Message: "name is required"}
	}
	return name, nil
}

func findVisibleByName(ctx context.Context, q queryer, coachID, name string) (Exercise, bool, error) {
	const query = `
		SELECT id, name, owner_coach_id IS NULL AS is_system
		FROM exercises
		WHERE (owner_coach_id IS NULL OR owner_coach_id = $1)
		  AND lower(name) = lower($2)
		ORDER BY CASE WHEN owner_coach_id IS NULL THEN 0 ELSE 1 END
		LIMIT 1`

	var item Exercise
	var isSystem bool
	err := q.QueryRow(ctx, query, coachID, name).Scan(&item.ID, &item.Name, &isSystem)
	if errors.Is(err, pgx.ErrNoRows) {
		return Exercise{}, false, nil
	}
	if err != nil {
		return Exercise{}, false, fmt.Errorf("exercise: find visible exercise: %w", err)
	}
	item.Scope = scopeFor(isSystem)
	return item, true, nil
}

func insertPrivate(ctx context.Context, q queryer, coachID, name string) (Exercise, bool, error) {
	const query = `
		INSERT INTO exercises (id, name, owner_coach_id, created_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT DO NOTHING
		RETURNING id, name`

	var created Exercise
	err := q.QueryRow(ctx, query, uuid.NewString(), name, coachID).Scan(&created.ID, &created.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return Exercise{}, false, nil
	}
	if err != nil {
		return Exercise{}, false, fmt.Errorf("exercise: insert private exercise: %w", err)
	}
	created.Scope = "PRIVATE"
	return created, true, nil
}

func conflictFor(existing Exercise) error {
	if existing.Scope == "SYSTEM" {
		return &ConflictError{Message: fmt.Sprintf("an exercise named %q already exists in the system library", existing.Name)}
	}
	return &ConflictError{Message: fmt.Sprintf("you already have a private exercise named %q", existing.Name)}
}

func scopeFor(isSystem bool) string {
	if isSystem {
		return "SYSTEM"
	}
	return "PRIVATE"
}
