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
	"strings"
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
	// Apple holds Sign in with Apple REST credentials used only for
	// account-deletion token exchange and revoke. All four fields must be
	// set together; if none are set, Apple-linked deletion cannot run.
	// Secrets must come from the environment and must never be logged.
	Apple AppleConfig
}

// AppleConfig is the Sign in with Apple REST API client configuration.
// PrivateKey is the contents of the .p8 key (PEM). Never log it.
type AppleConfig struct {
	TeamID     string
	KeyID      string
	ClientID   string
	PrivateKey string
}

// Enabled reports whether Apple revoke/exchange is configured.
func (c AppleConfig) Enabled() bool {
	return c.TeamID != "" && c.KeyID != "" && c.ClientID != "" && c.PrivateKey != ""
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

	apple, err := loadAppleConfig()
	if err != nil {
		return APIConfig{}, err
	}

	return APIConfig{
		DatabaseURL:       dbURL,
		Port:              port,
		FirebaseProjectID: firebaseProjectID,
		Apple:             apple,
	}, nil
}

func loadAppleConfig() (AppleConfig, error) {
	cfg := AppleConfig{
		TeamID:     strings.TrimSpace(os.Getenv("APPLE_TEAM_ID")),
		KeyID:      strings.TrimSpace(os.Getenv("APPLE_KEY_ID")),
		ClientID:   strings.TrimSpace(os.Getenv("APPLE_CLIENT_ID")),
		PrivateKey: strings.TrimSpace(os.Getenv("APPLE_PRIVATE_KEY")),
	}
	set := 0
	if cfg.TeamID != "" {
		set++
	}
	if cfg.KeyID != "" {
		set++
	}
	if cfg.ClientID != "" {
		set++
	}
	if cfg.PrivateKey != "" {
		set++
	}
	if set == 0 {
		return AppleConfig{}, nil
	}
	if set != 4 {
		return AppleConfig{}, errors.New("config: APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID, and APPLE_PRIVATE_KEY must all be set together")
	}
	return cfg, nil
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
