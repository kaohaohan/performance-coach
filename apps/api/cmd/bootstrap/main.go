// Command bootstrap creates the intentional pilot users and coach/athlete
// relationships described by a reviewed input manifest
// (docs/deployment-architecture-v0.2.md §10) and exits.
//
// It never creates or alters schema — that is migrate's job, run first and
// separately. In production it runs as a Cloud Run Job from the same
// immutable image as the api entrypoint, using this binary as its command.
// It never requires FIREBASE_PROJECT_ID: bootstrap does not authenticate
// users, it records approved Firebase UIDs supplied by the manifest.
package main

import (
	"context"
	"log/slog"
	"os"
	"time"

	"github.com/kaohaohan/performance-coach/apps/api/internal/bootstrap"
	"github.com/kaohaohan/performance-coach/apps/api/internal/config"
	"github.com/kaohaohan/performance-coach/apps/api/internal/db"
	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
)

func main() {
	// Built first, before config.LoadBootstrap(): a missing/invalid
	// environment variable is then reported as one structured ERROR line
	// like every other fact this job logs, instead of a plain-text
	// log.Fatal (docs/deployment-architecture-v0.2.md §12). This is a
	// short-lived job, not an HTTP server — no request ID, no
	// logging.Middleware; those are request-scoped concepts this
	// entrypoint has no requests for.
	logger := logging.New(os.Stdout)
	slog.SetDefault(logger)

	if err := run(logger); err != nil {
		logger.Error("fatal bootstrap error", "error", err.Error())
		os.Exit(1)
	}
}

func run(logger *slog.Logger) error {
	cfg, err := config.LoadBootstrap()
	if err != nil {
		return err
	}

	// Only cfg.ManifestPath (a filesystem path, not its content) is ever
	// logged. The manifest itself carries Firebase UIDs and names (§10);
	// nothing about it is echoed below, including in the success summary,
	// which reports counts only.
	manifest, err := bootstrap.LoadManifest(cfg.ManifestPath)
	if err != nil {
		return err
	}
	if len(manifest.Users) == 0 {
		return bootstrap.ErrEmptyManifest
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	pool, err := db.NewPool(ctx, cfg.DatabaseURL, db.MaintenanceMaxConns)
	if err != nil {
		return err
	}
	defer pool.Close()

	logger.Info("database connection verified")

	result, err := bootstrap.Apply(context.Background(), pool, manifest)
	if err != nil {
		return err
	}

	logger.Info("bootstrap complete",
		"users_upserted", result.UsersUpserted,
		"relationships_created", result.RelationshipsCreated,
	)
	return nil
}
