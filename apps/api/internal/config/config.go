// Package config loads runtime configuration from the process environment.
//
// Each Cloud Run entrypoint (api, migrate, bootstrap) has a distinct
// configuration surface: the migration job never authenticates a user and
// must not require FIREBASE_PROJECT_ID, and the bootstrap job additionally
// needs a manifest reference (docs/deployment-architecture-v0.2.md §9
// "Per-entrypoint configuration"). A single "everything is required" loader
// shared by all three would fail the migration job on a variable it does
// not use, and would encourage granting credentials to jobs that have no
// business holding them. Load{API,Migrate,Bootstrap} therefore each
// validate only what their entrypoint actually needs.
package config

import (
	"errors"
	"os"
)

// APIConfig holds the environment-derived settings the api entrypoint
// needs to start.
type APIConfig struct {
	// DatabaseURL is a PostgreSQL connection string, e.g.
	// postgres://user:pass@host:port/dbname?sslmode=disable
	DatabaseURL string
	// Port is the TCP port the HTTP server listens on.
	Port string
	// FirebaseProjectID is the Firebase project used to verify ID tokens.
	// In local development this points at a non-production project id and
	// FIREBASE_AUTH_EMULATOR_HOST (read directly by the Firebase Admin SDK)
	// redirects verification to the local Auth Emulator instead of
	// production Firebase.
	FirebaseProjectID string
}

// LoadAPI reads api entrypoint configuration from environment variables.
//
// DATABASE_URL and FIREBASE_PROJECT_ID are required. PORT is optional and
// defaults to "8080".
func LoadAPI() (APIConfig, error) {
	dbURL, err := requireDatabaseURL()
	if err != nil {
		return APIConfig{}, err
	}

	firebaseProjectID := os.Getenv("FIREBASE_PROJECT_ID")
	if firebaseProjectID == "" {
		return APIConfig{}, errors.New("config: FIREBASE_PROJECT_ID is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return APIConfig{
		DatabaseURL:       dbURL,
		Port:              port,
		FirebaseProjectID: firebaseProjectID,
	}, nil
}

// MigrateConfig holds the environment-derived settings the migrate
// entrypoint needs. It deliberately does not include FIREBASE_PROJECT_ID:
// the migration job never verifies a user token (§9).
type MigrateConfig struct {
	DatabaseURL string
}

// LoadMigrate reads migrate entrypoint configuration from environment
// variables. Only DATABASE_URL is required.
func LoadMigrate() (MigrateConfig, error) {
	dbURL, err := requireDatabaseURL()
	if err != nil {
		return MigrateConfig{}, err
	}
	return MigrateConfig{DatabaseURL: dbURL}, nil
}

// BootstrapConfig holds the environment-derived settings the bootstrap
// entrypoint needs: a database connection and a reviewed, non-secret input
// manifest reference (docs/deployment-architecture-v0.2.md §10). Like
// migrate, it does not include FIREBASE_PROJECT_ID.
type BootstrapConfig struct {
	DatabaseURL  string
	ManifestPath string
}

// LoadBootstrap reads bootstrap entrypoint configuration from environment
// variables. DATABASE_URL and BOOTSTRAP_MANIFEST_PATH are both required.
func LoadBootstrap() (BootstrapConfig, error) {
	dbURL, err := requireDatabaseURL()
	if err != nil {
		return BootstrapConfig{}, err
	}

	manifestPath := os.Getenv("BOOTSTRAP_MANIFEST_PATH")
	if manifestPath == "" {
		return BootstrapConfig{}, errors.New("config: BOOTSTRAP_MANIFEST_PATH is required")
	}

	return BootstrapConfig{DatabaseURL: dbURL, ManifestPath: manifestPath}, nil
}

// requireDatabaseURL is the one piece of configuration every
// database-touching entrypoint shares.
func requireDatabaseURL() (string, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return "", errors.New("config: DATABASE_URL is required")
	}
	return dbURL, nil
}
