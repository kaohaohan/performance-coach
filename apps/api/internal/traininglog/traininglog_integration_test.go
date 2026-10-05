package traininglog_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/traininglog"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

var (
	integrationPool       *pgxpool.Pool
	integrationSkipReason string
	integrationPrefix     = "traininglog-integration-" + uuid.NewString()
)

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

func exerciseID(t *testing.T, name string) string {
	t.Helper()
	var id string
	if err := integrationPool.QueryRow(context.Background(), `SELECT id::text FROM exercises WHERE name = $1`, name).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

type set struct {
	load float64
	reps int
	rir  float64
}

type logged struct {
	sessionID, scheduledWorkoutID, workoutName string
}

// session schedules a one-exercise workout as `coach`, has the athlete start
// it and log `sets`, and completes it when complete is true.
func session(t *testing.T, coach, athlete authn.User, date, exercise, unit string, complete bool, sets ...set) logged {
	t.Helper()
	reps, load := 8, 80.0
	workoutName := integrationPrefix + " workout " + uuid.NewString()
	w, err := workout.Create(context.Background(), integrationPool, coach, workout.CreateInput{
		Name: workoutName,
		Exercises: []workout.CreateExerciseInput{{
			Name: exercise,
			Plan: prescription.Plan{SetCount: 2, Defaults: prescription.Defaults{Reps: &reps, Load: &load, Unit: &unit}},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	created, err := scheduledworkout.Create(context.Background(), integrationPool, coach, scheduledworkout.CreateInput{WorkoutID: w.ID, AthleteIDs: []string{athlete.ID}, ScheduledDate: date})
	if err != nil {
		t.Fatal(err)
	}
	s, _, err := workoutsession.Start(context.Background(), integrationPool, athlete, created[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, st := range sets {
		l, r, rir, u := st.load, st.reps, st.rir, unit
		if _, err := workoutsession.CreateSetLog(context.Background(), integrationPool, athlete, s.ID, workoutsession.CreateSetLogInput{
			Kind: "EXTRA", ScheduledWorkoutExerciseID: created[0].Exercises[0].ScheduledWorkoutExerciseID, Load: &l, Unit: &u, Reps: &r, RIR: &rir,
		}); err != nil {
			t.Fatal(err)
		}
	}
	if complete {
		if _, err := workoutsession.Complete(context.Background(), integrationPool, athlete, s.ID); err != nil {
			t.Fatal(err)
		}
	}
	return logged{sessionID: s.ID, scheduledWorkoutID: created[0].ID, workoutName: workoutName}
}

func list(t *testing.T, caller authn.User, q traininglog.Query) traininglog.Response {
	t.Helper()
	resp, err := traininglog.List(context.Background(), integrationPool, caller, q)
	if err != nil {
		t.Fatalf("List(%+v): %v", q, err)
	}
	return resp
}

func wide(athleteID string) traininglog.Query {
	return traininglog.Query{From: "2026-01-01", To: "2026-06-30", AthleteID: athleteID}
}

func TestAuthorizationAndRedaction(t *testing.T) {
	requireDB(t)
	coachA, coachB := newUser(t, "COACH", "Coach Alpha Secret"), newUser(t, "COACH", "Coach Bravo Secret")
	athlete, other := newUser(t, "ATHLETE", "Jason"), newUser(t, "ATHLETE", "Stranger")
	unconnectedCoach := newUser(t, "COACH", "Coach Charlie")
	connect(t, coachA, athlete)
	connect(t, coachB, athlete)
	connect(t, coachB, other)
	name := sharedExercise(t)

	own := session(t, coachA, athlete, "2026-03-01", name, "kg", true, set{80, 8, 2})
	theirs := session(t, coachB, athlete, "2026-03-08", name, "kg", true, set{82.5, 6, 1})
	strangers := session(t, coachB, other, "2026-03-09", name, "kg", true, set{100, 5, 1})

	// Athlete: everything of their own, all Coaches, with ids.
	resp := list(t, athlete, wide(""))
	if len(resp.Sessions) != 2 {
		t.Fatalf("athlete sees %d sessions, want 2", len(resp.Sessions))
	}
	for _, s := range resp.Sessions {
		if s.Source != traininglog.SourceOwn || s.SessionID == nil || s.WorkoutName == nil {
			t.Fatalf("athlete session = %+v", s)
		}
		if s.Athlete.ID != athlete.ID || s.Athlete.Name != "Jason" {
			t.Fatalf("athlete = %+v", s.Athlete)
		}
	}
	if resp.Sessions[0].Date != "2026-03-08" || resp.Sessions[1].Date != "2026-03-01" {
		t.Fatalf("not newest first: %s, %s", resp.Sessions[0].Date, resp.Sessions[1].Date)
	}
	// Athlete may pass their own id, never someone else's.
	if got := list(t, athlete, wide(athlete.ID)); len(got.Sessions) != 2 {
		t.Fatalf("athlete self id sessions = %d", len(got.Sessions))
	}
	if _, err := traininglog.List(context.Background(), integrationPool, athlete, wide(other.ID)); !errors.Is(err, traininglog.ErrNotFound) {
		t.Fatalf("athlete other id err = %v, want ErrNotFound", err)
	}

	// Coach A: own session in full, Coach B's session redacted.
	resp = list(t, coachA, wide(athlete.ID))
	if len(resp.Sessions) != 2 {
		t.Fatalf("coach A sees %d sessions, want 2", len(resp.Sessions))
	}
	byDate := map[string]traininglog.Session{}
	for _, s := range resp.Sessions {
		byDate[s.Date] = s
	}
	o := byDate["2026-03-01"]
	if o.Source != traininglog.SourceOwn || o.SessionID == nil || *o.SessionID != own.sessionID || *o.ScheduledWorkoutID != own.scheduledWorkoutID || *o.WorkoutName != own.workoutName {
		t.Fatalf("own session = %+v", o)
	}
	x := byDate["2026-03-08"]
	if x.Source != traininglog.SourceOtherCoach || x.SessionID != nil || x.ScheduledWorkoutID != nil || x.WorkoutName != nil {
		t.Fatalf("other-coach session not redacted: %+v", x)
	}
	if len(x.Exercises) != 1 || len(x.Exercises[0].SetLogs) != 1 || *x.Exercises[0].SetLogs[0].Load != 82.5 {
		t.Fatalf("other-coach actuals missing: %+v", x.Exercises)
	}

	// The serialized OTHER_COACH payload names nobody and carries no ids.
	raw, err := json.Marshal(x)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{coachB.ID, coachA.ID, "Coach Bravo Secret", theirs.sessionID, theirs.scheduledWorkoutID, theirs.workoutName, "coachCue", `"plan"`} {
		if strings.Contains(string(raw), forbidden) {
			t.Fatalf("OTHER_COACH JSON leaks %q: %s", forbidden, raw)
		}
	}
	if !strings.Contains(string(raw), `"sessionId":null`) || !strings.Contains(string(raw), `"workoutName":null`) {
		t.Fatalf("redacted fields must be explicit nulls: %s", raw)
	}
	// SetLog objects carry no id key.
	var generic struct {
		Sessions []struct {
			Exercises []struct {
				SetLogs []map[string]any `json:"setLogs"`
			} `json:"exercises"`
		} `json:"sessions"`
	}
	full, _ := json.Marshal(resp)
	if err := json.Unmarshal(full, &generic); err != nil {
		t.Fatal(err)
	}
	for _, s := range generic.Sessions {
		for _, e := range s.Exercises {
			for _, sl := range e.SetLogs {
				if _, has := sl["id"]; has {
					t.Fatalf("SetLog id leaked: %v", sl)
				}
			}
		}
	}

	// Coach without a coach_athletes row: 404 for that athlete, nothing leaks without athleteId.
	if _, err := traininglog.List(context.Background(), integrationPool, unconnectedCoach, wide(athlete.ID)); !errors.Is(err, traininglog.ErrNotFound) {
		t.Fatalf("unconnected coach err = %v, want ErrNotFound", err)
	}
	if got := list(t, unconnectedCoach, wide("")); len(got.Sessions) != 0 {
		t.Fatalf("unconnected coach sees %d sessions", len(got.Sessions))
	}
	// Coach A has no access to the stranger.
	if _, err := traininglog.List(context.Background(), integrationPool, coachA, wide(other.ID)); !errors.Is(err, traininglog.ErrNotFound) {
		t.Fatalf("coach A stranger err = %v", err)
	}
	// Without athleteId a Coach sees only connected athletes, and (no exerciseId) no exposures block.
	resp = list(t, coachA, wide(""))
	for _, s := range resp.Sessions {
		if s.Athlete.ID != athlete.ID {
			t.Fatalf("coach A saw athlete %s", s.Athlete.ID)
		}
	}
	// Coach B sees all three (own: theirs+strangers; OTHER_COACH: Coach A's).
	resp = list(t, coachB, wide(""))
	if len(resp.Sessions) != 3 {
		t.Fatalf("coach B sees %d sessions, want 3", len(resp.Sessions))
	}
	_ = strangers
}

func TestRangeAndArgumentValidation(t *testing.T) {
	requireDB(t)
	coach := newUser(t, "COACH", "Coach")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)

	bad := []traininglog.Query{
		{To: "2026-03-01"},
		{From: "2026-03-01"},
		{From: "03/01/2026", To: "2026-03-02"},
		{From: "2026-03-02", To: "2026-03-01"},
		{From: "2026-01-01", To: "2026-07-05"}, // 185 days
		{From: "2026-01-01", To: "2026-01-02", AthleteID: "nope"},
		{From: "2026-01-01", To: "2026-01-02", ExerciseID: "nope"},
		{From: "2026-01-01", To: "2026-01-02", Status: "DONE"},
	}
	for _, q := range bad {
		_, err := traininglog.List(context.Background(), integrationPool, coach, q)
		var ve *traininglog.ValidationError
		if !errors.As(err, &ve) {
			t.Fatalf("List(%+v) err = %v, want ValidationError", q, err)
		}
	}
	// 184 days inclusive-span boundary is allowed.
	if _, err := traininglog.List(context.Background(), integrationPool, coach, traininglog.Query{From: "2026-01-01", To: "2026-07-04"}); err != nil {
		t.Fatalf("184-day span rejected: %v", err)
	}
	if _, err := traininglog.List(context.Background(), integrationPool, authn.User{ID: uuid.NewString(), Role: "ADMIN"}, wide("")); !errors.Is(err, traininglog.ErrForbidden) {
		t.Fatalf("unknown role err = %v", err)
	}
}

func TestFiltersAndRange(t *testing.T) {
	requireDB(t)
	coach, athlete := newUser(t, "COACH", "Coach"), newUser(t, "ATHLETE", "Jason")
	connect(t, coach, athlete)
	squat, bench := sharedExercise(t), sharedExercise(t)

	session(t, coach, athlete, "2026-02-01", squat, "kg", true, set{100, 5, 2})
	session(t, coach, athlete, "2026-02-08", bench, "kg", true, set{60, 8, 2})
	active := session(t, coach, athlete, "2026-02-15", squat, "kg", false, set{102.5, 5, 2})
	session(t, coach, athlete, "2026-02-22", squat, "kg", true) // completed, no sets logged
	session(t, coach, athlete, "2026-05-01", squat, "kg", true, set{105, 5, 2})

	feb := traininglog.Query{From: "2026-02-01", To: "2026-02-28", AthleteID: athlete.ID}

	if got := list(t, athlete, feb); len(got.Sessions) != 4 {
		t.Fatalf("range sessions = %d, want 4", len(got.Sessions))
	}

	q := feb
	q.Status = "ACTIVE"
	got := list(t, coach, q)
	if len(got.Sessions) != 1 || got.Sessions[0].Status != "ACTIVE" || *got.Sessions[0].SessionID != active.sessionID {
		t.Fatalf("ACTIVE filter = %+v", got.Sessions)
	}
	if ex := got.Sessions[0].Exercises; len(ex) != 1 || len(ex[0].Events) != 0 || len(ex[0].SetLogs) != 1 {
		t.Fatalf("ACTIVE exercise = %+v (events must be [] and sets as logged)", ex)
	}
	q.Status = "COMPLETED"
	if got := list(t, coach, q); len(got.Sessions) != 3 {
		t.Fatalf("COMPLETED filter = %d, want 3", len(got.Sessions))
	}

	q = feb
	q.ExerciseID = exerciseID(t, bench)
	got = list(t, coach, q)
	if len(got.Sessions) != 1 || got.Sessions[0].Exercises[0].Name != bench {
		t.Fatalf("exerciseId filter = %+v", got.Sessions)
	}
	if got.Exposures == nil {
		t.Fatal("exposures must be present with exerciseId and a single athlete")
	}

	// No exerciseId: no exposures key at all.
	raw, _ := json.Marshal(list(t, coach, feb))
	if strings.Contains(string(raw), "exposures") {
		t.Fatalf("exposures present without exerciseId: %s", raw)
	}
}

func TestEventsAndExposuresUseAllEarlierHistory(t *testing.T) {
	requireDB(t)
	coachA, coachB := newUser(t, "COACH", "A"), newUser(t, "COACH", "B")
	athlete := newUser(t, "ATHLETE", "Jason")
	connect(t, coachA, athlete)
	connect(t, coachB, athlete)
	name := sharedExercise(t)

	// 03-01 A: 80x8; 03-08 B: 80x9 (REP_PR); 03-15 A: 82.5x6 (LOAD_PR, +2.5);
	// 03-22 A: 82.5x6 (MATCHED); lb series: 04-01 B 180x5, 04-08 A 185x5.
	session(t, coachA, athlete, "2026-03-01", name, "kg", true, set{80, 8, 2})
	session(t, coachB, athlete, "2026-03-08", name, "kg", true, set{80, 9, 2})
	session(t, coachA, athlete, "2026-03-15", name, "kg", true, set{82.5, 6, 1})
	session(t, coachA, athlete, "2026-03-22", name, "kg", true, set{82.5, 6, 1})
	session(t, coachB, athlete, "2026-04-01", name, "lb", true, set{180, 5, 2})
	session(t, coachA, athlete, "2026-04-08", name, "lb", true, set{185, 5, 2})

	// A range that starts after the first sessions still compares against them.
	q := traininglog.Query{From: "2026-03-15", To: "2026-04-30", AthleteID: athlete.ID, ExerciseID: exerciseID(t, name), Status: "COMPLETED"}
	got := list(t, coachA, q)
	if len(got.Sessions) != 4 {
		t.Fatalf("sessions = %d, want 4", len(got.Sessions))
	}
	events := map[string][]string{}
	for _, s := range got.Sessions {
		for _, e := range s.Exercises[0].Events {
			events[s.Date] = append(events[s.Date], e.Type)
		}
	}
	want := map[string][]string{
		"2026-03-15": {"LOAD_PR", "LOAD_CHANGE"},
		"2026-03-22": {"MATCHED"},
		// lb is its own series: 04-01 is the first lb exposure (no events), 04-08 a load PR.
		"2026-04-08": {"LOAD_PR", "LOAD_CHANGE"},
	}
	for date, w := range want {
		if strings.Join(events[date], ",") != strings.Join(w, ",") {
			t.Fatalf("events[%s] = %v, want %v (all %v)", date, events[date], w, events)
		}
	}
	if len(events["2026-04-01"]) != 0 {
		t.Fatalf("first lb exposure has events: %v", events["2026-04-01"])
	}

	// REP_PR across Coaches: 03-08 (Coach B) beat 03-01 (Coach A) at 80 kg.
	q.From = "2026-03-01"
	got = list(t, coachA, q)
	for _, s := range got.Sessions {
		if s.Date == "2026-03-08" {
			types := []string{}
			for _, e := range s.Exercises[0].Events {
				types = append(types, e.Type)
			}
			if len(types) < 1 || types[0] != "REP_PR" {
				t.Fatalf("03-08 events = %v, want REP_PR first", types)
			}
		}
	}

	exp := *got.Exposures
	if len(exp["kg"]) != 4 || len(exp["lb"]) != 2 {
		t.Fatalf("exposures kg=%d lb=%d, want 4 and 2 (never converted)", len(exp["kg"]), len(exp["lb"]))
	}
	for i := 1; i < len(exp["kg"]); i++ {
		if exp["kg"][i-1].Date > exp["kg"][i].Date {
			t.Fatalf("kg exposures not oldest first: %+v", exp["kg"])
		}
	}
	first := exp["kg"][0]
	if first.Source != traininglog.SourceOwn || *first.TopSet.Load != 80 || first.TopSet.Reps != 8 || first.SetCount != 1 || first.Estimated1RM == nil {
		t.Fatalf("first kg exposure = %+v", first)
	}
	if exp["kg"][1].Source != traininglog.SourceOtherCoach {
		t.Fatalf("03-08 exposure source = %s, want OTHER_COACH for coach A", exp["kg"][1].Source)
	}

	// The athlete sees every exposure as their own.
	for _, e := range (*list(t, athlete, q).Exposures)["kg"] {
		if e.Source != traininglog.SourceOwn {
			t.Fatalf("athlete exposure source = %s", e.Source)
		}
	}

	// A Coach without athleteId + exerciseId gets no exposures (ambiguous across athletes).
	q2 := q
	q2.AthleteID = ""
	if r := list(t, coachA, q2); r.Exposures != nil {
		t.Fatalf("exposures returned without a single athlete: %+v", r.Exposures)
	}
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
