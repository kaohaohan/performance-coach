// Package config loads runtime configuration from the process environment.
package config

import (
	"errors"
	"os"
)

// Config holds the environment-derived settings the API needs to start.
type Config struct {
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

// Load reads configuration from environment variables.
//
// DATABASE_URL and FIREBASE_PROJECT_ID are required. PORT is optional and
// defaults to "8080".
func Load() (Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return Config{}, errors.New("config: DATABASE_URL is required")
	}

	firebaseProjectID := os.Getenv("FIREBASE_PROJECT_ID")
	if firebaseProjectID == "" {
		return Config{}, errors.New("config: FIREBASE_PROJECT_ID is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return Config{
		DatabaseURL:       dbURL,
		Port:              port,
		FirebaseProjectID: firebaseProjectID,
	}, nil
}
