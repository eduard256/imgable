// Package auth provides rate limiting for login attempts.
package auth

import (
	"net/http"
	"sync"
	"time"

	"github.com/imgable/api/internal/response"
)

// RateLimiter provides per-IP rate limiting for login attempts.
// It uses a simple sliding window algorithm with cleanup.
type RateLimiter struct {
	mu       sync.Mutex
	attempts map[string][]time.Time
	limit    int           // max attempts
	window   time.Duration // time window
}

// NewRateLimiter creates a new rate limiter.
// limit is the maximum number of attempts allowed within the window duration.
func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	rl := &RateLimiter{
		attempts: make(map[string][]time.Time),
		limit:    limit,
		window:   window,
	}

	// Start cleanup goroutine
	go rl.cleanup()

	return rl
}

// Allow checks if the given IP is allowed to make a request.
// It returns true if allowed, false if rate limited.
func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()
	windowStart := now.Add(-rl.window)

	// Get existing attempts for this IP
	attempts := rl.attempts[ip]

	// Filter to only recent attempts
	recent := make([]time.Time, 0, len(attempts))
	for _, t := range attempts {
		if t.After(windowStart) {
			recent = append(recent, t)
		}
	}

	// Check if over limit
	if len(recent) >= rl.limit {
		rl.attempts[ip] = recent
		return false
	}

	// Record this attempt
	rl.attempts[ip] = append(recent, now)
	return true
}

// cleanup periodically removes old entries to prevent memory growth.
func (rl *RateLimiter) cleanup() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		rl.mu.Lock()
		windowStart := time.Now().Add(-rl.window)

		for ip, attempts := range rl.attempts {
			// Filter to recent attempts
			recent := make([]time.Time, 0, len(attempts))
			for _, t := range attempts {
				if t.After(windowStart) {
					recent = append(recent, t)
				}
			}

			if len(recent) == 0 {
				delete(rl.attempts, ip)
			} else {
				rl.attempts[ip] = recent
			}
		}
		rl.mu.Unlock()
	}
}

// Middleware returns HTTP middleware that enforces rate limiting.
// It extracts the client IP and checks against the rate limiter.
func (rl *RateLimiter) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := getClientIP(r)

		if !rl.Allow(ip) {
			response.TooManyRequests(w, "too many login attempts, try again later")
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getClientIP extracts client IP from request, checking proxy headers.
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header (may contain multiple IPs)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return xff[:i]
			}
		}
		return xff
	}

	// Check X-Real-IP header
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}

	// Fall back to RemoteAddr
	addr := r.RemoteAddr
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}
