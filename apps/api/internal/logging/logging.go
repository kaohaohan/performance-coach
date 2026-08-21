// Package logging implements the API's structured logging floor
// (docs/deployment-architecture-v0.2.md §12): JSON to stdout with a Cloud
// Logging-compatible severity, a request ID attached to every
// request-scoped log line and echoed via the X-Request-Id response header,
// and a summary line per request.
//
// This is deliberately a floor, not an observability strategy — no
// distributed tracing, no sampling, no logger interface abstraction (§17
// deferred items; AGENTS.md §22).
package logging

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
)

// New returns a JSON slog.Logger writing to w, with keys remapped to what
// Cloud Logging expects: "severity" using Cloud Logging's severity names
// (DEBUG/INFO/WARNING/ERROR — slog's own name for the third one is "WARN",
// which Cloud Logging does not recognize) instead of slog's default
// "level", and "message" instead of "msg". slog's default "time" key is
// already what Cloud Logging expects and is left alone.
func New(w io.Writer) *slog.Logger {
	handler := slog.NewJSONHandler(w, &slog.HandlerOptions{
		ReplaceAttr: replaceAttr,
	})
	return slog.New(handler)
}

func replaceAttr(_ []string, a slog.Attr) slog.Attr {
	switch a.Key {
	case slog.LevelKey:
		level, _ := a.Value.Any().(slog.Level)
		a.Key = "severity"
		a.Value = slog.StringValue(severityName(level))
	case slog.MessageKey:
		a.Key = "message"
	}
	return a
}

func severityName(level slog.Level) string {
	switch {
	case level < slog.LevelInfo:
		return "DEBUG"
	case level < slog.LevelWarn:
		return "INFO"
	case level < slog.LevelError:
		return "WARNING"
	default:
		return "ERROR"
	}
}

type contextKey int

const loggerContextKey contextKey = iota

// FromContext returns the request-scoped logger Middleware attached to ctx.
// Outside a request handled by Middleware (a test, a background job, code
// that runs before the middleware chain), it falls back to slog.Default(),
// which cmd/api sets to the same JSON logger at boot.
func FromContext(ctx context.Context) *slog.Logger {
	if l, ok := ctx.Value(loggerContextKey).(*slog.Logger); ok {
		return l
	}
	return slog.Default()
}

// probePaths are polled continuously by the Cloud Run health/readiness
// checker. Logging every successful poll would drown real request signal
// in noise (and add log-ingestion cost) without adding debugging value; a
// failing probe is a real incident signal and is still logged, since it
// falls out of the normal >=400 status-class rule below.
func isProbePath(path string) bool {
	return path == "/health" || path == "/ready"
}

// Middleware must wrap the outermost handler — specifically outside
// http.TimeoutHandler (docs/deployment-architecture-v0.2.md §7), not
// inside the mux it wraps. http.TimeoutHandler discards headers set by the
// inner handler when it fires, but headers already set on the
// ResponseWriter it was given survive both the timeout and the happy path.
// Setting X-Request-Id here, before delegating to next, is what makes it
// survive a request that times out.
func Middleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Always mint our own ID; an inbound X-Request-Id is not
			// trusted (a caller reaching Cloud Run directly, bypassing
			// Vercel, could forge one — docs/deployment-architecture-v0.2.md
			// §5 "the security boundary is the Go API, not Vercel").
			requestID := uuid.NewString()
			w.Header().Set("X-Request-Id", requestID)

			reqLogger := logger.With("request_id", requestID)
			ctx := context.WithValue(r.Context(), loggerContextKey, reqLogger)

			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
			start := time.Now()
			next.ServeHTTP(rec, r.WithContext(ctx))
			duration := time.Since(start)

			if isProbePath(r.URL.Path) && rec.status < http.StatusBadRequest {
				return
			}

			attrs := []any{
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", duration.Milliseconds(),
			}
			switch {
			case rec.status >= http.StatusInternalServerError:
				reqLogger.Error("request", attrs...)
			case rec.status >= http.StatusBadRequest:
				reqLogger.Warn("request", attrs...)
			default:
				reqLogger.Info("request", attrs...)
			}
		})
	}
}

// statusRecorder captures the status code a handler writes, since
// http.ResponseWriter does not expose it after the fact. A handler that
// calls Write without ever calling WriteHeader gets an implicit 200 (the
// zero-value default set at construction), matching net/http's own
// behavior for that case.
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}
