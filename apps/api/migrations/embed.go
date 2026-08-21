// Package migrations embeds the SQL files in this directory so the migrate
// entrypoint ships them inside the immutable API container image, instead
// of depending on a migrations directory mounted at runtime
// (docs/deployment-architecture-v0.2.md §9/§11: the migration job runs the
// same immutable image as the API).
package migrations

import "embed"

// FS holds every file in this directory, including .down.sql and
// verify_*.sql files that internal/migrate deliberately does not apply
// automatically. Filtering to the applied *.up.sql set is internal/migrate's
// job, not this package's.
//
//go:embed *.sql
var FS embed.FS
