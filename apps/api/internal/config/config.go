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
}

// Load reads configuration from environment variables.
//
// DATABASE_URL is required. PORT is optional and defaults to "8080".
func Load() (Config, error) {
	dbURL := os.Getenv("DATABASE_URL")
	if dbURL == "" {
		return Config{}, errors.New("config: DATABASE_URL is required")
	}

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	return Config{
		DatabaseURL: dbURL,
		Port:        port,
	}, nil
}
