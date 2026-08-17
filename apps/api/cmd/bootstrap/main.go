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
	"log"
	"time"

	"github.com/kaohaohan/performance-coach/apps/api/internal/bootstrap"
	"github.com/kaohaohan/performance-coach/apps/api/internal/config"
	"github.com/kaohaohan/performance-coach/apps/api/internal/db"
)

func main() {
	if err := run(); err != nil {
		log.Fatal(err)
	}
}

func run() error {
	cfg, err := config.LoadBootstrap()
	if err != nil {
		return err
	}

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

	log.Println("database connection verified")

	result, err := bootstrap.Apply(context.Background(), pool, manifest)
	if err != nil {
		return err
	}

	log.Printf("bootstrap complete: %d user(s) upserted, %d relationship(s) created", result.UsersUpserted, result.RelationshipsCreated)
	return nil
}
