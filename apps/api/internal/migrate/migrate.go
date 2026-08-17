// Package migrate applies the SQL files in apps/api/migrations against a
// PostgreSQL database in order, tracking what has already run in an
// applied-version/checksum ledger table (docs/deployment-architecture-v0.2.md
// §9). It never runs from API startup: this package is used only by the
// migrate entrypoint.
package migrate

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io/fs"
	"regexp"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/kaohaohan/performance-coach/apps/api/migrations"
)

// migrationFileNameRE picks out applied migration files: NNNN_name.up.sql.
// Sibling .down.sql and verify_*.sql files are intentionally excluded —
// down migrations are never run automatically (forward-only rollback
// posture, §9) and verify_*.sql files are manual review scripts, not part
// of the applied sequence.
var migrationFileNameRE = regexp.MustCompile(`^(\d{4}_[a-zA-Z0-9_]+)\.up\.sql$`)

// Migration is one loaded migration file, keyed by its version (the
// filename without the .up.sql suffix, e.g. "0001_init_schema").
type Migration struct {
	Version  string
	SQL      string
	Checksum string // sha256 hex of SQL, used to detect changed history.
}

// Load reads and orders every *.up.sql file embedded in apps/api/migrations.
// Ordering is by version string, which sorts correctly as long as the
// zero-padded numeric filename prefix convention holds.
func Load() ([]Migration, error) {
	entries, err := fs.ReadDir(migrations.FS, ".")
	if err != nil {
		return nil, fmt.Errorf("migrate: read migrations dir: %w", err)
	}

	var out []Migration
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		match := migrationFileNameRE.FindStringSubmatch(entry.Name())
		if match == nil {
			continue
		}
		content, err := fs.ReadFile(migrations.FS, entry.Name())
		if err != nil {
			return nil, fmt.Errorf("migrate: read %s: %w", entry.Name(), err)
		}
		sum := sha256.Sum256(content)
		out = append(out, Migration{
			Version:  match[1],
			SQL:      string(content),
			Checksum: hex.EncodeToString(sum[:]),
		})
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Version < out[j].Version })
	return out, nil
}

// ledgerDDL creates the applied-migration ledger if this is the first
// migration ever run against the target database.
const ledgerDDL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
	version text PRIMARY KEY,
	checksum text NOT NULL,
	applied_at timestamptz NOT NULL DEFAULT now()
);`

// Up applies every pending migration in ascending version order. Before
// applying anything, it refuses to proceed if any already-applied
// migration's on-disk content no longer matches the checksum recorded when
// it ran — historical migrations must never be edited; a schema change
// belongs in a new migration file (§9: "failure on changed historical
// migration content").
//
// onApply, if non-nil, is called with each version as it is successfully
// applied, so a caller can report progress without this package depending
// on a particular logger.
func Up(ctx context.Context, pool *pgxpool.Pool, onApply func(version string)) (applied []string, err error) {
	if _, err := pool.Exec(ctx, ledgerDDL); err != nil {
		return nil, fmt.Errorf("migrate: create ledger table: %w", err)
	}

	all, err := Load()
	if err != nil {
		return nil, err
	}

	ledger, err := readLedger(ctx, pool)
	if err != nil {
		return nil, err
	}

	for _, m := range all {
		recordedChecksum, alreadyApplied := ledger[m.Version]
		if alreadyApplied {
			if recordedChecksum != m.Checksum {
				return applied, fmt.Errorf(
					"migrate: %s content changed since it was applied (recorded checksum %s, on-disk checksum %s); historical migrations must never be edited — add a new migration instead",
					m.Version, recordedChecksum, m.Checksum,
				)
			}
			continue
		}

		if err := applyOne(ctx, pool, m); err != nil {
			return applied, fmt.Errorf("migrate: apply %s: %w", m.Version, err)
		}
		applied = append(applied, m.Version)
		if onApply != nil {
			onApply(m.Version)
		}
	}

	return applied, nil
}

func readLedger(ctx context.Context, pool *pgxpool.Pool) (map[string]string, error) {
	rows, err := pool.Query(ctx, `SELECT version, checksum FROM schema_migrations`)
	if err != nil {
		return nil, fmt.Errorf("migrate: read ledger: %w", err)
	}
	defer rows.Close()

	ledger := make(map[string]string)
	for rows.Next() {
		var version, checksum string
		if err := rows.Scan(&version, &checksum); err != nil {
			return nil, fmt.Errorf("migrate: scan ledger row: %w", err)
		}
		ledger[version] = checksum
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("migrate: read ledger: %w", err)
	}
	return ledger, nil
}

// selfTransactionalRE recognizes a migration file that already opens its
// own transaction (ignoring leading "--" comment lines), such as
// 0002_planned_set_prescription.up.sql, whose preflight/verification DO
// blocks must see the whole migration atomically.
var selfTransactionalRE = regexp.MustCompile(`(?is)^\s*(--[^\n]*\n\s*)*BEGIN\s*;`)

func isSelfTransactional(sql string) bool {
	return selfTransactionalRE.MatchString(sql)
}

// applyOne runs one migration file and records it in the ledger.
//
// PostgreSQL's simple query protocol implicitly wraps a multi-statement
// string in one transaction unless the string itself contains explicit
// BEGIN/COMMIT. For an ordinary migration file that means we can append the
// ledger INSERT to the script and wrap the whole thing in BEGIN...COMMIT
// ourselves, making the schema change and its ledger row atomic together.
// A self-transactional file has already committed by the time its own
// COMMIT runs, so its ledger row is recorded in a second statement instead
// — not atomic with the migration, but the migration itself is still an
// all-or-nothing unit.
func applyOne(ctx context.Context, pool *pgxpool.Pool, m Migration) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("acquire connection: %w", err)
	}
	defer conn.Release()

	ledgerInsert := fmt.Sprintf(
		"\nINSERT INTO schema_migrations (version, checksum) VALUES (%s, %s);\n",
		quoteLiteral(m.Version), quoteLiteral(m.Checksum),
	)

	selfTransactional := isSelfTransactional(m.SQL)

	script := m.SQL
	if !selfTransactional {
		script = "BEGIN;\n" + m.SQL + ledgerInsert + "COMMIT;\n"
	}

	if _, err := conn.Exec(ctx, script, pgx.QueryExecModeSimpleProtocol); err != nil {
		return err
	}

	if selfTransactional {
		if _, err := conn.Exec(ctx, ledgerInsert, pgx.QueryExecModeSimpleProtocol); err != nil {
			return fmt.Errorf("record ledger row after self-transactional migration: %w", err)
		}
	}

	return nil
}

// quoteLiteral escapes a Go string as a PostgreSQL string literal. Simple
// query protocol scripts cannot use bind parameters, so the ledger INSERT
// above must inline its values as literals. Both values here are always
// our own derived version/checksum strings, never external input, but this
// is escaped anyway for correctness against a version containing a quote.
func quoteLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}
