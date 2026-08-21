package logging_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
)

// decodeLines parses one JSON object per line, per §12 "JSON to stdout, one
// object per line".
func decodeLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for _, raw := range strings.Split(strings.TrimSpace(buf.String()), "\n") {
		if raw == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err != nil {
			t.Fatalf("log line is not valid JSON: %v\nline: %s", err, raw)
		}
		lines = append(lines, m)
	}
	return lines
}

func TestMiddlewareLogsOneJSONLinePerRequestWithSeverityAndRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/workouts", nil))

	requestID := rec.Header().Get("X-Request-Id")
	if requestID == "" {
		t.Fatal("X-Request-Id response header was not set")
	}

	lines := decodeLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1: %v", len(lines), lines)
	}

	entry := lines[0]
	if entry["severity"] != "INFO" {
		t.Errorf("severity = %v, want INFO", entry["severity"])
	}
	if entry["request_id"] != requestID {
		t.Errorf("log request_id = %v, want it to match the X-Request-Id response header %q", entry["request_id"], requestID)
	}
	if entry["status"] != float64(http.StatusCreated) {
		t.Errorf("status = %v, want %d", entry["status"], http.StatusCreated)
	}
	if _, ok := entry["message"]; !ok {
		t.Error("entry has no \"message\" key")
	}
	if _, ok := entry["msg"]; ok {
		t.Error("entry has a raw \"msg\" key; want it remapped to \"message\"")
	}
	if _, ok := entry["level"]; ok {
		t.Error("entry has a raw \"level\" key; want it remapped to \"severity\"")
	}
}

// This is the §13 checklist line verbatim: "an error path is confirmed to
// surface as ERROR rather than INFO."
func TestMiddlewareLogsServerErrorAsERRORSeverity(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/me", nil))

	lines := decodeLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1", len(lines))
	}
	if lines[0]["severity"] != "ERROR" {
		t.Errorf("severity = %v, want ERROR", lines[0]["severity"])
	}
}

func TestMiddlewareLogsClientErrorAsWARNINGSeverity(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/api/v1/athletes", nil))

	lines := decodeLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines, want 1", len(lines))
	}
	if lines[0]["severity"] != "WARNING" {
		t.Errorf("severity = %v, want WARNING", lines[0]["severity"])
	}
}

// §12: "/health"/"/ready" are polled continuously by Cloud Run; a
// successful poll must not produce a log line.
func TestMiddlewareDoesNotLogSuccessfulProbes(t *testing.T) {
	for _, path := range []string{"/health", "/ready"} {
		t.Run(path, func(t *testing.T) {
			var buf bytes.Buffer
			logger := logging.New(&buf)

			handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))

			handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))

			if buf.Len() != 0 {
				t.Errorf("successful %s produced log output: %s", path, buf.String())
			}
		})
	}
}

// A failing readiness probe is a real incident signal and must still be
// observable, at ERROR severity.
func TestMiddlewareLogsFailingReadyProbe(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusServiceUnavailable)
	}))

	handler.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, "/ready", nil))

	lines := decodeLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines for a failing /ready, want 1", len(lines))
	}
	if lines[0]["severity"] != "ERROR" {
		t.Errorf("severity = %v, want ERROR", lines[0]["severity"])
	}
}

// Middleware always mints its own request ID; an inbound X-Request-Id must
// not be trusted (a caller can reach Cloud Run directly and forge one).
func TestMiddlewareIgnoresInboundRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/me", nil)
	req.Header.Set("X-Request-Id", "attacker-supplied-id")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if got := rec.Header().Get("X-Request-Id"); got == "attacker-supplied-id" {
		t.Fatal("Middleware echoed the inbound X-Request-Id instead of minting its own")
	}
}

// The JSON error envelope written by http.TimeoutHandler (the D1b request
// deadline) must remain byte-for-byte the API contract's shape, and
// X-Request-Id must still be present on that path: Middleware must wrap
// outside TimeoutHandler, not inside it.
func TestMiddlewareSurvivesTimeoutHandlerAndPreservesRequestID(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	const timeoutBody = `{"error":{"code":"DEADLINE_EXCEEDED","message":"request timed out"}}`
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-r.Context().Done():
		case <-time.After(time.Second):
		}
	})
	timeoutHandler := http.TimeoutHandler(slow, 10*time.Millisecond, timeoutBody)
	handler := logging.Middleware(logger)(timeoutHandler)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/api/v1/workouts", nil))

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
	if got := strings.TrimSpace(rec.Body.String()); got != timeoutBody {
		t.Fatalf("body = %q, want unchanged contract envelope %q", got, timeoutBody)
	}
	if rec.Header().Get("X-Request-Id") == "" {
		t.Error("X-Request-Id missing on the timeout path")
	}

	lines := decodeLines(t, &buf)
	if len(lines) != 1 {
		t.Fatalf("got %d log lines for a timed-out request, want 1", len(lines))
	}
	if lines[0]["severity"] != "ERROR" {
		t.Errorf("severity = %v, want ERROR (503)", lines[0]["severity"])
	}
}
