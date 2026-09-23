// Package loadincrement implements weekly load-bump helpers for Workout
// templates and last-completed load lookup for Calendar prefill.
package loadincrement

import (
	"context"
	"fmt"
	"math"
	"slices"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DefaultForUnit returns the template default increment for a planned unit.
func DefaultForUnit(unit string) float64 {
	if unit == "lb" {
		return 5
	}
	return 2.5
}

// Allowed reports whether increment is valid for the exercise unit.
func Allowed(unit string, increment float64) bool {
	switch unit {
	case "lb":
		return slices.Contains([]float64{0, 5, 10}, increment)
	case "kg", "":
		return slices.Contains([]float64{0, 2.5, 5, 10}, increment)
	default:
		return false
	}
}

// Validate returns a human-readable validation error message, or "" if ok.
func Validate(unit string, increment float64) string {
	if !Allowed(unit, increment) {
		if unit == "lb" {
			return "loadIncrement must be one of 0, 5, 10 for lb"
		}
		return "loadIncrement must be one of 0, 2.5, 5, 10 for kg"
	}
	return ""
}

// SuggestLoad returns base+increment when base is known; otherwise nil.
// base is last completed load when present, else template planned load.
func SuggestLoad(base *float64, increment float64) *float64 {
	if base == nil || increment == 0 {
		return base
	}
	value := *base + increment
	return &value
}

// BumpLoad adds increment to a planned load pointer when non-nil.
func BumpLoad(load *float64, increment float64) *float64 {
	if load == nil || increment == 0 {
		return load
	}
	value := *load + increment
	return &value
}

// LastCompletedLoads returns the most recent COMPLETED-session load per
// exercise id for the athlete and matching unit. Missing history is nil.
func LastCompletedLoads(ctx context.Context, pool *pgxpool.Pool, athleteID string, exerciseIDs []string, units []string) (map[string]*float64, error) {
	if len(exerciseIDs) != len(units) {
		return nil, fmt.Errorf("loadincrement: exerciseIds and units length mismatch")
	}
	result := make(map[string]*float64, len(exerciseIDs))
	if len(exerciseIDs) == 0 {
		return result, nil
	}

	pairs := make([]string, 0, len(exerciseIDs))
	args := make([]any, 0, 1+len(exerciseIDs)*2)
	args = append(args, athleteID)
	argIndex := 2
	for i, exerciseID := range exerciseIDs {
		if _, err := uuid.Parse(exerciseID); err != nil {
			return nil, fmt.Errorf("loadincrement: invalid exercise id %q", exerciseID)
		}
		unit := units[i]
		if unit != "kg" && unit != "lb" {
			return nil, fmt.Errorf("loadincrement: invalid unit %q", unit)
		}
		pairs = append(pairs, fmt.Sprintf("($%d::uuid, $%d::text)", argIndex, argIndex+1))
		args = append(args, exerciseID, unit)
		argIndex += 2
		result[exerciseID] = nil
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT ON (swe.exercise_id)
		       swe.exercise_id::text, sl.load
		FROM set_logs sl
		JOIN workout_sessions ws
		  ON ws.id = sl.session_id
		 AND ws.athlete_id = $1
		 AND ws.status = 'COMPLETED'
		JOIN scheduled_workout_exercises swe ON swe.id = sl.scheduled_workout_exercise_id
		JOIN (VALUES %s) AS requested(exercise_id, unit)
		  ON requested.exercise_id = swe.exercise_id
		 AND requested.unit = sl.unit
		WHERE sl.load IS NOT NULL
		ORDER BY swe.exercise_id, ws.completed_at DESC NULLS LAST, sl.created_at DESC`, strings.Join(pairs, ", "))

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("loadincrement: query last completed loads: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var exerciseID string
		var load float64
		if err := rows.Scan(&exerciseID, &load); err != nil {
			return nil, fmt.Errorf("loadincrement: scan last completed load: %w", err)
		}
		result[exerciseID] = &load
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("loadincrement: iterate last completed loads: %w", err)
	}
	return result, nil
}

// EqualIncrement reports whether two increment values are the same after
// normalizing floating-point representation.
func EqualIncrement(left, right float64) bool {
	return math.Abs(left-right) < 1e-9
}
