// Package db manages the PostgreSQL connection pool lifecycle.
package db

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// NewPool creates a connection pool and verifies connectivity with an
// initial ping before returning. Callers should treat a returned error as
// fatal to startup: the API must not report itself as healthy without a
// verified database connection at boot.
func NewPool(ctx context.Context, databaseURL string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, fmt.Errorf("db: create pool: %w", err)
	}

	pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("db: initial ping failed: %w", err)
	}

	return pool, nil
}

// Ping checks whether the database is currently reachable. Used by the
// readiness endpoint; a failure here means "not ready", not "fatal".
func Ping(ctx context.Context, pool *pgxpool.Pool) error {
	pingCtx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	return pool.Ping(pingCtx)
}
