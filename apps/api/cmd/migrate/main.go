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
	"log"
	"time"

	"github.com/kaohaohan/performance-coach/apps/api/internal/config"
	"github.com/kaohaohan/performance-coach/apps/api/internal/db"
	"github.com/kaohaohan/performance-coach/apps/api/internal/migrate"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
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

	log.Println("database connection verified")

	// The job itself has no overall deadline beyond the Cloud Run Job's own
	// timeout: migrations run as long as they take, and are not subject to
	// the API's per-request timeout budget.
	applied, err := migrate.Up(context.Background(), pool, func(version string) {
		log.Printf("applied migration %s", version)
	})
	if err != nil {
		return err
	}

	if len(applied) == 0 {
		log.Println("no pending migrations")
		return nil
	}

	log.Printf("applied %d migration(s)", len(applied))
	return nil
}
