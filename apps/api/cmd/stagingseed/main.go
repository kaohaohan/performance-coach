// Command stagingseed fills a NON-PRODUCTION database with realistic fake
// training history so Coach and Athlete screens (LAST/PR, Exercise Progress,
// Progress Overview) can be tried by hand.
//
// It attaches the history to two EXISTING accounts, chosen by exact name, and
// adds one fake "other Coach" (no login) so cross-coach redaction can be
// seen. Every row it creates is recognisable (workout names start with
// "[SEED]", the fake Coach's firebase_uid starts with "seed-"), and `-clean`
// removes exactly those rows. It is idempotent: seeding first cleans.
//
// Safety: DATABASE_URL must be set, and -expect-host must be a substring of
// the database host or the command refuses to run. It needs only INSERT /
// DELETE rights (the API runtime role is enough).
//
//	go run ./cmd/stagingseed -list -expect-host <host-part>
//	go run ./cmd/stagingseed -coach "<name>" -athlete "<name>" -expect-host <host-part>
//	go run ./cmd/stagingseed -clean -expect-host <host-part>
package main

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/kaohaohan/performance-coach/apps/api/internal/db"
)

const (
	seedPrefix  = "[SEED]"
	fakeUIDPref = "seed-"
	weeks       = 8
)

func main() {
	list := flag.Bool("list", false, "list users (name, role) and exit")
	clean := flag.Bool("clean", false, "remove all seeded rows and exit")
	coachName := flag.String("coach", "", "exact name of the existing Coach account")
	athleteName := flag.String("athlete", "", "exact name of the existing Athlete account")
	expectHost := flag.String("expect-host", "", "REQUIRED: substring the database host must contain")
	flag.Parse()

	if err := run(*list, *clean, *coachName, *athleteName, *expectHost); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}

func run(list, clean bool, coachName, athleteName, expectHost string) error {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return fmt.Errorf("DATABASE_URL is not set")
	}
	if expectHost == "" {
		return fmt.Errorf("-expect-host is required")
	}
	u, err := url.Parse(dsn)
	if err != nil || u.Hostname() == "" {
		return fmt.Errorf("DATABASE_URL has no readable host")
	}
	if !strings.Contains(u.Hostname(), expectHost) {
		return fmt.Errorf("database host %q does not contain %q: refusing to run", u.Hostname(), expectHost)
	}
	fmt.Println("target database host:", u.Hostname())

	ctx := context.Background()
	pool, err := db.NewPool(ctx, dsn, 2)
	if err != nil {
		return fmt.Errorf("connect: %w", err)
	}
	defer pool.Close()

	if list {
		rows, err := pool.Query(ctx, `SELECT name, role FROM users WHERE deleted_at IS NULL AND firebase_uid NOT LIKE $1 ORDER BY role, name`, fakeUIDPref+"%")
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var n, r string
			if err := rows.Scan(&n, &r); err != nil {
				return err
			}
			fmt.Printf("%-8s %s\n", r, n)
		}
		return rows.Err()
	}

	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := cleanSeed(ctx, tx); err != nil {
		return fmt.Errorf("clean: %w", err)
	}
	if clean {
		if err := tx.Commit(ctx); err != nil {
			return err
		}
		fmt.Println("seed rows removed")
		return nil
	}
	if coachName == "" || athleteName == "" {
		return fmt.Errorf("-coach and -athlete are required (use -list to see names)")
	}
	coachID, err := userByName(ctx, tx, coachName, "COACH")
	if err != nil {
		return err
	}
	athleteID, err := userByName(ctx, tx, athleteName, "ATHLETE")
	if err != nil {
		return err
	}
	n, err := seed(ctx, tx, coachID, athleteID, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("seed: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	fmt.Printf("seeded: %d completed sessions, 1 not-started session today, plus an other-Coach history\n", n)
	return nil
}

func userByName(ctx context.Context, tx pgx.Tx, name, role string) (string, error) {
	rows, err := tx.Query(ctx, `SELECT id::text FROM users WHERE name = $1 AND role = $2 AND deleted_at IS NULL`, name, role)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(ids) != 1 {
		return "", fmt.Errorf("expected exactly one %s named %q, found %d (use -list)", role, name, len(ids))
	}
	return ids[0], nil
}

// cleanSeed removes only rows reachable from seeded workouts, then the fake
// Coach. Real data is never matched.
func cleanSeed(ctx context.Context, tx pgx.Tx) error {
	stmts := []string{
		`DELETE FROM set_logs WHERE session_id IN (SELECT ws.id FROM workout_sessions ws JOIN scheduled_workouts sw ON sw.id = ws.scheduled_workout_id JOIN workouts w ON w.id = sw.workout_id WHERE w.name LIKE '[SEED]%')`,
		`DELETE FROM workout_sessions WHERE scheduled_workout_id IN (SELECT sw.id FROM scheduled_workouts sw JOIN workouts w ON w.id = sw.workout_id WHERE w.name LIKE '[SEED]%')`,
		`DELETE FROM scheduled_workout_planned_sets WHERE scheduled_workout_exercise_id IN (SELECT swe.id FROM scheduled_workout_exercises swe JOIN scheduled_workouts sw ON sw.id = swe.scheduled_workout_id JOIN workouts w ON w.id = sw.workout_id WHERE w.name LIKE '[SEED]%')`,
		`DELETE FROM scheduled_workout_exercises WHERE scheduled_workout_id IN (SELECT sw.id FROM scheduled_workouts sw JOIN workouts w ON w.id = sw.workout_id WHERE w.name LIKE '[SEED]%')`,
		`DELETE FROM scheduled_workouts WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE '[SEED]%')`,
		`DELETE FROM workout_exercise_set_overrides WHERE workout_exercise_id IN (SELECT we.id FROM workout_exercises we JOIN workouts w ON w.id = we.workout_id WHERE w.name LIKE '[SEED]%')`,
		`DELETE FROM workout_exercises WHERE workout_id IN (SELECT id FROM workouts WHERE name LIKE '[SEED]%')`,
		`DELETE FROM workouts WHERE name LIKE '[SEED]%'`,
		`DELETE FROM coach_athletes WHERE coach_id IN (SELECT id FROM users WHERE firebase_uid LIKE 'seed-%')`,
		`DELETE FROM users WHERE firebase_uid LIKE 'seed-%'`,
	}
	for _, s := range stmts {
		if _, err := tx.Exec(ctx, s); err != nil {
			return err
		}
	}
	return nil
}

type exSpec struct {
	name  string
	unit  string
	loads [weeks]float64
	reps  [weeks][3]int
	plan  int // planned reps per set
}

var armDay = []exSpec{
	{"Cable Biceps Curl", "kg", [weeks]float64{20, 20, 20, 20, 22.5, 22.5, 22.5, 22.5},
		[weeks][3]int{{9, 9, 8}, {10, 9, 9}, {11, 10, 10}, {12, 11, 11}, {9, 9, 8}, {10, 9, 9}, {11, 10, 10}, {12, 11, 10}}, 10},
	{"Hammer Curl", "kg", [weeks]float64{14, 14, 14, 14, 14, 14, 14, 14},
		[weeks][3]int{{10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {11, 10, 10}}, 10},
	{"Cable Triceps Pushdown", "kg", [weeks]float64{25, 25, 25, 25, 27.5, 27.5, 27.5, 27.5},
		[weeks][3]int{{12, 11, 11}, {12, 12, 11}, {12, 12, 12}, {13, 12, 12}, {10, 10, 9}, {10, 10, 10}, {11, 10, 10}, {11, 11, 10}}, 12},
}

var legDay = []exSpec{
	{"Back Squat", "kg", [weeks]float64{120, 125, 130, 135, 140, 140, 140, 140},
		[weeks][3]int{{8, 8, 7}, {8, 8, 7}, {8, 7, 7}, {8, 7, 7}, {8, 7, 7}, {8, 8, 7}, {7, 7, 6}, {6, 6, 5}}, 8},
	{"Romanian Deadlift", "kg", [weeks]float64{90, 92.5, 95, 97.5, 100, 100, 102.5, 105},
		[weeks][3]int{{10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 10, 9}, {10, 9, 9}}, 10},
	{"Leg Press", "lb", [weeks]float64{270, 290, 290, 310, 310, 330, 330, 350},
		[weeks][3]int{{12, 12, 10}, {12, 11, 10}, {12, 12, 11}, {12, 11, 10}, {12, 12, 10}, {12, 11, 11}, {12, 12, 11}, {12, 11, 10}}, 12},
}

var setRIR = [3]float64{2, 1, 1}

// lastWeekday returns the most recent date strictly before `before` that falls on wd.
func lastWeekday(before time.Time, wd time.Weekday) time.Time {
	d := before.AddDate(0, 0, -1)
	for d.Weekday() != wd {
		d = d.AddDate(0, 0, -1)
	}
	return d
}

type seeder struct {
	ctx       context.Context
	tx        pgx.Tx
	athleteID string
	exID      map[string]string
	sessions  int
}

func seed(ctx context.Context, tx pgx.Tx, coachID, athleteID string, now time.Time) (int, error) {
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	s := &seeder{ctx: ctx, tx: tx, athleteID: athleteID, exID: map[string]string{}}

	// The relationship may already exist.
	if _, err := tx.Exec(ctx, `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, coachID, athleteID); err != nil {
		return 0, err
	}
	// A fake second Coach (no login) linked to the same athlete.
	otherID := uuid.NewString()
	if _, err := tx.Exec(ctx, `INSERT INTO users (id, firebase_uid, name, role, created_at) VALUES ($1,$2,$3,'COACH',now())`, otherID, fakeUIDPref+otherID, seedPrefix+" Other Coach"); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO coach_athletes (coach_id, athlete_id) VALUES ($1,$2)`, otherID, athleteID); err != nil {
		return 0, err
	}

	armWorkout, err := s.workout(coachID, seedPrefix+" Arm Day", armDay)
	if err != nil {
		return 0, err
	}
	legWorkout, err := s.workout(coachID, seedPrefix+" Leg Day", legDay)
	if err != nil {
		return 0, err
	}

	lastTue := lastWeekday(today, time.Tuesday)
	lastFri := lastWeekday(today, time.Friday)
	for w := 0; w < weeks; w++ {
		back := (weeks - 1 - w) * 7
		if err := s.completedSession(coachID, armWorkout, armDay, w, lastTue.AddDate(0, 0, -back)); err != nil {
			return 0, err
		}
		if err := s.completedSession(coachID, legWorkout, legDay, w, lastFri.AddDate(0, 0, -back)); err != nil {
			return 0, err
		}
	}

	// Other Coach: training the athlete did under someone else.
	otherCurl := []exSpec{{"Cable Biceps Curl", "kg", [weeks]float64{22.5, 22.5, 22.5, 22.5, 22.5, 22.5, 22.5, 22.5}, [weeks][3]int{{12, 12, 11}, {}, {}, {}, {}, {}, {}, {}}, 12}}
	otherW1, err := s.workout(otherID, seedPrefix+" Other Coach Arm", otherCurl)
	if err != nil {
		return 0, err
	}
	if err := s.completedSession(otherID, otherW1, otherCurl, 0, today.AddDate(0, 0, -3)); err != nil {
		return 0, err
	}
	otherSquat := []exSpec{{"Back Squat", "kg", [weeks]float64{130, 130, 130, 130, 130, 130, 130, 130}, [weeks][3]int{{8, 8, 8}, {}, {}, {}, {}, {}, {}, {}}, 8}}
	otherW2, err := s.workout(otherID, seedPrefix+" Other Coach Legs", otherSquat)
	if err != nil {
		return 0, err
	}
	if err := s.completedSession(otherID, otherW2, otherSquat, 0, today.AddDate(0, 0, -17)); err != nil {
		return 0, err
	}

	// Not started, today: open it as the Athlete to see LAST / PR.
	if err := s.notStarted(coachID, armWorkout, armDay, today); err != nil {
		return 0, err
	}
	return s.sessions, nil
}

func (s *seeder) exerciseID(name string) (string, error) {
	if id, ok := s.exID[name]; ok {
		return id, nil
	}
	var id string
	err := s.tx.QueryRow(s.ctx, `SELECT id::text FROM exercises WHERE owner_coach_id IS NULL AND lower(name) = lower($1)`, name).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("system exercise %q not found: %w", name, err)
	}
	s.exID[name] = id
	return id, nil
}

func (s *seeder) workout(coachID, name string, specs []exSpec) (string, error) {
	wid := uuid.NewString()
	if _, err := s.tx.Exec(s.ctx, `INSERT INTO workouts (id, coach_id, name, created_at) VALUES ($1,$2,$3,now())`, wid, coachID, name); err != nil {
		return "", err
	}
	for i, sp := range specs {
		eid, err := s.exerciseID(sp.name)
		if err != nil {
			return "", err
		}
		if _, err := s.tx.Exec(s.ctx, `INSERT INTO workout_exercises (id, workout_id, exercise_id, target_sets, target_reps, target_rir, position, target_load, target_load_unit) VALUES ($1,$2,$3,3,$4,2,$5,$6,$7)`,
			uuid.NewString(), wid, eid, sp.plan, i+1, sp.loads[0], sp.unit); err != nil {
			return "", err
		}
	}
	return wid, nil
}

// scheduled inserts the ScheduledWorkout snapshot (exercises + frozen planned
// sets) and returns its id with the per-exercise snapshot ids and planned-set ids.
type snap struct {
	swID    string
	exIDs   []string
	planned [][]string
}

func (s *seeder) scheduled(coachID, workoutID string, specs []exSpec, w int, date time.Time) (snap, error) {
	out := snap{swID: uuid.NewString()}
	if _, err := s.tx.Exec(s.ctx, `INSERT INTO scheduled_workouts (id, workout_id, coach_id, athlete_id, scheduled_date, created_at) VALUES ($1,$2,$3,$4,$5,now())`,
		out.swID, workoutID, coachID, s.athleteID, date.Format("2006-01-02")); err != nil {
		return out, err
	}
	for i, sp := range specs {
		eid, err := s.exerciseID(sp.name)
		if err != nil {
			return out, err
		}
		sweID := uuid.NewString()
		if _, err := s.tx.Exec(s.ctx, `INSERT INTO scheduled_workout_exercises (id, scheduled_workout_id, exercise_id, exercise_name, target_sets, target_reps, target_rir, position, target_load_unit) VALUES ($1,$2,$3,$4,3,$5,2,$6,$7)`,
			sweID, out.swID, eid, sp.name, sp.plan, i+1, sp.unit); err != nil {
			return out, err
		}
		var ps []string
		for p := 1; p <= 3; p++ {
			pid := uuid.NewString()
			if _, err := s.tx.Exec(s.ctx, `INSERT INTO scheduled_workout_planned_sets (id, scheduled_workout_exercise_id, planned_position, target_reps, target_load, target_rir) VALUES ($1,$2,$3,$4,$5,2)`,
				pid, sweID, p, sp.plan, sp.loads[w]); err != nil {
				return out, err
			}
			ps = append(ps, pid)
		}
		out.exIDs = append(out.exIDs, sweID)
		out.planned = append(out.planned, ps)
	}
	return out, nil
}

func (s *seeder) completedSession(coachID, workoutID string, specs []exSpec, w int, date time.Time) error {
	sn, err := s.scheduled(coachID, workoutID, specs, w, date)
	if err != nil {
		return err
	}
	start := date.Add(18 * time.Hour)
	if _, err := s.tx.Exec(s.ctx, `INSERT INTO workout_sessions (id, scheduled_workout_id, athlete_id, status, started_at, completed_at) VALUES ($1,$2,$3,'COMPLETED',$4,$5)`,
		uuid.NewString(), sn.swID, s.athleteID, start, start.Add(55*time.Minute)); err != nil {
		return err
	}
	var sessionID string
	if err := s.tx.QueryRow(s.ctx, `SELECT id::text FROM workout_sessions WHERE scheduled_workout_id = $1`, sn.swID).Scan(&sessionID); err != nil {
		return err
	}
	for i, sp := range specs {
		for set := 0; set < 3; set++ {
			if _, err := s.tx.Exec(s.ctx, `INSERT INTO set_logs (id, session_id, scheduled_workout_exercise_id, scheduled_workout_planned_set_id, set_number, load, unit, reps, rir, logged_by_user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
				uuid.NewString(), sessionID, sn.exIDs[i], sn.planned[i][set], set+1, sp.loads[w], sp.unit, sp.reps[w][set], setRIR[set], s.athleteID,
				start.Add(time.Duration(i*15+set*4)*time.Minute)); err != nil {
				return err
			}
		}
	}
	s.sessions++
	return nil
}

func (s *seeder) notStarted(coachID, workoutID string, specs []exSpec, date time.Time) error {
	// Planned for the next step up: last week's loads, week index weeks-1.
	_, err := s.scheduled(coachID, workoutID, specs, weeks-1, date)
	return err
}
