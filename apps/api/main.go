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

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/internal/config"
	"github.com/kaohaohan/performance-coach/apps/api/internal/db"
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

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", handleHealth)
	mux.HandleFunc("GET /ready", handleReady(pool))

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

func writeStatus(w http.ResponseWriter, code int, status string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"status": status})
}
