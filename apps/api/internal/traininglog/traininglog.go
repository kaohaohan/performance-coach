// Package traininglog implements GET /training-log
// (docs/go-backend-api-contract-v0.1.md §3.10): a read-only view of actual
// training (sessions and SetLogs) with engine-computed progress events.
//
// Authorization is the single historical-access rule shared with
// GET /sessions/{id}: an Athlete reads their own sessions (any Coach); a
// Coach reads any athlete they have a coach_athletes row with, regardless of
// which Coach scheduled the session. Sessions scheduled by another Coach are
// redacted to actuals only (source OTHER_COACH). SetLog ids are never
// returned.
//
// Events and exposures come from internal/progress and are computed over all
// earlier COMPLETED exposures up to `to`, not just those inside the range.
package traininglog

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/progress"
)

const (
	dateLayout  = "2006-01-02"
	maxSpanDays = 184

	SourceOwn         = "OWN"
	SourceOtherCoach  = "OTHER_COACH"
	statusActive      = "ACTIVE"
	statusCompleted   = "COMPLETED"
	roleCoach         = "COACH"
	roleAthlete       = "ATHLETE"
	bodyweightUnitKey = ""
)

// ErrNotFound: the requested athlete is not the caller and the caller has no
// historical access to them (indistinguishable from "does not exist").
var ErrNotFound = errors.New("traininglog: athlete not found or not accessible to caller")

// ErrForbidden: the caller is neither a Coach nor an Athlete.
var ErrForbidden = errors.New("traininglog: caller role not allowed")

// ValidationError maps to 400 INVALID_ARGUMENT.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

// Query is the raw (string) query of the endpoint.
type Query struct {
	From, To, AthleteID, ExerciseID, Status string
}

type Athlete struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// SetLog is one actual set. It has no id by design.
type SetLog struct {
	SetNumber int      `json:"setNumber"`
	Kind      string   `json:"kind"`
	Load      *float64 `json:"load"`
	Unit      *string  `json:"unit,omitempty"`
	Reps      int      `json:"reps"`
	RIR       *float64 `json:"rir,omitempty"`
}

type Exercise struct {
	ExerciseID string           `json:"exerciseId"`
	Name       string           `json:"name"`
	Position   int              `json:"position"`
	SetLogs    []SetLog         `json:"setLogs"`
	Events     []progress.Event `json:"events"`
}

// Session. SessionID, ScheduledWorkoutID and WorkoutName are null for
// OTHER_COACH sessions (never omitted, so the redaction is explicit).
type Session struct {
	SessionID          *string    `json:"sessionId"`
	ScheduledWorkoutID *string    `json:"scheduledWorkoutId"`
	Status             string     `json:"status"`
	Date               string     `json:"date"`
	Source             string     `json:"source"`
	Athlete            Athlete    `json:"athlete"`
	WorkoutName        *string    `json:"workoutName"`
	Exercises          []Exercise `json:"exercises"`
}

// Exposure is one COMPLETED session's metrics for the progress chart.
type Exposure struct {
	Date         string           `json:"date"`
	Source       string           `json:"source"`
	TopSet       progress.TopSet  `json:"topSet"`
	Estimated1RM *float64         `json:"estimated1rm,omitempty"`
	MaxLoad      *float64         `json:"maxLoad,omitempty"`
	TotalReps    int              `json:"totalReps"`
	VolumeLoad   *float64         `json:"volumeLoad,omitempty"`
	SetCount     int              `json:"setCount"`
	Position     int              `json:"position"`
	Events       []progress.Event `json:"events"`
}

// ExposureMap is keyed by load unit ("kg", "lb"). It is a pointer in
// Response so an empty map still serializes when exerciseId was given.
type ExposureMap map[string][]Exposure

type Response struct {
	Sessions  []Session    `json:"sessions"`
	Exposures *ExposureMap `json:"exposures,omitempty"`
}

type parsed struct {
	from, to   string
	toDate     time.Time
	athleteID  string
	exerciseID string
	status     string
}

func parse(q Query) (parsed, error) {
	from, err := time.Parse(dateLayout, q.From)
	if err != nil {
		return parsed{}, &ValidationError{"from is required and must be a valid date (YYYY-MM-DD)"}
	}
	to, err := time.Parse(dateLayout, q.To)
	if err != nil {
		return parsed{}, &ValidationError{"to is required and must be a valid date (YYYY-MM-DD)"}
	}
	if to.Before(from) {
		return parsed{}, &ValidationError{"to must not be before from"}
	}
	if int(to.Sub(from).Hours()/24) > maxSpanDays {
		return parsed{}, &ValidationError{fmt.Sprintf("range must not exceed %d days", maxSpanDays)}
	}
	p := parsed{from: q.From, to: q.To, toDate: to}
	if q.AthleteID != "" {
		if _, err := uuid.Parse(q.AthleteID); err != nil {
			return parsed{}, &ValidationError{"athleteId must be a valid UUID"}
		}
		p.athleteID = q.AthleteID
	}
	if q.ExerciseID != "" {
		if _, err := uuid.Parse(q.ExerciseID); err != nil {
			return parsed{}, &ValidationError{"exerciseId must be a valid UUID"}
		}
		p.exerciseID = q.ExerciseID
	}
	switch q.Status {
	case "", statusActive, statusCompleted:
		p.status = q.Status
	default:
		return parsed{}, &ValidationError{"status must be ACTIVE or COMPLETED"}
	}
	return p, nil
}

// List returns the training log visible to caller.
func List(ctx context.Context, pool *pgxpool.Pool, caller authn.User, q Query) (Response, error) {
	p, err := parse(q)
	if err != nil {
		return Response{}, err
	}

	// Scope: the set of athletes whose sessions the caller may read.
	var athleteIDs []string
	switch caller.Role {
	case roleAthlete:
		if p.athleteID != "" && p.athleteID != caller.ID {
			return Response{}, ErrNotFound
		}
		athleteIDs = []string{caller.ID}
	case roleCoach:
		if p.athleteID != "" {
			var ok bool
			err := pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM coach_athletes WHERE coach_id = $1 AND athlete_id = $2)`, caller.ID, p.athleteID).Scan(&ok)
			if err != nil {
				return Response{}, fmt.Errorf("traininglog: check access: %w", err)
			}
			if !ok {
				return Response{}, ErrNotFound
			}
			athleteIDs = []string{p.athleteID}
		} else {
			rows, err := pool.Query(ctx, `SELECT athlete_id::text FROM coach_athletes WHERE coach_id = $1`, caller.ID)
			if err != nil {
				return Response{}, fmt.Errorf("traininglog: list athletes: %w", err)
			}
			defer rows.Close()
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					return Response{}, fmt.Errorf("traininglog: scan athlete: %w", err)
				}
				athleteIDs = append(athleteIDs, id)
			}
			if err := rows.Err(); err != nil {
				return Response{}, fmt.Errorf("traininglog: iterate athletes: %w", err)
			}
		}
	default:
		return Response{}, ErrForbidden
	}

	resp := Response{Sessions: []Session{}}
	if p.exerciseID != "" && (p.athleteID != "" || caller.Role == roleAthlete) {
		resp.Exposures = &ExposureMap{}
	}
	if len(athleteIDs) == 0 {
		return resp, nil
	}

	sessions, err := loadSessions(ctx, pool, caller, p, athleteIDs)
	if err != nil {
		return Response{}, err
	}
	if err := attachEvents(ctx, pool, p, sessions, &resp); err != nil {
		return Response{}, err
	}
	for _, s := range sessions {
		resp.Sessions = append(resp.Sessions, s.Session)
	}
	return resp, nil
}

// sessionRow keeps the internal ids needed to group rows, which never reach
// the response for OTHER_COACH sessions.
type sessionRow struct {
	Session
	internalID string
	byExercise map[string]*Exercise // exercise_id -> exercise (merged by exercise_id)
}

func loadSessions(ctx context.Context, pool *pgxpool.Pool, caller authn.User, p parsed, athleteIDs []string) ([]*sessionRow, error) {
	var exerciseID, status *string
	if p.exerciseID != "" {
		exerciseID = &p.exerciseID
	}
	if p.status != "" {
		status = &p.status
	}

	const query = `
		SELECT ws.id::text, sw.id::text, ws.status, sw.scheduled_date::text,
		       (sw.coach_id = $1::uuid) AS own,
		       u.id::text, u.name, w.name,
		       swe.exercise_id::text, swe.exercise_name, swe.position,
		       sl.set_number, (sl.scheduled_workout_planned_set_id IS NOT NULL) AS planned,
		       sl.load, sl.unit, sl.reps, sl.rir
		FROM workout_sessions ws
		JOIN scheduled_workouts sw ON sw.id = ws.scheduled_workout_id
		JOIN workouts w ON w.id = sw.workout_id
		JOIN users u ON u.id = ws.athlete_id
		LEFT JOIN set_logs sl ON sl.session_id = ws.id
		LEFT JOIN scheduled_workout_exercises swe ON swe.id = sl.scheduled_workout_exercise_id
		WHERE ws.athlete_id = ANY($2::uuid[])
		  AND sw.scheduled_date BETWEEN $3::date AND $4::date
		  AND ($5::text IS NULL OR ws.status = $5)
		  AND ($6::uuid IS NULL OR EXISTS (
		        SELECT 1 FROM set_logs sl2
		        JOIN scheduled_workout_exercises swe2 ON swe2.id = sl2.scheduled_workout_exercise_id
		        WHERE sl2.session_id = ws.id AND swe2.exercise_id = $6::uuid))
		  AND ($6::uuid IS NULL OR swe.exercise_id = $6::uuid OR sl.id IS NULL)
		ORDER BY sw.scheduled_date DESC, ws.started_at DESC, ws.id, swe.position, sl.set_number`
	rows, err := pool.Query(ctx, query, caller.ID, athleteIDs, p.from, p.to, status, exerciseID)
	if err != nil {
		return nil, fmt.Errorf("traininglog: load sessions: %w", err)
	}
	defer rows.Close()

	var out []*sessionRow
	byID := map[string]*sessionRow{}
	for rows.Next() {
		var (
			sessionID, swID, st, date, athleteID, athleteName, workoutName string
			own                                                            bool
			exID, exName                                                   *string
			position, setNumber, reps                                      *int
			planned                                                        *bool
			load, rir                                                      *float64
			unit                                                           *string
		)
		if err := rows.Scan(&sessionID, &swID, &st, &date, &own, &athleteID, &athleteName, &workoutName,
			&exID, &exName, &position, &setNumber, &planned, &load, &unit, &reps, &rir); err != nil {
			return nil, fmt.Errorf("traininglog: scan session: %w", err)
		}
		s, ok := byID[sessionID]
		if !ok {
			s = &sessionRow{internalID: sessionID, byExercise: map[string]*Exercise{}}
			s.Status, s.Date = st, date
			s.Athlete = Athlete{ID: athleteID, Name: athleteName}
			s.Exercises = []Exercise{}
			if caller.Role == roleAthlete || own {
				s.Source = SourceOwn
				s.SessionID, s.ScheduledWorkoutID, s.WorkoutName = &sessionID, &swID, &workoutName
			} else {
				s.Source = SourceOtherCoach // ids and workout name stay nil
			}
			byID[sessionID] = s
			out = append(out, s)
		}
		if exID == nil || setNumber == nil {
			continue
		}
		ex, ok := s.byExercise[*exID]
		if !ok {
			s.Exercises = append(s.Exercises, Exercise{ExerciseID: *exID, Name: *exName, Position: *position, SetLogs: []SetLog{}, Events: []progress.Event{}})
			ex = &s.Exercises[len(s.Exercises)-1]
			s.byExercise[*exID] = ex
		}
		kind := "EXTRA"
		if planned != nil && *planned {
			kind = "PLANNED"
		}
		ex.SetLogs = append(ex.SetLogs, SetLog{SetNumber: *setNumber, Kind: kind, Load: load, Unit: unit, Reps: *reps, RIR: rir})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("traininglog: iterate sessions: %w", err)
	}
	// byExercise pointers go stale when Exercises grows; rebuild lookups so
	// attachEvents can mutate the final slice elements.
	for _, s := range out {
		for i := range s.Exercises {
			s.byExercise[s.Exercises[i].ExerciseID] = &s.Exercises[i]
		}
	}
	return out, nil
}

type expKey struct{ athleteID, exerciseID string }

// attachEvents runs the comparison engine over every (athlete, exercise)
// pair that appears in the page, using all COMPLETED exposures up to `to`,
// and copies the in-range results back onto sessions and (when requested and
// unambiguous) the exposures block.
func attachEvents(ctx context.Context, pool *pgxpool.Pool, p parsed, sessions []*sessionRow, resp *Response) error {
	var pairAthletes, pairExercises []string
	seen := map[expKey]bool{}
	for _, s := range sessions {
		if s.Status != statusCompleted {
			continue
		}
		for _, ex := range s.Exercises {
			k := expKey{s.Athlete.ID, ex.ExerciseID}
			if !seen[k] {
				seen[k] = true
				pairAthletes = append(pairAthletes, k.athleteID)
				pairExercises = append(pairExercises, k.exerciseID)
			}
		}
	}
	if len(pairAthletes) == 0 {
		return nil
	}

	const query = `
		SELECT ws.athlete_id::text, swe.exercise_id::text, ws.id::text, sw.scheduled_date::text,
		       swe.position, sl.set_number, sl.load, sl.unit, sl.reps, sl.rir
		FROM unnest($1::uuid[], $2::uuid[]) AS pair(athlete_id, exercise_id)
		JOIN workout_sessions ws ON ws.athlete_id = pair.athlete_id AND ws.status = 'COMPLETED'
		JOIN scheduled_workouts sw ON sw.id = ws.scheduled_workout_id
		JOIN set_logs sl ON sl.session_id = ws.id
		JOIN scheduled_workout_exercises swe ON swe.id = sl.scheduled_workout_exercise_id AND swe.exercise_id = pair.exercise_id
		WHERE sw.scheduled_date <= $3::date
		ORDER BY sw.scheduled_date, ws.completed_at, ws.id, sl.set_number`
	rows, err := pool.Query(ctx, query, pairAthletes, pairExercises, p.to)
	if err != nil {
		return fmt.Errorf("traininglog: load exposures: %w", err)
	}
	defer rows.Close()

	type exposureRef struct {
		sessionID string
		date      string
		exp       *progress.Exposure
	}
	order := map[expKey][]*exposureRef{}
	index := map[[3]string]*exposureRef{}
	for rows.Next() {
		var (
			athleteID, exerciseID, sessionID, date string
			position, setNumber, reps              int
			load, rir                              *float64
			unit                                   *string
		)
		if err := rows.Scan(&athleteID, &exerciseID, &sessionID, &date, &position, &setNumber, &load, &unit, &reps, &rir); err != nil {
			return fmt.Errorf("traininglog: scan exposure: %w", err)
		}
		k := expKey{athleteID, exerciseID}
		ref, ok := index[[3]string{athleteID, exerciseID, sessionID}]
		if !ok {
			ref = &exposureRef{sessionID: sessionID, date: date, exp: &progress.Exposure{Date: date, Position: position}}
			index[[3]string{athleteID, exerciseID, sessionID}] = ref
			order[k] = append(order[k], ref)
		}
		set := progress.Set{SetNumber: setNumber, Load: load, Reps: reps, RIR: rir}
		if unit != nil {
			set.Unit = *unit
		}
		ref.exp.Sets = append(ref.exp.Sets, set)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("traininglog: iterate exposures: %w", err)
	}

	sessionByID := map[string]*sessionRow{}
	for _, s := range sessions {
		sessionByID[s.internalID] = s
	}

	wantExposures := resp.Exposures != nil

	for k, refs := range order {
		exposures := make([]progress.Exposure, len(refs))
		for i, r := range refs {
			exposures[i] = *r.exp
		}
		byUnit := progress.Analyze(exposures)
		units := make([]string, 0, len(byUnit))
		for u := range byUnit {
			units = append(units, u)
		}
		sort.Strings(units)

		for _, unit := range units {
			for _, res := range byUnit[unit] {
				ref := refs[res.Index]
				s, inPage := sessionByID[ref.sessionID]
				if !inPage {
					continue // earlier than `from`: only used as comparison input
				}
				if ex := s.byExercise[k.exerciseID]; ex != nil {
					ex.Events = append(ex.Events, res.Events...)
				}
				if wantExposures && unit != bodyweightUnitKey {
					(*resp.Exposures)[unit] = append((*resp.Exposures)[unit], Exposure{
						Date: res.Date, Source: s.Source, TopSet: res.TopSet,
						Estimated1RM: res.Estimated1RM, MaxLoad: res.MaxLoad, TotalReps: res.TotalReps,
						VolumeLoad: res.VolumeLoad, SetCount: res.SetCount, Position: res.Position, Events: res.Events,
					})
				}
			}
		}
	}
	// Map iteration order is random; the contract says oldest first. Dates
	// tie within a unit only for same-day sessions, which keep engine order
	// via the stable sort.
	for _, list := range resp.Exposures.orEmpty() {
		sort.SliceStable(list, func(a, b int) bool { return list[a].Date < list[b].Date })
	}
	return nil
}

func (m *ExposureMap) orEmpty() ExposureMap {
	if m == nil {
		return nil
	}
	return *m
}
