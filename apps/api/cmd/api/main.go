// Command api is the Performance Coach Go API entrypoint. It is one of
// three entrypoints built from this module (api, migrate, bootstrap;
// docs/deployment-architecture-v0.2.md §9) and is the only one that serves
// HTTP traffic or verifies Firebase ID tokens. It never runs schema
// migrations or bootstrap data creation itself.
package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
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
	"github.com/kaohaohan/performance-coach/apps/api/internal/invitecode"
	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
	"github.com/kaohaohan/performance-coach/apps/api/internal/migrate"
	"github.com/kaohaohan/performance-coach/apps/api/internal/prescription"
	"github.com/kaohaohan/performance-coach/apps/api/internal/scheduledworkout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workout"
	"github.com/kaohaohan/performance-coach/apps/api/internal/workoutsession"
)

func main() {
	// Built first, before config.LoadAPI(): a missing/invalid environment
	// variable is then reported as one structured ERROR line like every
	// other startup fact, instead of a plain-text log.Fatal.
	logger := logging.New(os.Stdout)
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal startup error", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.LoadAPI()
	if err != nil {
		return err
	}

	// Separate timeout budgets: DB connectivity and Firebase Admin SDK setup
	// are independent dependencies. On a Cloud Run cold start, a slow Cloud
	// SQL connector handshake must not starve Firebase's own budget (or vice
	// versa) by sharing one deadline between two unrelated sequential calls.
	dbCtx, dbCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer dbCancel()

	pool, err := db.NewPool(dbCtx, cfg.DatabaseURL, db.DefaultMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	// Best-effort: never fails startup (docs/deployment-architecture-v0.2.md
	// §12 "the migration ledger version if applicable"). See
	// migrate.LatestAppliedVersion's doc comment for what "best-effort"
	// covers — no ledger table yet is not an error, but a real query
	// failure is at least surfaced at WARNING rather than silently dropped.
	migrationVersion, migrationKnown, err := migrate.LatestAppliedVersion(dbCtx, pool)
	if err != nil {
		logger.Warn("could not determine migration ledger version", "error", err.Error())
	}

	bootFields := []any{
		"port", cfg.Port,
		"firebase_project_id", cfg.FirebaseProjectID,
		"db_ping", "ok",
	}
	if migrationKnown {
		bootFields = append(bootFields, "migration_version", migrationVersion)
	}
	logger.Info("api starting", bootFields...)

	firebaseCtx, firebaseCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer firebaseCancel()

	verifier, err := authn.NewVerifier(firebaseCtx, cfg.FirebaseProjectID)
	if err != nil {
		return err
	}
	authMiddleware := authn.Middleware(verifier, pool)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /ready", handleReady(pool))
	mux.Handle("GET /api/v1/me", authMiddleware(http.HandlerFunc(handleMe)))
	mux.Handle("GET /api/v1/athletes", authMiddleware(handleAthletes(pool)))
	mux.Handle("POST /api/v1/invite-codes", authMiddleware(handleCreateInviteCode(pool)))
	mux.Handle("GET /api/v1/invite-codes", authMiddleware(handleListInviteCodes(pool)))
	mux.Handle("POST /api/v1/invite-codes/{id}/revoke", authMiddleware(handleRevokeInviteCode(pool)))
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

	// requestTimeout bounds the worst case for a single request end to end,
	// including any in-flight database call. Without this, main.go had no
	// deadline of its own: a handler's r.Context() is canceled on client
	// disconnect or when the handler returns, not on a query simply taking
	// too long, so a slow query could otherwise hold a pooled connection
	// (and a Cloud Run concurrency slot) indefinitely
	// (docs/deployment-architecture-v0.2.md §7). http.TimeoutHandler cancels
	// the handler's context when it fires, so a database call using
	// r.Context() is canceled along with the response. Verify this bound
	// under D6 load rather than assuming it is generous enough.
	const requestTimeout = 10 * time.Second
	handler := http.TimeoutHandler(mux, requestTimeout, `{"error":{"code":"DEADLINE_EXCEEDED","message":"request timed out"}}`)

	// logging.Middleware must wrap outside TimeoutHandler, not inside the
	// mux it wraps: TimeoutHandler discards headers set by the inner
	// handler when it fires, but a header already set on the
	// ResponseWriter it was given survives both the timeout and the happy
	// path. Wrapping it here is what keeps X-Request-Id present on a
	// request that times out.
	handler = logging.Middleware(logger)(handler)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: handler,
		// Without this, a client that opens a connection and sends headers
		// slowly can hold it open indefinitely (slowloris). On Cloud Run
		// that connection also occupies one of the instance's Concurrency
		// slots, so an unbounded header read can crowd out real requests.
		ReadHeaderTimeout: 5 * time.Second,
		// ReadTimeout/WriteTimeout are a second, connection-level backstop
		// behind the per-request TimeoutHandler above: they bound the whole
		// request/response cycle at the transport level regardless of
		// handler behavior. Set comfortably above requestTimeout so the
		// handler-level timeout is normally what fires.
		ReadTimeout:  requestTimeout + 5*time.Second,
		WriteTimeout: requestTimeout + 5*time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	serveErr := make(chan error, 1)
	go func() {
		logger.Info("listening", "port", cfg.Port)
		serveErr <- srv.ListenAndServe()
	}()

	select {
	case err := <-serveErr:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		logger.Info("shutdown signal received")

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
			authn.WriteInternalError(w, r, err)
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(athletes)
	}
}

// createInviteCodeRequest is the wire shape for a POST /api/v1/invite-codes
// request body (docs/athlete-onboarding-invite-codes-v0.1.md §5.1). Both
// fields are optional: an omitted description means no description, and an
// omitted expiresInDays defaults to 30.
type createInviteCodeRequest struct {
	Description   *string `json:"description"`
	ExpiresInDays *int    `json:"expiresInDays"`
}

// handleCreateInviteCode creates one reusable invite code owned by the
// caller. Coach only.
func handleCreateInviteCode(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		var req createInviteCodeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			authn.WriteError(w, http.StatusBadRequest, "INVALID_ARGUMENT", "malformed JSON body")
			return
		}

		created, err := invitecode.Create(r.Context(), pool, user, invitecode.CreateInput{
			Description:   req.Description,
			ExpiresInDays: req.ExpiresInDays,
		})
		if err != nil {
			var validationErr *invitecode.ValidationError
			switch {
			case errors.Is(err, invitecode.ErrForbidden):
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

// handleListInviteCodes returns the caller's own invite codes, newest
// first, including expired and revoked ones. Coach only.
func handleListInviteCodes(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		codes, err := invitecode.ListForCoach(r.Context(), pool, user)
		if err != nil {
			if errors.Is(err, invitecode.ErrForbidden) {
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
				return
			}
			authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(codes)
	}
}

// handleRevokeInviteCode revokes one invite code owned by the caller.
// Revocation is forward-only and idempotent: re-revoking an already
// revoked code returns 200, not an error. An unknown id or another
// coach's id both produce 404 — one indistinguishable response, per
// docs/athlete-onboarding-invite-codes-v0.1.md §5.1. Coach only.
func handleRevokeInviteCode(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		user, ok := authn.UserFromContext(r.Context())
		if !ok {
			authn.WriteError(w, http.StatusUnauthorized, "UNAUTHENTICATED", "missing or invalid authentication")
			return
		}

		id := r.PathValue("id")

		revoked, err := invitecode.Revoke(r.Context(), pool, user, id)
		if err != nil {
			switch {
			case errors.Is(err, invitecode.ErrForbidden):
				authn.WriteError(w, http.StatusForbidden, "FORBIDDEN", "caller is not a coach")
			case errors.Is(err, invitecode.ErrNotFound):
				authn.WriteError(w, http.StatusNotFound, "NOT_FOUND", "invite code not found")
			default:
				authn.WriteError(w, http.StatusInternalServerError, "INTERNAL", "internal error")
			}
			return
		}

		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(revoked)
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
			authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
			authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
				authn.WriteInternalError(w, r, err)
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
