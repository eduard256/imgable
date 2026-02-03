// Package server provides HTTP middleware for logging, recovery, and request handling.
package server

import (
	"context"
	"log/slog"
	"net/http"
	"runtime/debug"
	"time"

	"github.com/imgable/api/internal/response"
)

// responseWriter wraps http.ResponseWriter to capture status code.
type responseWriter struct {
	http.ResponseWriter
	status int
	size   int
}

func (rw *responseWriter) WriteHeader(status int) {
	rw.status = status
	rw.ResponseWriter.WriteHeader(status)
}

func (rw *responseWriter) Write(b []byte) (int, error) {
	n, err := rw.ResponseWriter.Write(b)
	rw.size += n
	return n, err
}

// Flush implements http.Flusher for SSE support.
func (rw *responseWriter) Flush() {
	if f, ok := rw.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Logger returns middleware that logs HTTP requests.
// It logs method, path, status, duration, and response size.
func Logger(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()

			// Wrap response writer to capture status
			wrapped := &responseWriter{ResponseWriter: w, status: http.StatusOK}

			// Process request
			next.ServeHTTP(wrapped, r)

			// Log request (skip health checks to reduce noise)
			if r.URL.Path != "/health" {
				duration := time.Since(start)
				logger.Info("request",
					slog.String("method", r.Method),
					slog.String("path", r.URL.Path),
					slog.Int("status", wrapped.status),
					slog.Duration("duration", duration),
					slog.Int("size", wrapped.size),
					slog.String("ip", getClientIP(r)),
				)
			}
		})
	}
}

// Recovery returns middleware that recovers from panics.
// It logs the panic and returns a 500 error to the client.
func Recovery(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if err := recover(); err != nil {
					logger.Error("panic recovered",
						slog.Any("error", err),
						slog.String("stack", string(debug.Stack())),
						slog.String("method", r.Method),
						slog.String("path", r.URL.Path),
					)
					response.InternalError(w)
				}
			}()
			next.ServeHTTP(w, r)
		})
	}
}

// RequestID returns middleware that adds a unique request ID to context.
type requestIDKey struct{}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Use X-Request-ID header if provided, otherwise generate
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = generateRequestID()
		}

		// Add to response header
		w.Header().Set("X-Request-ID", id)

		// Add to context
		ctx := context.WithValue(r.Context(), requestIDKey{}, id)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetRequestID returns request ID from context.
func GetRequestID(ctx context.Context) string {
	if id, ok := ctx.Value(requestIDKey{}).(string); ok {
		return id
	}
	return ""
}

// CORS returns middleware that handles CORS headers.
// For self-hosted single-origin setup, this is minimal.
func CORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow same-origin requests (default browser behavior)
		// No CORS headers needed for same-origin

		// Handle preflight requests
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

// getClientIP extracts client IP from request.
// It checks X-Forwarded-For and X-Real-IP headers first.
func getClientIP(r *http.Request) string {
	// Check X-Forwarded-For header (may contain multiple IPs)
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		// Take first IP (client IP)
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
	// Remove port if present
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}

// generateRequestID generates a simple unique ID for request tracing.
func generateRequestID() string {
	// Use timestamp + random suffix for simplicity
	// Format: timestamp in hex (8 chars) + random (4 chars)
	now := time.Now().UnixNano()
	return formatHex(uint64(now))[:12]
}

// formatHex formats uint64 as hex string.
func formatHex(n uint64) string {
	const digits = "0123456789abcdef"
	buf := make([]byte, 16)
	for i := 15; i >= 0; i-- {
		buf[i] = digits[n&0xf]
		n >>= 4
	}
	return string(buf)
}
