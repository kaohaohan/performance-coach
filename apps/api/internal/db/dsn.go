package db

import (
	"fmt"
	"net/url"
	"strings"
)

// AssertSafeSSLMode refuses a DSN that disables TLS while pointed at a
// network host that is neither a Cloud SQL Unix socket path nor a loopback
// address (docs/deployment-architecture-v0.2.md §7).
//
// sslmode=disable is safe on the `/cloudsql/...` Unix socket path, where
// the transport never leaves the container and the Cloud SQL connector
// supplies encryption, and against a local loopback PostgreSQL, where there
// is no network between the API process and the database to protect. It is
// dangerous exactly when a DSN targets a public TCP host: that would send
// credentials and data in plaintext. This check is therefore host-based,
// not a blanket ban on sslmode=disable — it rejects a leaked production DSN
// pointed at a public host without breaking local development or the Cloud
// SQL connector path.
//
// This assumes the URL-style DSN this repo uses everywhere
// (postgres://user:pass@host:port/db?...), including the Cloud SQL
// convention of putting a Unix socket directory in a "host" query
// parameter when the authority host is empty.
func AssertSafeSSLMode(databaseURL string) error {
	host, sslModeDisabled, err := parseHostAndSSLMode(databaseURL)
	if err != nil {
		return fmt.Errorf("db: parse DATABASE_URL: %w", err)
	}
	if !sslModeDisabled {
		return nil
	}
	if isCloudSQLSocket(host) || isLoopback(host) {
		return nil
	}
	return fmt.Errorf("db: refusing to start: sslmode=disable is set with a non-local database host %q; use a /cloudsql/ socket path, a loopback host, or a non-disable sslmode", host)
}

func parseHostAndSSLMode(databaseURL string) (host string, sslModeDisabled bool, err error) {
	u, err := url.Parse(databaseURL)
	if err != nil {
		return "", false, err
	}

	query := u.Query()

	// The Cloud SQL / libpq convention for a Unix socket DSN puts the
	// socket directory in the "host" query parameter; the URL authority's
	// host is empty in that form, e.g.
	// postgres://user:pass@/dbname?host=/cloudsql/PROJECT:REGION:INSTANCE.
	host = query.Get("host")
	if host == "" {
		host = u.Hostname()
	}

	sslMode := strings.ToLower(query.Get("sslmode"))
	return host, sslMode == "disable", nil
}

func isCloudSQLSocket(host string) bool {
	return strings.HasPrefix(host, "/cloudsql/")
}

func isLoopback(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}
