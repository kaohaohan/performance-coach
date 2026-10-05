// Package progressoverview implements GET /athletes/{athleteId}/progress-overview
// (docs/go-backend-api-contract-v0.1.md §3.11): a read-only summary of one
// athlete's objective data over the last N weeks.
//
// Two scopes are deliberately different:
//   - exercises (trend, latest, events) cover COMPLETED training under ANY
//     Coach, like GET /training-log, and are computed by internal/progress
//     over the full history before the window;
//   - assignments (completion, planned vs completed sets) cover only the
//     ScheduledWorkouts the caller scheduled (scope "OWN"), so another
//     Coach's prescription and scheduling never leak.
//
// The response carries no ids, workout names, grades, scores or status labels.
package progressoverview

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/progress"
)

const (
	dateLayout     = "2006-01-02"
	minWeeks       = 4
	maxWeeks       = 26
	defaultWeeks   = 8
	recentDays     = 28
	maxRecent      = 5
	scopeOwn       = "OWN"
	roleCoach      = "COACH"
	bodyweightUnit = ""
)

// ErrNotFound: invalid athlete id, or the caller has no historical access to
// the athlete (indistinguishable from "does not exist").
var ErrNotFound = errors.New("progressoverview: athlete not found or not accessible to caller")

// ErrForbidden: the caller is not a Coach.
var ErrForbidden = errors.New("progressoverview: caller role not allowed")

// ValidationError maps to 400 INVALID_ARGUMENT.
type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

// Query is the raw (string) input of the endpoint.
type Query struct {
	AthleteID string
	Weeks     string // empty = default
}

type Athlete struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type Window struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Weeks int    `json:"weeks"`
}

// Assignments counts only ScheduledWorkouts scheduled by the caller.
type Assignments struct {
	Scope                string   `json:"scope"`
	Scheduled            int      `json:"scheduled"`
	Completed            int      `json:"completed"`
	CompletionRate       *float64 `json:"completionRate"`
	PlannedSets          int      `json:"plannedSets"`
	CompletedPlannedSets int      `json:"completedPlannedSets"`
	ExtraSets            int      `json:"extraSets"`
}

type TopSet struct {
	Load *float64 `json:"load"`
	Reps int      `json:"reps"`
	RIR  *float64 `json:"rir,omitempty"`
}

type Latest struct {
	Date   string `json:"date"`
	TopSet TopSet `json:"topSet"`
}

type TrendPoint struct {
	WeekStart    string   `json:"weekStart"`
	Estimated1RM *float64 `json:"estimated1rm"`
}

// RecentEvent is one engine event with the date of its exposure.
type RecentEvent struct {
	Date         string   `json:"date"`
	Type         string   `json:"type"`
	Load         *float64 `json:"load,omitempty"`
	Unit         string   `json:"unit,omitempty"`
	Reps         *int     `json:"reps,omitempty"`
	PreviousReps *int     `json:"previousReps,omitempty"`
	Delta        *float64 `json:"delta,omitempty"`
}

// Exercise is one exercise in one load unit. kg and lb are never merged.
type Exercise struct {
	ExerciseID   string        `json:"exerciseId"`
	Name         string        `json:"name"`
	Unit         string        `json:"unit"`
	Latest       Latest        `json:"latest"`
	Trend        []TrendPoint  `json:"trend"`
	RecentEvents []RecentEvent `json:"recentEvents"`
	Exposures    int           `json:"exposures"`
}

// RecentEventTotals counts LOAD_PR and REP_PR events over the last WindowDays
// across every exercise and unit (no conversion). Unlike Exercise.RecentEvents
// it is not capped.
type RecentEventTotals struct {
	WindowDays int `json:"windowDays"`
	LoadPR     int `json:"loadPr"`
	RepPR      int `json:"repPr"`
	Total      int `json:"total"`
}

type Response struct {
	Athlete           Athlete           `json:"athlete"`
	Window            Window            `json:"window"`
	Assignments       Assignments       `json:"assignments"`
	RecentEventTotals RecentEventTotals `json:"recentEventTotals"`
	Exercises         []Exercise        `json:"exercises"`
}

func parseWeeks(raw string) (int, error) {
	if raw == "" {
		return defaultWeeks, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < minWeeks || n > maxWeeks {
		return 0, &ValidationError{fmt.Sprintf("weeks must be an integer between %d and %d", minWeeks, maxWeeks)}
	}
	return n, nil
}

// weekStart returns the Monday (ISO week start) of d's week.
func weekStart(d time.Time) time.Time {
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

// Get returns the overview for caller. today is the athlete's current data
// date (UTC date; the schema has no per-user time zone).
func Get(ctx context.Context, pool *pgxpool.Pool, caller authn.User, q Query, today time.Time) (Response, error) {
	if caller.Role != roleCoach {
		return Response{}, ErrForbidden
	}
	if _, err := uuid.Parse(q.AthleteID); err != nil {
		return Response{}, ErrNotFound
	}
	var name string
	err := pool.QueryRow(ctx, `
		SELECT u.name FROM coach_athletes ca JOIN users u ON u.id = ca.athlete_id
		WHERE ca.coach_id = $1 AND ca.athlete_id = $2`, caller.ID, q.AthleteID).Scan(&name)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return Response{}, ErrNotFound
		}
		return Response{}, fmt.Errorf("progressoverview: check access: %w", err)
	}
	weeks, err := parseWeeks(q.Weeks)
	if err != nil {
		return Response{}, err
	}

	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, time.UTC)
	from := weekStart(today).AddDate(0, 0, -7*weeks)
	resp := Response{
		Athlete: Athlete{ID: q.AthleteID, Name: name},
		Window:  Window{From: from.Format(dateLayout), To: today.Format(dateLayout), Weeks: weeks},
	}

	if resp.Assignments, err = loadAssignments(ctx, pool, caller.ID, q.AthleteID, resp.Window); err != nil {
		return Response{}, err
	}
	if resp.Exercises, resp.RecentEventTotals, err = loadExercises(ctx, pool, q.AthleteID, from, today); err != nil {
		return Response{}, err
	}
	return resp, nil
}

func loadAssignments(ctx context.Context, pool *pgxpool.Pool, coachID, athleteID string, w Window) (Assignments, error) {
	a := Assignments{Scope: scopeOwn}
	err := pool.QueryRow(ctx, `
		SELECT count(*), count(*) FILTER (WHERE ws.status = 'COMPLETED')
		FROM scheduled_workouts sw
		LEFT JOIN workout_sessions ws ON ws.scheduled_workout_id = sw.id
		WHERE sw.coach_id = $1 AND sw.athlete_id = $2
		  AND sw.scheduled_date BETWEEN $3::date AND $4::date`,
		coachID, athleteID, w.From, w.To).Scan(&a.Scheduled, &a.Completed)
	if err != nil {
		return a, fmt.Errorf("progressoverview: load assignments: %w", err)
	}
	if a.Scheduled > 0 {
		rate := float64(a.Completed) / float64(a.Scheduled)
		rate = float64(int(rate*100+0.5)) / 100
		a.CompletionRate = &rate
	}
	err = pool.QueryRow(ctx, `
		SELECT count(*) FROM scheduled_workout_planned_sets p
		JOIN scheduled_workout_exercises swe ON swe.id = p.scheduled_workout_exercise_id
		JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id
		WHERE sw.coach_id = $1 AND sw.athlete_id = $2
		  AND sw.scheduled_date BETWEEN $3::date AND $4::date`,
		coachID, athleteID, w.From, w.To).Scan(&a.PlannedSets)
	if err != nil {
		return a, fmt.Errorf("progressoverview: load planned sets: %w", err)
	}
	err = pool.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE sl.scheduled_workout_planned_set_id IS NOT NULL),
		       count(*) FILTER (WHERE sl.scheduled_workout_planned_set_id IS NULL)
		FROM scheduled_workouts sw
		JOIN workout_sessions ws ON ws.scheduled_workout_id = sw.id
		JOIN set_logs sl ON sl.session_id = ws.id
		WHERE sw.coach_id = $1 AND sw.athlete_id = $2
		  AND sw.scheduled_date BETWEEN $3::date AND $4::date`,
		coachID, athleteID, w.From, w.To).Scan(&a.CompletedPlannedSets, &a.ExtraSets)
	if err != nil {
		return a, fmt.Errorf("progressoverview: load set logs: %w", err)
	}
	return a, nil
}

type exerciseHistory struct {
	id        string
	name      string // from the most recent exposure
	exposures []progress.Exposure
}

func loadExercises(ctx context.Context, pool *pgxpool.Pool, athleteID string, from, today time.Time) ([]Exercise, RecentEventTotals, error) {
	totals := RecentEventTotals{WindowDays: recentDays}
	rows, err := pool.Query(ctx, `
		SELECT swe.exercise_id::text, swe.exercise_name, ws.id::text, sw.scheduled_date::text,
		       swe.position, sl.set_number, sl.load, sl.unit, sl.reps, sl.rir
		FROM workout_sessions ws
		JOIN scheduled_workouts sw ON sw.id = ws.scheduled_workout_id
		JOIN set_logs sl ON sl.session_id = ws.id
		JOIN scheduled_workout_exercises swe ON swe.id = sl.scheduled_workout_exercise_id
		WHERE ws.athlete_id = $1 AND ws.status = 'COMPLETED' AND sw.scheduled_date <= $2::date
		ORDER BY sw.scheduled_date, ws.completed_at, ws.id, sl.set_number`,
		athleteID, today.Format(dateLayout))
	if err != nil {
		return nil, totals, fmt.Errorf("progressoverview: load exposures: %w", err)
	}
	defer rows.Close()

	byExercise := map[string]*exerciseHistory{}
	var order []*exerciseHistory
	lastSession := map[string]string{} // exercise_id -> session of its newest exposure
	for rows.Next() {
		var (
			exerciseID, exName, sessionID, date string
			position, setNumber, reps           int
			load, rir                           *float64
			unit                                *string
		)
		if err := rows.Scan(&exerciseID, &exName, &sessionID, &date, &position, &setNumber, &load, &unit, &reps, &rir); err != nil {
			return nil, totals, fmt.Errorf("progressoverview: scan exposure: %w", err)
		}
		h, ok := byExercise[exerciseID]
		if !ok {
			h = &exerciseHistory{id: exerciseID}
			byExercise[exerciseID] = h
			order = append(order, h)
		}
		if lastSession[exerciseID] != sessionID {
			lastSession[exerciseID] = sessionID
			h.exposures = append(h.exposures, progress.Exposure{Date: date, Position: position})
			h.name = exName
		}
		set := progress.Set{SetNumber: setNumber, Load: load, Reps: reps, RIR: rir}
		if unit != nil {
			set.Unit = *unit
		}
		e := &h.exposures[len(h.exposures)-1]
		e.Sets = append(e.Sets, set)
	}
	if err := rows.Err(); err != nil {
		return nil, totals, fmt.Errorf("progressoverview: iterate exposures: %w", err)
	}

	fromStr := from.Format(dateLayout)
	recentFrom := today.AddDate(0, 0, -(recentDays - 1)).Format(dateLayout)
	weekStarts := []string{}
	for d := from; !d.After(today); d = d.AddDate(0, 0, 7) {
		weekStarts = append(weekStarts, d.Format(dateLayout))
	}

	out := []Exercise{}
	for _, h := range order {
		byUnit := progress.Analyze(h.exposures)
		for unit, results := range byUnit {
			// Totals cover every exercise and unit, including rows not listed.
			for _, r := range results {
				if r.Date < recentFrom {
					continue
				}
				for _, ev := range r.Events {
					switch ev.Type {
					case progress.EventLoadPR:
						totals.LoadPR++
					case progress.EventRepPR:
						totals.RepPR++
					}
				}
			}
			if unit == bodyweightUnit {
				continue // no load to trend
			}
			ex := Exercise{
				ExerciseID: h.id, Name: h.name, Unit: unit,
				Trend: make([]TrendPoint, len(weekStarts)), RecentEvents: []RecentEvent{},
			}
			for i, ws := range weekStarts {
				ex.Trend[i] = TrendPoint{WeekStart: ws}
			}
			inWindow := 0
			var recent []RecentEvent
			for _, r := range results {
				if r.Date < fromStr {
					continue
				}
				inWindow++
				ex.Latest = Latest{Date: r.Date, TopSet: TopSet{Load: r.TopSet.Load, Reps: r.TopSet.Reps, RIR: r.TopSet.RIR}}
				d, _ := time.Parse(dateLayout, r.Date)
				idx := int(d.Sub(from).Hours()/24) / 7
				if idx >= 0 && idx < len(ex.Trend) {
					v := r.Estimated1RM
					if v == nil {
						v = r.TopSet.Load
					}
					if v != nil && (ex.Trend[idx].Estimated1RM == nil || *v > *ex.Trend[idx].Estimated1RM) {
						c := *v
						ex.Trend[idx].Estimated1RM = &c
					}
				}
				if r.Date >= recentFrom {
					for _, ev := range r.Events {
						recent = append(recent, RecentEvent{
							Date: r.Date, Type: ev.Type, Load: ev.Load, Unit: ev.Unit,
							Reps: ev.Reps, PreviousReps: ev.PreviousReps, Delta: ev.Delta,
						})
					}
				}
			}
			if inWindow == 0 {
				continue
			}
			ex.Exposures = inWindow
			// Newest first; the engine order within one exposure is kept.
			sort.SliceStable(recent, func(a, b int) bool { return recent[a].Date > recent[b].Date })
			if len(recent) > maxRecent {
				recent = recent[:maxRecent]
			}
			if recent != nil {
				ex.RecentEvents = recent
			}
			out = append(out, ex)
		}
	}
	sort.SliceStable(out, func(a, b int) bool {
		if out[a].Latest.Date != out[b].Latest.Date {
			return out[a].Latest.Date > out[b].Latest.Date
		}
		if out[a].Name != out[b].Name {
			return out[a].Name < out[b].Name
		}
		if out[a].ExerciseID != out[b].ExerciseID {
			return out[a].ExerciseID < out[b].ExerciseID
		}
		return out[a].Unit < out[b].Unit
	})
	totals.Total = totals.LoadPR + totals.RepPR
	return out, totals, nil
}
