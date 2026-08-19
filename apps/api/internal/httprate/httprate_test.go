package httprate_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/kaohaohan/performance-coach/apps/api/internal/httprate"
)

func newHandler(calls *int) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		*calls++
		w.WriteHeader(http.StatusOK)
	})
}

func TestLimiterAllowsUpToBurstThenRejects(t *testing.T) {
	calls := 0
	limiter := httprate.New(60, 3) // 1/sec steady rate, burst 3
	handler := limiter.Middleware(newHandler(&calls))

	for i := 0; i < 3; i++ {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = "203.0.113.10:5555"
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if rec.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d, want %d (within burst)", i+1, rec.Code, http.StatusOK)
		}
	}

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "203.0.113.10:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("4th request status = %d, want %d (burst exhausted)", rec.Code, http.StatusTooManyRequests)
	}
	if calls != 3 {
		t.Fatalf("handler called %d times, want 3 (the 4th must be rejected before reaching it)", calls)
	}
}

func TestLimiterTracksBucketsPerIPIndependently(t *testing.T) {
	calls := 0
	limiter := httprate.New(60, 1) // burst 1, so a 2nd request from the same IP is immediately rejected
	handler := limiter.Middleware(newHandler(&calls))

	first := httptest.NewRequest(http.MethodGet, "/", nil)
	first.RemoteAddr = "198.51.100.1:1111"
	rec1 := httptest.NewRecorder()
	handler.ServeHTTP(rec1, first)
	if rec1.Code != http.StatusOK {
		t.Fatalf("first IP's first request status = %d, want %d", rec1.Code, http.StatusOK)
	}

	second := httptest.NewRequest(http.MethodGet, "/", nil)
	second.RemoteAddr = "198.51.100.2:2222"
	rec2 := httptest.NewRecorder()
	handler.ServeHTTP(rec2, second)
	if rec2.Code != http.StatusOK {
		t.Fatalf("different IP's first request status = %d, want %d (must not share the first IP's bucket)", rec2.Code, http.StatusOK)
	}
}

func TestLimiterPrefersLeftmostForwardedForOverRemoteAddr(t *testing.T) {
	calls := 0
	limiter := httprate.New(60, 1)
	handler := limiter.Middleware(newHandler(&calls))

	// Same X-Forwarded-For client IP behind two different proxy hops
	// (different RemoteAddr) must share one bucket.
	for _, remoteAddr := range []string{"10.0.0.1:1", "10.0.0.2:2"} {
		req := httptest.NewRequest(http.MethodGet, "/", nil)
		req.RemoteAddr = remoteAddr
		req.Header.Set("X-Forwarded-For", "203.0.113.99, 10.0.0.1")
		rec := httptest.NewRecorder()
		handler.ServeHTTP(rec, req)
		if remoteAddr == "10.0.0.1:1" && rec.Code != http.StatusOK {
			t.Fatalf("first request status = %d, want %d", rec.Code, http.StatusOK)
		}
		if remoteAddr == "10.0.0.2:2" && rec.Code != http.StatusTooManyRequests {
			t.Fatalf("second request (same X-Forwarded-For client, different RemoteAddr) status = %d, want %d", rec.Code, http.StatusTooManyRequests)
		}
	}
}
