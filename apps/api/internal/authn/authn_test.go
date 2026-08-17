package authn_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
	"github.com/kaohaohan/performance-coach/apps/api/internal/logging"
)

// decodeLines parses one JSON object per stdout line, matching
// internal/logging's format (docs/deployment-architecture-v0.2.md §12).
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

// This is the core of D1c-2: before it, every internal-error branch called
// WriteError(..., 500, "INTERNAL", "internal error") directly and
// discarded the real error, so a production 500 produced zero log output.
// WriteInternalError must log the real error, correlated by request_id
// with the request's own summary log line, while leaving the client-facing
// JSON envelope exactly as the API contract already specifies.
func TestWriteInternalErrorLogsCorrelatedWithRequestIDAndPreservesEnvelope(t *testing.T) {
	var buf bytes.Buffer
	logger := logging.New(&buf)

	underlying := errors.New("pool.QueryRow: connection reset by peer")
	handler := logging.Middleware(logger)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authn.WriteInternalError(w, r, underlying)
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/api/v1/athletes", nil))

	requestID := rec.Header().Get("X-Request-Id")
	if requestID == "" {
		t.Fatal("X-Request-Id response header was not set")
	}

	// The JSON error envelope is a fixed API contract
	// (docs/go-backend-api-contract-v0.1.md): the underlying error must
	// never appear in the response body.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not valid JSON: %v", err)
	}
	wantBody := map[string]any{"error": map[string]any{"code": "INTERNAL", "message": "internal error"}}
	gotJSON, _ := json.Marshal(body)
	wantJSON, _ := json.Marshal(wantBody)
	if string(gotJSON) != string(wantJSON) {
		t.Fatalf("response body = %s, want %s (envelope must not change)", gotJSON, wantJSON)
	}
	if strings.Contains(rec.Body.String(), underlying.Error()) {
		t.Fatal("response body leaked the internal error text")
	}
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusInternalServerError)
	}

	// Exactly one line should carry the underlying error (from
	// WriteInternalError itself); logging.Middleware also emits its own
	// per-request summary line for the same request. Both must carry the
	// same request_id as the X-Request-Id response header, which is what
	// makes "locate this exact request in Cloud Logging" (§13) possible.
	lines := decodeLines(t, &buf)
	var errorLine map[string]any
	for _, line := range lines {
		if line["message"] == "internal error" {
			errorLine = line
		}
		if line["request_id"] != requestID {
			t.Errorf("log line request_id = %v, want %q (must match X-Request-Id): %v", line["request_id"], requestID, line)
		}
	}
	if errorLine == nil {
		t.Fatalf("no log line with message \"internal error\" found: %v", lines)
	}
	if errorLine["severity"] != "ERROR" {
		t.Errorf("internal error log severity = %v, want ERROR", errorLine["severity"])
	}
	if errorLine["error"] != underlying.Error() {
		t.Errorf("internal error log error field = %v, want %q", errorLine["error"], underlying.Error())
	}
}
