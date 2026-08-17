// Package db manages the PostgreSQL connection pool lifecycle.
package db

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrInvalidDatabaseConfig is returned when DATABASE_URL parses as a URL
// (so AssertSafeSSLMode lets it through) but pgxpool.ParseConfig still
// rejects it. See the comment at NewPool's call to pgxpool.ParseConfig for
// why its message is deliberately generic.
var ErrInvalidDatabaseConfig = errors.New("db: DATABASE_URL was rejected while building the connection pool config (its content is not included here: some pgx parse failures embed the raw DSN, credentials included, unredacted)")

// Pool-wide connection budget, pinned explicitly rather than left to
// pgxpool's library defaults (docs/deployment-architecture-v0.2.md §7
// "Connection budget"). pgxpool.New without an explicit Config already
// applies pgx's own defaults for these three settings, so this is not
// "add eviction that doesn't exist" — it is pinning values that have
// actually been checked against Cloud SQL's idle-connection behavior
// (verify under D6 load) instead of running on whatever the library
// ships next.
const (
	// DefaultMaxConns is the per-instance connection cap for the API
	// entrypoint. With Cloud Run maximum instances of 3, this targets a
	// pooled-connection budget of at most 12 from the API, plus one
	// separately run migration/bootstrap job.
	DefaultMaxConns int32 = 4

	// MaintenanceMaxConns is the connection cap for the migrate and
	// bootstrap entrypoints, which run as a single short-lived task and
	// do not need the API's per-instance budget.
	MaintenanceMaxConns int32 = 2

	// maxConnIdleTime and maxConnLifetime bound how long a pooled
	// connection may sit idle or live in total. Pinned explicitly so
	// production behavior is a verified choice, not an assumption about
	// what Cloud SQL tolerates.
	maxConnIdleTime = 5 * time.Minute
	maxConnLifetime = 30 * time.Minute
)

// NewPool creates a connection pool with an explicit, bounded configuration
// and verifies connectivity with an initial ping before returning. Callers
// should treat a returned error as fatal to startup: the API must not
// report itself as healthy without a verified database connection at boot.
//
// maxConns should be db.DefaultMaxConns for the API entrypoint or
// db.MaintenanceMaxConns for the migrate/bootstrap entrypoints.
func NewPool(ctx context.Context, databaseURL string, maxConns int32) (*pgxpool.Pool, error) {
	if err := AssertSafeSSLMode(databaseURL); err != nil {
		return nil, err
	}

	// pgxpool.ParseConfig's error is not safe to propagate verbatim. It
	// redacts the password when it can identify one — a recognized
	// postgres:// URL with, say, an invalid sslmode value — but a string
	// that reaches its libpq keyword/value fallback parser and fails to
	// tokenize at all is embedded in the error raw, credentials included
	// (verified in dsn_test.go/TestNewPoolRejectsUnparsablePoolConfigWithoutLeaking:
	// AssertSafeSSLMode's net/url.Parse is lenient enough to accept
	// strings that are not valid postgres DSNs at all, so this path is
	// reachable even after that check passes). Since callers of NewPool
	// cannot tell which case they got from the error alone, neither is
	// ever propagated — same reasoning as AssertSafeSSLMode/ErrUnparsableDSN.
	poolConfig, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, ErrInvalidDatabaseConfig
	}
	poolConfig.MaxConns = maxConns
	poolConfig.MaxConnIdleTime = maxConnIdleTime
	poolConfig.MaxConnLifetime = maxConnLifetime

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
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
