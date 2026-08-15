// Command api is the Performance Coach Go API entrypoint.
//
// V0.1 scope: process lifecycle, a verified PostgreSQL connection pool, and
// /health + /ready endpoints. No domain routes yet.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/athlete"
	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/config"
	"github.com/kaohaohan/performance-coach/apps/api/internal/db"
	"github.com/kaohaohan/performance-coach/apps/api/internal/exercise"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	startupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.NewPool(startupCtx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	log.Println("database connection verified")

	verifier, err := authn.NewVerifier(startupCtx, cfg.FirebaseProjectID)
	if err != nil {
		return err
	}
	authMiddleware := authn.Middleware(verifier, pool)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /ready", handleReady(pool))
	mux.Handle("GET /api/v1/me", authMiddleware(http.HandlerFunc(handleMe)))
	mux.Handle("GET /api/v1/athletes", authMiddleware(handleAthletes(pool)))
	mux.Handle("GET /api/v1/exercises", authMiddleware(handleListExercises(pool)))
	mux.Handle("POST /api/v1/exercises", authMiddleware(handleCreateExercise(pool)))
	mux.Handle("POST /api/v1/workouts", authMiddleware(handleCreateWorkout(pool)))
	mux.Handle("GET /api/v1/workouts", authMiddleware(handleListWorkouts(pool)))
	mux.Handle("POST /api/v1/scheduled-workouts", authMiddleware(handleCreateScheduledWorkouts(pool)))
	mux.Handle("GET /api/v1/scheduled-workouts", authMiddleware(handleListScheduledWorkouts(pool)))
	mux.Handle("GET /api/v1/me/scheduled-workouts", authMiddleware(handleListMyScheduledWorkouts(pool)))
	mux.Handle("POST /api/v1/scheduled-workouts/{id}/session", authMiddleware(handleStartSession(pool)))
	mux.Handle("GET /api/v1/sessions/{sessionId}", authMiddleware(handleGetSession(pool)))
	mux.Handle("POST /api/v1/sessions/{sessionId}/complete", authMiddleware(handleCompleteSession(pool)))
	mux.Handle("POST /api/v1/sessions/{sessionId}/set-logs", authMiddleware(handleCreateSetLog(pool)))

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: mux,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		log.Printf("listening on :%s", cfg.Port)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		log.Println("shutdown signal received")

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer shutdownCancel()

		if err := srv.Shutdown(shutdownCtx); err != nil {
			return err
		}
	}

	return nil
}

// handleHealth reports process liveness only. It must not depend on
// PostgreSQL: a database outage should not make the process look dead.
func handleHealth(w http.ResponseWriter, r *http.Request) {
	writeStatus(w, http.StatusOK, "ok")
}

// handleReady reports whether the API can currently reach PostgreSQL.
func handleReady(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if err := db.Ping(r.Context(), pool); err != nil {
			writeStatus(w, http.StatusServiceUnavailable, "unavailable")
			return
		}
		writeStatus(w, http.StatusOK, "ok")
	}
}

// handleMe returns the caller's internal identity, resolved by authn.Middleware.
func handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := authn.UserFromContext(r.Context())
	if !ok {
		authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
		return
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string]string{
		"id":   user.ID,
		"name": user.Name,
		"role": user.Role,
	})
}

// handleAthletes returns the athletes connected to the caller, who must be
// a COACH. Authorization (role check) happens in athlete.ListForCoach, not
// here; this handler only decodes/encodes and picks the status code.
func handleAthletes(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		athletes, err := athlete.ListForCoach(r.Context(), pool, user)
		if err != nil {
			if errors.Is(err, athlete.ErrForbidden) {
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
				return
			}
			authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(athletes)
	}
}

// createExerciseRequest is the wire shape for POST /api/v1/exercises.
type createExerciseRequest struct {
	Name string `json:"name"`
}

// handleListExercises returns system Exercises plus the caller Coach's private
// Exercises. Authorization and query semantics belong to exercise.ListForCoach.
func handleListExercises(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		exercises, err := exercise.ListForCoach(r.Context(), pool, user, r.URL.Query().Get("q"))
		if err != nil {
			if errors.Is(err, exercise.ErrForbidden) {
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
				return
			}
			authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(exercises)
	}
}

// handleCreateExercise creates one private Exercise for the authenticated
// Coach. Validation, authorization, and duplicate semantics belong to the
// exercise service.
func handleCreateExercise(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		var req createExerciseRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "malformed JSON body")
			return
		}

		created, err := exercise.CreatePrivate(r.Context(), pool, user, req.Name)
		if err != nil {
			var validationErr *exercise.ValidationError
			var conflictErr *exercise.ConflictError
			switch {
			case errors.Is(err, exercise.ErrForbidden):
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
			case errors.As(err, &validationErr):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", validationErr.Error())
			case errors.As(err, &conflictErr):
				authn.WriteError(w, http.StatusConflict, "CONFLICT", conflictErr.Error())
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(created)
	}
}

// createWorkoutExerciseRequest is the wire shape for one exercise entry in
// a POST /api/v1/workouts request body
// (docs/go-backend-api-contract-v0.1.md §3.3).
type createWorkoutExerciseRequest struct {
	Name string                   `json:"name"`
	Plan createWorkoutPlanRequest `json:"plan"`
}

type createWorkoutPlanRequest struct {
	SetCount  int                            `json:"setCount"`
	Defaults  createWorkoutDefaultsRequest   `json:"defaults"`
	Overrides []createWorkoutOverrideRequest `json:"overrides"`
}

type createWorkoutDefaultsRequest struct {
	Reps             *int     `json:"reps"`
	PrescriptionNote *string  `json:"prescriptionNote"`
	Load             *float64 `json:"load"`
	Unit             *string  `json:"unit"`
	RPE              *float64 `json:"rpe"`
}

type createWorkoutOverrideRequest struct {
	Position         int      `json:"position"`
	Reps             *int     `json:"reps"`
	PrescriptionNote *string  `json:"prescriptionNote"`
	Load             *float64 `json:"load"`
	RPE              *float64 `json:"rpe"`
}

func mapWorkoutOverrides(overrides []createWorkoutOverrideRequest) []prescription.SetOverride {
	mapped := make([]prescription.SetOverride, len(overrides))
	for i, override := range overrides {
		mapped[i] = prescription.SetOverride{
			Position:         override.Position,
			Reps:             override.Reps,
			PrescriptionNote: override.PrescriptionNote,
			Load:             override.Load,
			RPE:              override.RPE,
		}
	}
	return mapped
}

// createWorkoutRequest is the wire shape for a POST /api/v1/workouts
// request body.
type createWorkoutRequest struct {
	Name      string                         `json:"name"`
	Exercises []createWorkoutExerciseRequest `json:"exercises"`
}

// handleCreateWorkout decodes the request body, delegates validation,
// authorization, and persistence to workout.Create, and maps its result to
// a status code. Coach only.
func handleCreateWorkout(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		var req createWorkoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "malformed JSON body")
			return
		}

		input := workout.CreateInput{
			Name:      req.Name,
			Exercises: make([]workout.CreateExerciseInput, len(req.Exercises)),
		}
		for i, ex := range req.Exercises {
			input.Exercises[i] = workout.CreateExerciseInput{
				Name: ex.Name,
				Plan: prescription.Plan{
					SetCount:  ex.Plan.SetCount,
					Defaults:  prescription.Defaults{Reps: ex.Plan.Defaults.Reps, PrescriptionNote: ex.Plan.Defaults.PrescriptionNote, Load: ex.Plan.Defaults.Load, Unit: ex.Plan.Defaults.Unit, RPE: ex.Plan.Defaults.RPE},
					Overrides: mapWorkoutOverrides(ex.Plan.Overrides),
				},
			}
		}

		created, err := workout.Create(r.Context(), pool, user, input)
		if err != nil {
			var validationErr *workout.ValidationError
			switch {
			case errors.Is(err, workout.ErrForbidden):
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
			case errors.As(err, &validationErr):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", validationErr.Error())
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(created)
	}
}

// handleListWorkouts returns the caller's own, non-archived workouts.
// Coach only.
func handleListWorkouts(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		workouts, err := workout.ListForCoach(r.Context(), pool, user)
		if err != nil {
			if errors.Is(err, workout.ErrForbidden) {
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
				return
			}
			authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(workouts)
	}
}

// createScheduledWorkoutRequest is the wire shape for a POST
// /api/v1/scheduled-workouts request body
// (docs/go-backend-api-contract-v0.1.md §3.5).
type createScheduledWorkoutRequest struct {
	WorkoutID     string   `json:"workoutId"`
	AthleteIDs    []string `json:"athleteIds"`
	ScheduledDate string   `json:"scheduledDate"`
}

// handleCreateScheduledWorkouts decodes the request body, delegates
// validation, authorization, and persistence to scheduledworkout.Create,
// and maps its result to a status code. Coach only: schedules one Workout
// to one or more connected Athletes on one date, atomically.
func handleCreateScheduledWorkouts(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		var req createScheduledWorkoutRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "malformed JSON body")
			return
		}

		input := scheduledworkout.CreateInput{
			WorkoutID:     req.WorkoutID,
			AthleteIDs:    req.AthleteIDs,
			ScheduledDate: req.ScheduledDate,
		}

		created, err := scheduledworkout.Create(r.Context(), pool, user, input)
		if err != nil {
			var validationErr *scheduledworkout.ValidationError
			switch {
			case errors.Is(err, scheduledworkout.ErrForbidden):
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
			case errors.As(err, &validationErr):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", validationErr.Error())
			case errors.Is(err, scheduledworkout.ErrWorkoutNotFound):
				authn.WriteError(w, http.StatusNotFound, "NOT_FOUND", "workout not found")
			case errors.Is(err, scheduledworkout.ErrAthletesNotConnected):
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "one or more athletes are not connected to caller")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(created)
	}
}

// handleListScheduledWorkouts returns the caller's ScheduledWorkouts in a
// required [from, to] date range, optionally filtered to one athlete.
// Coach only. Powers the Calendar frontend IA
// (docs/go-backend-api-contract-v0.1.md §3.5).
func handleListScheduledWorkouts(pool *pgxpool.Pool) http.HandlerFunc {
	const dateLayout = "2006-01-02"

	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		from, err := time.Parse(dateLayout, r.URL.Query().Get("from"))
		if err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "from is required and must be a valid date (YYYY-MM-DD)")
			return
		}
		to, err := time.Parse(dateLayout, r.URL.Query().Get("to"))
		if err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "to is required and must be a valid date (YYYY-MM-DD)")
			return
		}
		if to.Before(from) {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "to must not be before from")
			return
		}

		var athleteID *string
		if raw := r.URL.Query().Get("athleteId"); raw != "" {
			if _, err := uuid.Parse(raw); err != nil {
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "athleteId must be a valid UUID")
				return
			}
			athleteID = &raw
		}

		scheduled, err := scheduledworkout.ListForCoach(r.Context(), pool, user, from, to, athleteID)
		if err != nil {
			switch {
			case errors.Is(err, scheduledworkout.ErrForbidden):
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
			case errors.Is(err, scheduledworkout.ErrAthleteNotFound):
				authn.WriteError(w, http.StatusNotFound, "NOT_FOUND", "athlete not found")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(scheduled)
	}
}

// handleListMyScheduledWorkouts returns the caller's own ScheduledWorkouts
// on exactly one date, exercises expanded from the frozen prescription
// snapshot. Athlete only (docs/go-backend-api-contract-v0.1.md §3.6).
// Identity comes solely from the authenticated caller; no athleteId is ever
// accepted from the client.
func handleListMyScheduledWorkouts(pool *pgxpool.Pool) http.HandlerFunc {
	const dateLayout = "2006-01-02"

	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		date, err := time.Parse(dateLayout, r.URL.Query().Get("date"))
		if err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "date is required and must be a valid date (YYYY-MM-DD)")
			return
		}

		scheduled, err := scheduledworkout.ListForAthlete(r.Context(), pool, user, date)
		if err != nil {
			switch {
			case errors.Is(err, scheduledworkout.ErrForbidden):
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not an athlete")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(scheduled)
	}
}

// handleStartSession starts training for a ScheduledWorkout, or resumes its
// existing ACTIVE WorkoutSession (docs/go-backend-api-contract-v0.1.md
// §3.7). Allowed callers: the ScheduledWorkout's athlete, or a connected
// coach; any other caller (or a nonexistent id) gets 404, not 403 — this is
// a resource-scoping check, not a role check.
func handleStartSession(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		scheduledWorkoutID := r.PathValue("id")

		session, created, err := workoutsession.Start(r.Context(), pool, user, scheduledWorkoutID)
		if err != nil {
			var validationErr *workoutsession.ValidationError
			switch {
			case errors.As(err, &validationErr):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", validationErr.Error())
			case errors.Is(err, workoutsession.ErrNotFound):
				authn.WriteError(w, http.StatusNotFound, "NOT_FOUND", "scheduled workout not found")
			case errors.Is(err, workoutsession.ErrCompleted):
				authn.WriteError(w, http.StatusConflict, "CONFLICT", "session already completed")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		status := http.StatusOK
		if created {
			status = http.StatusCreated
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(status)
		_ = json.NewEncoder(w).Encode(session)
	}
}

// handleGetSession returns the plan-vs-actual detail for a WorkoutSession
// (docs/go-backend-api-contract-v0.1.md §3.7). Shared by Story 2 (live 1:1
// coaching) and Story 7 (coach review): both an athlete reading their own
// session and a connected coach get the same response, ACTIVE or
// COMPLETED. Any other caller (or a nonexistent id) gets 404, not 403 —
// resource-scoping, not a role check.
func handleGetSession(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		sessionID := r.PathValue("sessionId")

		detail, err := workoutsession.Get(r.Context(), pool, user, sessionID)
		if err != nil {
			var validationErr *workoutsession.ValidationError
			switch {
			case errors.As(err, &validationErr):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", validationErr.Error())
			case errors.Is(err, workoutsession.ErrNotFound):
				authn.WriteError(w, http.StatusNotFound, "NOT_FOUND", "session not found")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(detail)
	}
}

// handleCompleteSession transitions a WorkoutSession from ACTIVE to
// COMPLETED, making it permanently read-only (docs/
// go-backend-api-contract-v0.1.md §3.7). Authorization matches Start/Get:
// the session's athlete, or a connected coach; any other caller (or a
// nonexistent id) gets 404, not 403 — resource-scoping, not a role check.
func handleCompleteSession(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		sessionID := r.PathValue("sessionId")

		session, err := workoutsession.Complete(r.Context(), pool, user, sessionID)
		if err != nil {
			var validationErr *workoutsession.ValidationError
			switch {
			case errors.As(err, &validationErr):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", validationErr.Error())
			case errors.Is(err, workoutsession.ErrNotFound):
				authn.WriteError(w, http.StatusNotFound, "NOT_FOUND", "session not found")
			case errors.Is(err, workoutsession.ErrCompleted):
				authn.WriteError(w, http.StatusConflict, "CONFLICT", "session already completed")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(session)
	}
}

// createSetLogRequest is the wire shape for a POST
// /api/v1/sessions/{sessionId}/set-logs request body
// (docs/go-backend-api-contract-v0.1.md §3.8). Every optional field is a
// pointer so "omitted" is distinguishable from "explicit zero" — most
// importantly Load (0 is a valid load) and Reps (required, but nil means
// "never sent" rather than an invalid 0). id/setNumber/loggedByUserId/
// createdAt are deliberately absent: the server controls all of them, and
// any of those fields sent by the client are simply ignored by decoding
// into this struct.
type createSetLogRequest struct {
	ScheduledWorkoutExerciseID   string   `json:"scheduledWorkoutExerciseId"`
	Kind                         string   `json:"kind"`
	ScheduledWorkoutPlannedSetID *string  `json:"scheduledWorkoutPlannedSetId"`
	Load                         *float64 `json:"load"`
	Unit                         *string  `json:"unit"`
	Reps                         *int     `json:"reps"`
	RPE                          *float64 `json:"rpe"`
}

// handleCreateSetLog decodes the request body, delegates validation,
// authorization, and persistence to workoutsession.CreateSetLog, and maps
// its result to a status code. This is V0.1's sole SetLog write entry point
// (docs/go-backend-api-contract-v0.1.md §3.8) — the same path manual UI,
// voice, and future AI commands all converge on.
func handleCreateSetLog(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		sessionID := r.PathValue("sessionId")

		var req createSetLogRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "malformed JSON body")
			return
		}

		input := workoutsession.CreateSetLogInput{
			ScheduledWorkoutExerciseID:   req.ScheduledWorkoutExerciseID,
			Kind:                         req.Kind,
			ScheduledWorkoutPlannedSetID: req.ScheduledWorkoutPlannedSetID,
			Load:                         req.Load,
			Unit:                         req.Unit,
			Reps:                         req.Reps,
			RPE:                          req.RPE,
		}

		setLog, err := workoutsession.CreateSetLog(r.Context(), pool, user, sessionID, input)
		if err != nil {
			var validationErr *workoutsession.ValidationError
			switch {
			case errors.As(err, &validationErr):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", validationErr.Error())
			case errors.Is(err, workoutsession.ErrNotFound):
				authn.WriteError(w, http.StatusNotFound, "NOT_FOUND", "session not found")
			case errors.Is(err, workoutsession.ErrSessionNotActive):
				authn.WriteError(w, http.StatusConflict, "CONFLICT", "session is not active")
			case errors.Is(err, workoutsession.ErrExerciseNotInSession):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "scheduledWorkoutExerciseId does not belong to this session")
			case errors.Is(err, workoutsession.ErrPlannedSetNotInSession):
				authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "scheduledWorkoutPlannedSetId does not belong to this session exercise")
			case errors.Is(err, workoutsession.ErrPlannedSetAlreadyLogged):
				authn.WriteError(w, http.StatusConflict, "CONFLICT", "scheduled planned set already logged")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(setLog)
	}
}

func writeStatus(w http.ResponseWriter, code int, status string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
}
