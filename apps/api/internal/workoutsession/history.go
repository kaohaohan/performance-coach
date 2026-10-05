package workoutsession

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/progress"
)

// attachHistory fills Exercise.History for GET /sessions/{id}
// (docs/go-backend-api-contract-v0.1.md §3.7 V0.12).
//
// Scope: the same athlete and the same exercise_id, COMPLETED sessions
// scheduled before this one, from any Coach. ACTIVE sessions never count.
// Only dates, sets, and loads leave this function: no session, scheduled
// workout, or SetLog ids, and nothing that names the scheduling Coach.
func attachHistory(ctx context.Context, pool *pgxpool.Pool, h sessionHeader, exercises []Exercise) error {
	if len(exercises) == 0 {
		return nil
	}

	exerciseIDs := make([]string, 0, len(exercises))
	seen := map[string]bool{}
	for _, ex := range exercises {
		if !seen[ex.ExerciseID] {
			seen[ex.ExerciseID] = true
			exerciseIDs = append(exerciseIDs, ex.ExerciseID)
		}
	}

	plannedUnit, err := loadPlannedUnits(ctx, pool, h.scheduledWorkoutID)
	if err != nil {
		return err
	}

	const query = `
		SELECT swe.exercise_id::text, ws.id::text, sw.scheduled_date::text, swe.position,
		       sl.set_number, sl.load, sl.unit, sl.reps, sl.rir
		FROM set_logs sl
		JOIN workout_sessions ws ON ws.id = sl.session_id
		JOIN scheduled_workouts sw ON sw.id = ws.scheduled_workout_id
		JOIN scheduled_workout_exercises swe ON swe.id = sl.scheduled_workout_exercise_id
		WHERE ws.athlete_id = $1
		  AND ws.status = 'COMPLETED'
		  AND sw.scheduled_date < (SELECT scheduled_date FROM scheduled_workouts WHERE id = $2)
		  AND swe.exercise_id = ANY($3::uuid[])
		ORDER BY sw.scheduled_date, ws.completed_at, ws.id, sl.set_number`
	rows, err := pool.Query(ctx, query, h.athleteID, h.scheduledWorkoutID, exerciseIDs)
	if err != nil {
		return fmt.Errorf("workoutsession: load exercise history: %w", err)
	}
	defer rows.Close()

	// Session ids stay inside this function: they only group rows.
	type key struct{ exerciseID, sessionID string }
	order := map[string][]key{}
	exposures := map[key]*progress.Exposure{}
	for rows.Next() {
		var (
			exerciseID, sessionID, date string
			position, setNumber, reps   int
			load, rir                   *float64
			unit                        *string
		)
		if err := rows.Scan(&exerciseID, &sessionID, &date, &position, &setNumber, &load, &unit, &reps, &rir); err != nil {
			return fmt.Errorf("workoutsession: scan exercise history: %w", err)
		}
		k := key{exerciseID, sessionID}
		ex, ok := exposures[k]
		if !ok {
			ex = &progress.Exposure{Date: date, Position: position}
			exposures[k] = ex
			order[exerciseID] = append(order[exerciseID], k)
		}
		set := progress.Set{SetNumber: setNumber, Load: load, Reps: reps, RIR: rir}
		if unit != nil {
			set.Unit = *unit
		}
		ex.Sets = append(ex.Sets, set)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("workoutsession: iterate exercise history: %w", err)
	}

	for i := range exercises {
		earlier := make([]progress.Exposure, 0, len(order[exercises[i].ExerciseID]))
		for _, k := range order[exercises[i].ExerciseID] {
			earlier = append(earlier, *exposures[k])
		}
		baseline := progress.BuildBaseline(earlier, plannedUnit[exercises[i].ScheduledWorkoutExerciseID])
		exercises[i].History = &baseline
	}
	return nil
}

// loadPlannedUnits maps each scheduled exercise to its planned load unit
// ("" when it has none).
func loadPlannedUnits(ctx context.Context, pool *pgxpool.Pool, scheduledWorkoutID string) (map[string]string, error) {
	rows, err := pool.Query(ctx, `SELECT id::text, target_load_unit FROM scheduled_workout_exercises WHERE scheduled_workout_id = $1`, scheduledWorkoutID)
	if err != nil {
		return nil, fmt.Errorf("workoutsession: load planned units: %w", err)
	}
	defer rows.Close()
	units := map[string]string{}
	for rows.Next() {
		var id string
		var unit *string
		if err := rows.Scan(&id, &unit); err != nil {
			return nil, fmt.Errorf("workoutsession: scan planned unit: %w", err)
		}
		if unit != nil {
			units[id] = *unit
		}
	}
	return units, rows.Err()
}
