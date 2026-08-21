// Command migrate applies pending SQL migrations from apps/api/migrations
// against DATABASE_URL and exits (docs/deployment-architecture-v0.2.md §9).
//
// It is intentionally not run from API startup: concurrent Cloud Run
// instances must never race to mutate production schema. In production it
// runs as a Cloud Run Job, using the same immutable image as the api
// entrypoint but this binary as its command, with maximum retries set to 0
// and a separate least-privilege migration database credential. It never
// requires FIREBASE_PROJECT_ID.
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/kaohaohan/performance-coach/apps/api/internal/config"
	"github.com/kaohaohan/performance-coach/apps/api/internal/db"
	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
	"github.com/kaohaohan/performance-coach/apps/api/internal/migrate"
)

func main() {
	// Built first, before config.LoadMigrate(): a missing/invalid
	// environment variable is then reported as one structured ERROR line
	// like every other fact this job logs, instead of a plain-text
	// log.Fatal (docs/deployment-architecture-v0.2.md §12). This is a
	// short-lived job, not an HTTP server — no request ID, no
	// logging.Middleware; those are request-scoped concepts this
	// entrypoint has no requests for.
	logger := logging.New(os.Stdout)
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal migration error", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.LoadMigrate()
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL, db.MaintenanceMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	logger.Info("database connection verified")

	// The job itself has no overall deadline beyond the Cloud Run Job's own
	// timeout: migrations run as long as they take, and are not subject to
	// the API's per-request timeout budget.
	applied, err := migrate.Up(context.Background(), pool, func(version string) {
		// version is our own derived migration filename stem (e.g.
		// "0001_init_schema"), never external/user input — safe to log.
		logger.Info("applied migration", "version", version)
	})
	if err != nil {
		return err
	}

	if len(applied) == 0 {
		logger.Info("no pending migrations")
		return nil
	}

	logger.Info("migration run complete", "applied_count", len(applied))
	return nil
}
