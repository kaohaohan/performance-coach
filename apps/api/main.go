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
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
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
	mux.Handle("POST /api/v1/workouts", authMiddleware(handleCreateWorkout(pool)))
	mux.Handle("GET /api/v1/workouts", authMiddleware(handleListWorkouts(pool)))
	mux.Handle("GET /api/v1/scheduled-workouts", authMiddleware(handleListScheduledWorkouts(pool)))

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

// createWorkoutExerciseRequest is the wire shape for one exercise entry in
// a POST /api/v1/workouts request body
// (docs/go-backend-api-contract-v0.1.md §3.3).
type createWorkoutExerciseRequest struct {
	Name                   string   `json:"name"`
	TargetSets             int      `json:"targetSets"`
	TargetReps             *int     `json:"targetReps"`
	TargetPrescriptionNote *string  `json:"targetPrescriptionNote"`
	TargetRPE              *float64 `json:"targetRpe"`
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
				Name:                   ex.Name,
				TargetSets:             ex.TargetSets,
				TargetReps:             ex.TargetReps,
				TargetPrescriptionNote: ex.TargetPrescriptionNote,
				TargetRPE:              ex.TargetRPE,
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

func writeStatus(w http.ResponseWriter, code int, status string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
}
