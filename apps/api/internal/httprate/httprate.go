// Package httprate implements a minimal per-IP token-bucket rate limiter
// for the small number of publicly (or Firebase-only) reachable domain
// routes — preview and redeem
// (docs/athlete-onboarding-invite-codes-v0.1.md §5.6). It is a pilot-scale
// defense, not a general rate-limiting service: buckets are created
// lazily, kept in process memory, and never evicted, and the limit is
// per-instance, not shared across Cloud Run instances. That is an
// accepted, explicitly documented limitation for this phase, not an
// oversight — no Redis or external rate-limit service is introduced.
package httprate

import (
	"net"
	"net/http"
	"strings"
	"sync"

	"golang.org/x/time/rate"

	"github.com/kaohaohan/performance-coach/apps/api/internal/authn"
)

// Limiter is a per-IP token bucket.
type Limiter struct {
	mu       sync.Mutex
	visitors map[string]*rate.Limiter
	limit    rate.Limit
	burst    int
}

// New creates a Limiter allowing perMinute requests per minute per IP,
// with the given burst.
func New(perMinute float64, burst int) *Limiter {
	return &Limiter{
		visitors: make(map[string]*rate.Limiter),
		limit:    rate.Limit(perMinute / 60),
		burst:    burst,
	}
}

// allow reports whether the caller at ip may proceed right now, creating
// and caching a new bucket for ip on first use.
func (l *Limiter) allow(ip string) bool {
	l.mu.Lock()
	v, ok := l.visitors[ip]
	if !ok {
		v = rate.NewLimiter(l.limit, l.burst)
		l.visitors[ip] = v
	}
	l.mu.Unlock()
	return v.Allow()
}

// Middleware wraps next, rejecting requests over the per-IP limit with
// 429 RESOURCE_EXHAUSTED using the API's unified error envelope
// (authn.WriteError). Requests that pass the limit continue to next
// unmodified.
func (l *Limiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !l.allow(clientIP(r)) {
			authn.WriteError(w, http.StatusTooManyRequests, "RESOURCE_EXHAUSTED", "too many requests, try again shortly")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP extracts the caller's address, preferring the leftmost entry
// of X-Forwarded-For (the original client, by convention) since these
// routes are reached through apps/web's same-origin /backend rewrite,
// which forwards that header from Vercel's edge. It falls back to the raw
// connection's RemoteAddr for direct callers (e.g. local development
// against the Go API without the Next.js proxy in front of it).
func clientIP(r *http.Request) string {
	if forwarded := r.Header.Get("X-Forwarded-For"); forwarded != "" {
		first, _, _ := strings.Cut(forwarded, ",")
		if ip := strings.TrimSpace(first); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
