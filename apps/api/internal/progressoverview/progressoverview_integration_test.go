package progressoverview_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/progressoverview"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

var (
	integrationPool       *pgxpool.Pool
	integrationSkipReason string
	integrationPrefix     = "progressoverview-integration-" + uuid.NewString()
)

// today is a Wednesday; its ISO week starts Monday 2026-10-05.
var today = time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)

func TestMain(m *testing.M) {
	url := strings.TrimSpace(os.Getenv("TEST_DATABASE_URL"))
	if url == "" {
		integrationSkipReason = "TEST_DATABASE_URL is not set"
		os.Exit(m.Run())
	}
	if !strings.Contains(url, "/performance_coach_test") {
		integrationSkipReason = "TEST_DATABASE_URL must target performance_coach_test"
		os.Exit(m.Run())
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var err error
	integrationPool, err = pgxpool.New(ctx, url)
	if err != nil {
		integrationSkipReason = "cannot connect to TEST_DATABASE_URL"
		os.Exit(m.Run())
	}
	code := m.Run()
	cleanupIntegration(ctx)
	integrationPool.Close()
	os.Exit(code)
}

func requireDB(t *testing.T) {
	t.Helper()
	if integrationSkipReason != "" {
		t.Skip(integrationSkipReason)
	}
}

func newUser(t *testing.T, role, name string) authn.User {
	t.Helper()
	u := authn.User{ID: uuid.NewString(), FirebaseUID: integrationPrefix + "-uid-" + uuid.NewString(), Name: name, Role: role}
	if _, err := integrationPool.Exec(context.Background(), `INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1, $2, $3, $4, now())`, u.ID, u.FirebaseUID, u.Name, u.Role); err != nil {
		t.Fatal(err)
	}
	return u
}

func connect(t *testing.T, coach, athlete authn.User) {
	t.Helper()
	if _, err := integrationPool.Exec(context.Background(), `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1, $2)`, coach.ID, athlete.ID); err != nil {
		t.Fatal(err)
	}
}

func sharedExercise(t *testing.T) string {
	t.Helper()
	name := integrationPrefix + " shared " + uuid.NewString()
	if _, err := integrationPool.Exec(context.Background(), `INSERT INTO exercises (id, name, owner_coach_id, created_at) VALUES ($1, $2, NULL, now())`, uuid.NewString(), name); err != nil {
		t.Fatal(err)
	}
	return name
}

// set is one logged set; rir < 0 means "RIR not recorded".
type set struct {
	load float64
	reps int
	rir  float64
}

type logged struct {
	sessionID, scheduledWorkoutID, workoutName string
}

type spec struct {
	coach, athlete authn.User
	date, exercise string
	unit           string
	start          bool
	complete       bool
	planned, extra []set
}

// seed schedules a workout with 3 frozen planned sets as spec.coach, then
// optionally starts it, logs planned/extra sets and completes it.
func seed(t *testing.T, s spec) logged {
	t.Helper()
	ctx := context.Background()
	reps, load := 8, 80.0
	unit := s.unit
	if unit == "" {
		unit = "kg"
	}
	workoutName := integrationPrefix + " workout " + uuid.NewString()
	w, err := workout.Create(ctx, integrationPool, s.coach, workout.CreateInput{
		Name: workoutName,
		Exercises: []workout.CreateExerciseInput{{
			Name: s.exercise,
			Plan: prescription.Plan{SetCount: 3, Defaults: prescription.Defaults{Reps: &reps, Load: &load, Unit: &unit}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := scheduledworkout.Create(ctx, integrationPool, s.coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{s.athlete.ID}, ScheduledDate: s.date})
	if err != nil {
		t.Fatal(err)
	}
	out := logged{scheduledWorkoutID: created[0].ID, workoutName: workoutName}
	if !s.start {
		return out
	}
	sess, _, err := workoutsession.Start(ctx, integrationPool, s.athlete, created[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	out.sessionID = sess.ID
	sweID := created[0].Exercises[0].ScheduledWorkoutExerciseID
	rows, err := integrationPool.Query(ctx, `SELECT id::text FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id = $1 ORDER BY planned_position`, sweID)
	if err != nil {
		t.Fatal(err)
	}
	var plannedIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		plannedIDs = append(plannedIDs, id)
	}
	rows.Close()
	log := func(kind string, plannedID *string, st set) {
		l, r, u := st.load, st.reps, unit
		in := workoutsession.CreateSetLogInput{Kind: kind, ScheduledWorkoutPlannedSetID: plannedID, ScheduledWorkoutExerciseID: sweID, Load: &l, Unit: &u, Reps: &r}
		if st.rir >= 0 {
			rir := st.rir
			in.RIR = &rir
		}
		if _, err := workoutsession.CreateSetLog(ctx, integrationPool, s.athlete, sess.ID, in); err != nil {
			t.Fatal(err)
		}
	}
	for i, st := range s.planned {
		id := plannedIDs[i]
		log("PLANNED", &id, st)
	}
	for _, st := range s.extra {
		log("EXTRA", nil, st)
	}
	if s.complete {
		if _, err := workoutsession.Complete(ctx, integrationPool, s.athlete, sess.ID); err != nil {
			t.Fatal(err)
		}
	}
	return out
}

// done seeds a COMPLETED one-exercise session with a single EXTRA set.
func done(t *testing.T, coach, athlete authn.User, date, exercise, unit string, st set) logged {
	return seed(t, spec{coach: coach, athlete: athlete, date: date, exercise: exercise, unit: unit, start: true, complete: true, extra: []set{st}})
}

func get(t *testing.T, caller authn.User, athleteID, weeks string) progressoverview.Response {
	t.Helper()
	resp, err := progressoverview.Get(context.Background(), integrationPool, caller, progressoverview.Query{AthleteID: athleteID, Weeks: weeks}, today)
	if err != nil {
		t.Fatalf("Get(%s, weeks=%q): %v", caller.Name, weeks, err)
	}
	return resp
}

func near(a *float64, b float64) bool { return a != nil && math.Abs(*a-b) < 0.011 }

func TestAuthorizationMatrix(t *testing.T) {
	requireDB(t)
	coach := newUser(t, "COACH", "Coach Auth")
	stranger := newUser(t, "COACH", "Coach Stranger")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)

	ctx := context.Background()
	q := progressoverview.Query{AthleteID: athlete.ID}
	if _, err := progressoverview.Get(ctx, integrationPool, athlete, q, today); !errors.Is(err, progressoverview.ErrForbidden) {
		t.Fatalf("athlete caller err = %v, want ErrForbidden", err)
	}
	if _, err := progressoverview.Get(ctx, integrationPool, stranger, q, today); !errors.Is(err, progressoverview.ErrNotFound) {
		t.Fatalf("unconnected coach err = %v, want ErrNotFound", err)
	}
	if _, err := progressoverview.Get(ctx, integrationPool, coach, progressoverview.Query{AthleteID: "not-a-uuid"}, today); !errors.Is(err, progressoverview.ErrNotFound) {
		t.Fatalf("invalid uuid err = %v, want ErrNotFound", err)
	}
	if _, err := progressoverview.Get(ctx, integrationPool, coach, progressoverview.Query{AthleteID: uuid.NewString()}, today); !errors.Is(err, progressoverview.ErrNotFound) {
		t.Fatalf("unknown athlete err = %v, want ErrNotFound", err)
	}
	// A hard validation error must not reveal an inaccessible athlete.
	if _, err := progressoverview.Get(ctx, integrationPool, stranger, progressoverview.Query{AthleteID: athlete.ID, Weeks: "99"}, today); !errors.Is(err, progressoverview.ErrNotFound) {
		t.Fatalf("unconnected coach + bad weeks err = %v, want ErrNotFound", err)
	}
	resp := get(t, coach, athlete.ID, "")
	if resp.Athlete.ID != athlete.ID || resp.Athlete.Name != "Jason" || resp.Window.Weeks != 8 {
		t.Fatalf("resp = %+v", resp)
	}
	// Empty athlete: null rate, non-nil empty exercises.
	if resp.Assignments.Scope != "OWN" || resp.Assignments.Scheduled != 0 || resp.Assignments.CompletionRate != nil || resp.Exercises == nil || len(resp.Exercises) != 0 {
		t.Fatalf("empty overview = %+v", resp)
	}
}

func TestWeeksBounds(t *testing.T) {
	requireDB(t)
	coach := newUser(t, "COACH", "Coach Weeks")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)
	name := sharedExercise(t)
	done(t, coach, athlete, "2026-09-10", name, "kg", set{80, 8, 2})

	for _, bad := range []string{"3", "27", "0", "-1", "abc", "8.5"} {
		_, err := progressoverview.Get(context.Background(), integrationPool, coach, progressoverview.Query{AthleteID: athlete.ID, Weeks: bad}, today)
		var ve *progressoverview.ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("weeks=%q err = %v, want ValidationError", bad, err)
		}
	}
	// Window = last N full ISO weeks plus the current week.
	for _, tc := range []struct {
		weeks   string
		n       int
		from    string
		entries int
	}{
		{"4", 4, "2026-09-07", 5},
		{"", 8, "2026-08-10", 9},
		{"26", 26, "2026-04-06", 27},
	} {
		r := get(t, coach, athlete.ID, tc.weeks)
		if r.Window.Weeks != tc.n || r.Window.From != tc.from || r.Window.To != "2026-10-07" {
			t.Fatalf("weeks=%q window = %+v", tc.weeks, r.Window)
		}
		if len(r.Exercises) != 1 || len(r.Exercises[0].Trend) != tc.entries {
			t.Fatalf("weeks=%q trend length = %d, want %d", tc.weeks, len(r.Exercises[0].Trend), tc.entries)
		}
		if r.Exercises[0].Trend[0].WeekStart != tc.from || r.Exercises[0].Trend[tc.entries-1].WeekStart != "2026-10-05" {
			t.Fatalf("weeks=%q trend bounds = %+v", tc.weeks, r.Exercises[0].Trend)
		}
	}
}

func TestWindowTrendNullWeeksAndEvents(t *testing.T) {
	requireDB(t)
	coach := newUser(t, "COACH", "Coach Trend")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)
	name := sharedExercise(t)

	done(t, coach, athlete, "2026-09-06", name, "kg", set{80, 8, 2})   // one day before the 4-week window
	done(t, coach, athlete, "2026-09-07", name, "kg", set{82.5, 8, 2}) // first day of the window
	done(t, coach, athlete, "2026-09-12", name, "kg", set{82.5, 9, 1}) // REP_PR
	done(t, coach, athlete, "2026-09-21", name, "kg", set{85, 6, 1})   // LOAD_PR
	done(t, coach, athlete, "2026-10-06", name, "kg", set{80, 8, 2})   // same week as the next
	done(t, coach, athlete, "2026-10-07", name, "kg", set{85, 7, 1})   // best of that week

	r := get(t, coach, athlete.ID, "4")
	if len(r.Exercises) != 1 {
		t.Fatalf("exercises = %+v", r.Exercises)
	}
	ex := r.Exercises[0]
	if ex.Unit != "kg" || ex.Exposures != 5 {
		t.Fatalf("exposures/unit = %d %s, want 5 kg (Sep 6 is outside the window)", ex.Exposures, ex.Unit)
	}
	if ex.Latest.Date != "2026-10-07" || *ex.Latest.TopSet.Load != 85 || ex.Latest.TopSet.Reps != 7 || *ex.Latest.TopSet.RIR != 1 {
		t.Fatalf("latest = %+v", ex.Latest)
	}
	// weeks: Sep 7, Sep 14, Sep 21, Sep 28, Oct 5. Empty weeks stay null.
	want := []*float64{ptrTo(110), nil, ptrTo(104.83), nil, ptrTo(107.67)}
	for i, w := range want {
		got := ex.Trend[i].Estimated1RM
		if (w == nil) != (got == nil) || (w != nil && !near(got, *w)) {
			t.Fatalf("trend[%d] = %v, want %v (%+v)", i, deref(got), deref(w), ex.Trend)
		}
	}
	// Events are compared against history from before the window (Sep 6).
	// All engine events from the last 28 days (since Sep 10), newest first,
	// capped at 5: Oct 7 REP_PR + LOAD_CHANGE, Oct 6 LOAD_CHANGE, Sep 21
	// LOAD_PR + LOAD_CHANGE; Sep 12's REP_PR is the sixth and is cut.
	var got []string
	for _, e := range ex.RecentEvents {
		got = append(got, e.Date+" "+e.Type)
	}
	wantEvents := "2026-10-07 REP_PR,2026-10-07 LOAD_CHANGE,2026-10-06 LOAD_CHANGE,2026-09-21 LOAD_PR,2026-09-21 LOAD_CHANGE"
	if strings.Join(got, ",") != wantEvents {
		t.Fatalf("recentEvents = %v", got)
	}
	// The first window exposure (Sep 7) was compared with Sep 6, not treated as new.
	r26 := get(t, coach, athlete.ID, "26")
	if r26.Exercises[0].Exposures != 6 {
		t.Fatalf("26 week exposures = %d, want 6", r26.Exercises[0].Exposures)
	}
}

func TestRecentEventTotalsAreUncappedAndCountAllUnits(t *testing.T) {
	requireDB(t)
	coach := newUser(t, "COACH", "Coach Totals")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)
	name := sharedExercise(t)

	// Empty window: zeros, windowDays still reported.
	empty := get(t, coach, athlete.ID, "4").RecentEventTotals
	if empty != (progressoverview.RecentEventTotals{WindowDays: 28}) {
		t.Fatalf("empty totals = %+v", empty)
	}

	done(t, coach, athlete, "2026-09-01", name, "kg", set{80, 8, 2})     // baseline
	done(t, coach, athlete, "2026-09-09", name, "kg", set{81, 8, 2})     // LOAD_PR, but older than 28 days (recent starts Sep 10)
	for i, load := range []float64{82.5, 85, 87.5, 90, 92.5, 95, 97.5} { // 7 LOAD_PRs, more than the 5-event cap
		done(t, coach, athlete, fmt.Sprintf("2026-09-%02d", 11+i), name, "kg", set{load, 8, 2})
	}
	done(t, coach, athlete, "2026-09-01", name, "lb", set{200, 5, 2}) // lb baseline
	done(t, coach, athlete, "2026-09-12", name, "lb", set{205, 5, 2}) // lb LOAD_PR
	done(t, coach, athlete, "2026-09-20", name, "lb", set{205, 6, 2}) // lb REP_PR

	r := get(t, coach, athlete.ID, "4")
	want := progressoverview.RecentEventTotals{WindowDays: 28, LoadPR: 8, RepPR: 1, Total: 9}
	if r.RecentEventTotals != want {
		t.Fatalf("totals = %+v, want %+v", r.RecentEventTotals, want)
	}
	for _, ex := range r.Exercises {
		if len(ex.RecentEvents) > 5 {
			t.Fatalf("recentEvents cap broken: %d", len(ex.RecentEvents))
		}
	}
	// Totals do not depend on the window length.
	if got := get(t, coach, athlete.ID, "26").RecentEventTotals; got != want {
		t.Fatalf("26 week totals = %+v, want %+v", got, want)
	}
}

func TestMissingRIRFallsBackToTopSetLoad(t *testing.T) {
	requireDB(t)
	coach := newUser(t, "COACH", "Coach Fallback")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)
	name := sharedExercise(t)
	done(t, coach, athlete, "2026-10-06", name, "kg", set{60, 10, -1})

	ex := get(t, coach, athlete.ID, "4").Exercises[0]
	if ex.Latest.TopSet.RIR != nil {
		t.Fatalf("rir = %v, want nil", *ex.Latest.TopSet.RIR)
	}
	if !near(ex.Trend[4].Estimated1RM, 60) {
		t.Fatalf("trend = %+v, want load fallback 60 in the last week", ex.Trend)
	}
}

func TestBothUnitsAreSeparateRows(t *testing.T) {
	requireDB(t)
	coach := newUser(t, "COACH", "Coach Units")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)
	name := sharedExercise(t)
	done(t, coach, athlete, "2026-10-05", name, "kg", set{100, 5, 2})
	done(t, coach, athlete, "2026-10-06", name, "lb", set{225, 5, 2})

	r := get(t, coach, athlete.ID, "4")
	if len(r.Exercises) != 2 {
		t.Fatalf("rows = %+v, want one per unit", r.Exercises)
	}
	// Most recent exposure first: lb (Oct 6), then kg (Oct 5). No conversion.
	if r.Exercises[0].Unit != "lb" || *r.Exercises[0].Latest.TopSet.Load != 225 || r.Exercises[1].Unit != "kg" || *r.Exercises[1].Latest.TopSet.Load != 100 {
		t.Fatalf("rows = %+v", r.Exercises)
	}
	if r.Exercises[0].ExerciseID != r.Exercises[1].ExerciseID || r.Exercises[0].Name != r.Exercises[1].Name {
		t.Fatalf("same exercise expected on both rows: %+v", r.Exercises)
	}
	// A kg exposure does not give the lb series a PR event or a trend point.
	if len(r.Exercises[0].RecentEvents) != 0 || len(r.Exercises[1].RecentEvents) != 0 {
		t.Fatalf("units leaked into each other's events: %+v", r.Exercises)
	}
}

func TestAssignmentsOwnScopeAndCompletion(t *testing.T) {
	requireDB(t)
	coachA := newUser(t, "COACH", "Coach Alpha Secret")
	coachB := newUser(t, "COACH", "Coach Bravo Secret")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coachA, athlete)
	connect(t, coachB, athlete)
	name := sharedExercise(t)

	// Coach A: completed (3 planned + 1 extra), Active (1 planned), Not started,
	// a future one (excluded), and one before the 4-week window (excluded).
	seed(t, spec{coach: coachA, athlete: athlete, date: "2026-10-01", exercise: name, start: true, complete: true,
		planned: []set{{80, 8, 2}, {80, 8, 2}, {80, 8, 2}}, extra: []set{{80, 8, 2}}})
	seed(t, spec{coach: coachA, athlete: athlete, date: "2026-10-05", exercise: name, start: true, planned: []set{{82.5, 8, 2}}})
	seed(t, spec{coach: coachA, athlete: athlete, date: "2026-10-06", exercise: name})
	seed(t, spec{coach: coachA, athlete: athlete, date: "2026-10-08", exercise: name})
	seed(t, spec{coach: coachA, athlete: athlete, date: "2026-09-06", exercise: name})
	// Coach B: two scheduled, one completed, with different loads.
	seed(t, spec{coach: coachB, athlete: athlete, date: "2026-10-02", exercise: name, start: true, complete: true,
		planned: []set{{90, 5, 1}, {90, 5, 1}, {90, 5, 1}}})
	seed(t, spec{coach: coachB, athlete: athlete, date: "2026-10-03", exercise: name})

	a := get(t, coachA, athlete.ID, "4")
	want := progressoverview.Assignments{Scope: "OWN", Scheduled: 3, Completed: 1, PlannedSets: 9, CompletedPlannedSets: 4, ExtraSets: 1}
	got := a.Assignments
	if got.Scope != want.Scope || got.Scheduled != 3 || got.Completed != 1 || got.PlannedSets != 9 || got.CompletedPlannedSets != 4 || got.ExtraSets != 1 {
		t.Fatalf("coach A assignments = %+v, want %+v", got, want)
	}
	if !near(got.CompletionRate, 0.33) {
		t.Fatalf("completionRate = %v, want 0.33 (Not started and Active are not completed)", deref(got.CompletionRate))
	}

	b := get(t, coachB, athlete.ID, "4").Assignments
	if b.Scheduled != 2 || b.Completed != 1 || b.PlannedSets != 6 || b.CompletedPlannedSets != 3 || b.ExtraSets != 0 || !near(b.CompletionRate, 0.5) {
		t.Fatalf("coach B assignments = %+v", b)
	}

	// Exercise data is NOT own-scoped: Coach A sees Coach B's 90 kg session.
	exA := get(t, coachA, athlete.ID, "4").Exercises
	if len(exA) != 1 || exA[0].Exposures != 2 || *exA[0].Latest.TopSet.Load != 90 || exA[0].Latest.Date != "2026-10-02" {
		t.Fatalf("coach A exercises = %+v, want both Coaches' completed exposures", exA)
	}
}

func TestRedaction(t *testing.T) {
	requireDB(t)
	coachA := newUser(t, "COACH", "Coach Alpha Secret")
	coachB := newUser(t, "COACH", "Coach Bravo Secret")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coachA, athlete)
	connect(t, coachB, athlete)
	name := sharedExercise(t)

	var forbidden []string
	for _, l := range []logged{
		seed(t, spec{coach: coachA, athlete: athlete, date: "2026-10-01", exercise: name, start: true, complete: true, planned: []set{{80, 8, 2}}}),
		seed(t, spec{coach: coachB, athlete: athlete, date: "2026-10-02", exercise: name, start: true, complete: true, planned: []set{{85, 6, 1}}, extra: []set{{85, 5, 1}}}),
		seed(t, spec{coach: coachB, athlete: athlete, date: "2026-10-03", exercise: name}),
	} {
		forbidden = append(forbidden, l.sessionID, l.scheduledWorkoutID, l.workoutName)
	}
	var setLogIDs []string
	rows, err := integrationPool.Query(context.Background(), `SELECT sl.id::text FROM set_logs sl JOIN workout_sessions ws ON ws.id = sl.session_id WHERE ws.athlete_id = $1`, athlete.ID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatal(err)
		}
		setLogIDs = append(setLogIDs, id)
	}
	rows.Close()
	forbidden = append(forbidden, setLogIDs...)
	forbidden = append(forbidden, coachA.ID, coachB.ID, coachA.Name, coachB.Name, "Secret")
	for _, key := range []string{"grade", "score", "status", "recommend", "label", "workoutName", "sessionId", "scheduledWorkoutId", "coachId"} {
		forbidden = append(forbidden, `"`+key)
	}

	for _, caller := range []authn.User{coachA, coachB} {
		raw, err := json.Marshal(get(t, caller, athlete.ID, "8"))
		if err != nil {
			t.Fatal(err)
		}
		body := string(raw)
		for _, f := range forbidden {
			if f != "" && strings.Contains(strings.ToLower(body), strings.ToLower(f)) {
				t.Fatalf("response for %s leaks %q: %s", caller.Name, f, body)
			}
		}
		// The only ids are the athlete's and the exercise's.
		if !strings.Contains(body, athlete.ID) {
			t.Fatalf("athlete id missing: %s", body)
		}
	}
}

func ptrTo(v float64) *float64 { return &v }

func deref(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}

func cleanupIntegration(ctx context.Context) {
	if integrationPool == nil {
		return
	}
	pattern := integrationPrefix + "%"
	_, _ = integrationPool.Exec(ctx, `DELETE FROM set_logs WHERE session_id IN (SELECT ws.id FROM workout_sessions ws JOIN users u ON u.id = ws.athlete_id WHERE u.firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workout_sessions WHERE athlete_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id IN (SELECT swe.id FROM scheduled_workout_exercises swe JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id WHERE sw.coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM scheduled_workout_exercises WHERE scheduled_workout_id IN (SELECT id FROM scheduled_workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM scheduled_workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workout_exercise_set_overrides WHERE workout_exercise_id IN (SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1))`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM exercises WHERE owner_coach_id IS NULL AND name LIKE $1`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM workouts WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM exercises WHERE owner_coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM coach_athletes WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1) OR athlete_id IN (SELECT id FROM users WHERE firebase_uid LIKE $1)`, pattern)
	_, _ = integrationPool.Exec(ctx, `DELETE FROM users WHERE firebase_uid LIKE $1`, pattern)
}
