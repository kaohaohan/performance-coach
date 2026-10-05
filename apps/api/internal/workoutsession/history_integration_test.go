package workoutsession_test

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

type loggedSet struct {
	load float64
	reps int
	rir  float64
}

// sharedExercise creates a SYSTEM exercise (no owner), so two different
// Coaches' workouts resolve to the same exercise_id.
func sharedExercise(t *testing.T) string {
	t.Helper()
	name := integrationPrefix + " shared " + uuid.NewString()
	if _, err := integrationPool.Exec(context.Background(), `INSERT INTO exercises (id, name, owner_coach_id, created_at) VALUES ($1, $2, NULL, now())`, uuid.NewString(), name); err != nil {
		t.Fatal(err)
	}
	return name
}

// scheduleOn schedules a one-exercise workout (planned unit `unit`) for the
// athlete on `date` as `coach` and starts the session as the athlete.
func scheduleOn(t *testing.T, coach, athlete authn.User, date, exerciseName, unit string) (workoutsession.Session, scheduledworkout.Created) {
	t.Helper()
	reps, load := 8, 80.0
	w, err := workout.Create(context.Background(), integrationPool, coach, workout.CreateInput{
		Name: integrationPrefix + " w " + uuid.NewString(),
		Exercises: []workout.CreateExerciseInput{{
			Name: exerciseName,
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
	session, _, err := workoutsession.Start(context.Background(), integrationPool, athlete, created[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	return session, created[0]
}

func logExtra(t *testing.T, athlete authn.User, sessionID string, created scheduledworkout.Created, unit string, sets ...loggedSet) []workoutsession.SetLog {
	t.Helper()
	var out []workoutsession.SetLog
	for _, s := range sets {
		load, rir, reps, u := s.load, s.rir, s.reps, unit
		sl, err := workoutsession.CreateSetLog(context.Background(), integrationPool, athlete, sessionID, workoutsession.CreateSetLogInput{
			Kind: "EXTRA", ScheduledWorkoutExerciseID: created.Exercises[0].ScheduledWorkoutExerciseID, Load: &load, Unit: &u, Reps: &reps, RIR: &rir,
		})
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, sl)
	}
	return out
}

func completedOn(t *testing.T, coach, athlete authn.User, date, exerciseName, unit string, sets ...loggedSet) []workoutsession.SetLog {
	t.Helper()
	session, created := scheduleOn(t, coach, athlete, date, exerciseName, unit)
	logs := logExtra(t, athlete, session.ID, created, unit, sets...)
	if _, err := workoutsession.Complete(context.Background(), integrationPool, athlete, session.ID); err != nil {
		t.Fatal(err)
	}
	return logs
}

func historyFor(t *testing.T, caller authn.User, sessionID string) workoutsession.SessionDetail {
	t.Helper()
	d, err := workoutsession.Get(context.Background(), integrationPool, caller, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Exercises) != 1 || d.Exercises[0].History == nil {
		t.Fatalf("exercise history missing: %+v", d.Exercises)
	}
	return d
}

func TestSessionHistoryFromOwnCoach(t *testing.T) {
	requireIntegrationDB(t)
	coach, athlete := integrationUser(t, "COACH"), integrationUser(t, "ATHLETE")
	integrationConnect(t, coach, athlete)
	name := sharedExercise(t)

	completedOn(t, coach, athlete, "2026-09-01", name, "kg", loggedSet{80, 8, 2}, loggedSet{70, 12, 3})
	completedOn(t, coach, athlete, "2026-09-08", name, "kg", loggedSet{82.5, 6, 1}, loggedSet{70, 12, 2})
	target, _ := scheduleOn(t, coach, athlete, "2026-09-15", name, "kg")

	for _, caller := range []authn.User{athlete, coach} {
		h := historyFor(t, caller, target.ID).Exercises[0].History
		if h.Last == nil || h.Last.Date != "2026-09-08" || len(h.Last.SetLogs) != 2 {
			t.Fatalf("last = %+v", h.Last)
		}
		if first := h.Last.SetLogs[0]; first.SetNumber != 1 || *first.Load != 82.5 || first.Unit != "kg" || first.Reps != 6 || *first.RIR != 1 {
			t.Fatalf("last set 1 = %+v", first)
		}
		if h.MaxLoad == nil || *h.MaxLoad.Load != 82.5 || h.MaxLoad.Reps != 6 || h.MaxLoad.Date != "2026-09-08" || h.MaxLoad.Unit != "kg" {
			t.Fatalf("maxLoad = %+v", h.MaxLoad)
		}
		if len(h.BestRepsByLoad) != 3 {
			t.Fatalf("bestRepsByLoad = %+v", h.BestRepsByLoad)
		}
		// Ascending load; 12 reps at 70 was first reached on 09-01.
		if b := h.BestRepsByLoad[0]; *b.Load != 70 || b.Reps != 12 || b.Date != "2026-09-01" {
			t.Fatalf("best at 70 = %+v", b)
		}
	}
}

func TestSessionHistoryIncludesOtherCoachAndLeaksNoIDs(t *testing.T) {
	requireIntegrationDB(t)
	coachA, coachB, athlete := integrationUser(t, "COACH"), integrationUser(t, "COACH"), integrationUser(t, "ATHLETE")
	integrationConnect(t, coachA, athlete)
	integrationConnect(t, coachB, athlete)
	name := sharedExercise(t)

	pastLogs := completedOn(t, coachA, athlete, "2026-09-01", name, "kg", loggedSet{90, 5, 1})
	targetByB, _ := scheduleOn(t, coachB, athlete, "2026-09-10", name, "kg")

	// Coach B scheduled the target; Coach A's earlier session still counts.
	detail := historyFor(t, coachB, targetByB.ID)
	h := detail.Exercises[0].History
	if h.Last == nil || h.Last.Date != "2026-09-01" || h.MaxLoad == nil || *h.MaxLoad.Load != 90 {
		t.Fatalf("other coach's history not visible: %+v", h)
	}

	raw, err := json.Marshal(h)
	if err != nil {
		t.Fatal(err)
	}
	body := string(raw)
	for _, id := range []string{pastLogs[0].ID, coachA.ID, coachB.ID} {
		if strings.Contains(body, id) {
			t.Fatalf("history leaks id %s: %s", id, body)
		}
	}
	for _, key := range []string{"\"id\"", "sessionId", "scheduledWorkoutId", "loggedByUserId", "coachId"} {
		if strings.Contains(body, key) {
			t.Fatalf("history contains %s: %s", key, body)
		}
	}
}

func TestSessionHistoryEmptyWhenNoPriorSessions(t *testing.T) {
	requireIntegrationDB(t)
	coach, athlete := integrationUser(t, "COACH"), integrationUser(t, "ATHLETE")
	integrationConnect(t, coach, athlete)
	target, _ := scheduleOn(t, coach, athlete, "2026-09-15", sharedExercise(t), "kg")

	h := historyFor(t, athlete, target.ID).Exercises[0].History
	if h.Last != nil || h.MaxLoad != nil || h.BestRepsByLoad == nil || len(h.BestRepsByLoad) != 0 {
		t.Fatalf("empty history = %+v", h)
	}
	raw, _ := json.Marshal(h)
	if string(raw) != `{"last":null,"maxLoad":null,"bestRepsByLoad":[]}` {
		t.Fatalf("json = %s", raw)
	}
}

func TestSessionHistoryExcludesActiveLaterSameDayAndOtherAthletesAndExercises(t *testing.T) {
	requireIntegrationDB(t)
	coach, athlete, otherAthlete := integrationUser(t, "COACH"), integrationUser(t, "ATHLETE"), integrationUser(t, "ATHLETE")
	integrationConnect(t, coach, athlete)
	integrationConnect(t, coach, otherAthlete)
	name, otherName := sharedExercise(t), sharedExercise(t)

	completedOn(t, coach, athlete, "2026-09-01", name, "kg", loggedSet{60, 10, 2}) // the only one that counts

	// ACTIVE (started, sets logged, never completed) must not count.
	activeSession, activeCreated := scheduleOn(t, coach, athlete, "2026-09-05", name, "kg")
	logExtra(t, athlete, activeSession.ID, activeCreated, "kg", loggedSet{200, 1, 0})

	completedOn(t, coach, athlete, "2026-09-10", name, "kg", loggedSet{150, 3, 0})      // same date as the target: excluded
	completedOn(t, coach, athlete, "2026-09-20", name, "kg", loggedSet{160, 3, 0})      // later: excluded
	completedOn(t, coach, otherAthlete, "2026-09-02", name, "kg", loggedSet{300, 1, 0}) // another athlete
	completedOn(t, coach, athlete, "2026-09-03", otherName, "kg", loggedSet{250, 1, 0}) // another exercise
	target, _ := scheduleOn(t, coach, athlete, "2026-09-10", name, "kg")

	h := historyFor(t, coach, target.ID).Exercises[0].History
	if h.Last == nil || h.Last.Date != "2026-09-01" || len(h.Last.SetLogs) != 1 || *h.Last.SetLogs[0].Load != 60 {
		t.Fatalf("last = %+v", h.Last)
	}
	if h.MaxLoad == nil || *h.MaxLoad.Load != 60 || len(h.BestRepsByLoad) != 1 {
		t.Fatalf("maxLoad = %+v, bests = %+v", h.MaxLoad, h.BestRepsByLoad)
	}
}

func TestSessionHistoryKeepsUnitsSeparate(t *testing.T) {
	requireIntegrationDB(t)
	coach, athlete := integrationUser(t, "COACH"), integrationUser(t, "ATHLETE")
	integrationConnect(t, coach, athlete)
	name := sharedExercise(t)

	completedOn(t, coach, athlete, "2026-09-01", name, "kg", loggedSet{100, 5, 2})
	completedOn(t, coach, athlete, "2026-09-08", name, "lb", loggedSet{225, 5, 2})
	targetKg, _ := scheduleOn(t, coach, athlete, "2026-09-15", name, "kg")
	targetLb, _ := scheduleOn(t, coach, athlete, "2026-09-16", name, "lb")

	kg := historyFor(t, coach, targetKg.ID).Exercises[0].History
	if kg.Last == nil || kg.Last.SetLogs[0].Unit != "lb" {
		t.Fatalf("last keeps its recorded unit: %+v", kg.Last)
	}
	if kg.MaxLoad == nil || *kg.MaxLoad.Load != 100 || kg.MaxLoad.Unit != "kg" || len(kg.BestRepsByLoad) != 1 {
		t.Fatalf("kg plan must only see kg bests: %+v / %+v", kg.MaxLoad, kg.BestRepsByLoad)
	}

	lb := historyFor(t, coach, targetLb.ID).Exercises[0].History
	if lb.MaxLoad == nil || *lb.MaxLoad.Load != 225 || lb.MaxLoad.Unit != "lb" || len(lb.BestRepsByLoad) != 1 {
		t.Fatalf("lb plan must only see lb bests: %+v / %+v", lb.MaxLoad, lb.BestRepsByLoad)
	}
}
