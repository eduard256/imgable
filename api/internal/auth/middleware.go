// Package auth provides authentication middleware for the Imgable API.
package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/imgable/api/internal/response"
)

// contextKey is a custom type for context keys to avoid collisions.
type contextKey string

const (
	// TokenContextKey is the context key for the validated token.
	TokenContextKey contextKey = "token"
)

// Middleware returns HTTP middleware that validates JWT tokens.
// It extracts the token from the Authorization header (Bearer scheme)
// or from the 'token' query parameter for file requests.
func Middleware(jwtAuth *JWTAuth) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractToken(r)
			if token == "" {
				response.Unauthorized(w, "missing token")
				return
			}

			claims, err := jwtAuth.ValidateToken(token)
			if err != nil {
				if err == ErrExpiredToken {
					response.Unauthorized(w, "token expired")
				} else {
					response.Unauthorized(w, "invalid token")
				}
				return
			}

			// Add token to context for later use (e.g., generating photo URLs)
			ctx := context.WithValue(r.Context(), TokenContextKey, token)
			ctx = context.WithValue(ctx, "claims", claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// extractToken extracts JWT token from request.
// Priority: Authorization header > query parameter 'token'
func extractToken(r *http.Request) string {
	// Check Authorization header first
	authHeader := r.Header.Get("Authorization")
	if authHeader != "" {
		// Expected format: "Bearer <token>"
		if strings.HasPrefix(authHeader, "Bearer ") {
			return strings.TrimPrefix(authHeader, "Bearer ")
		}
	}

	// Fall back to query parameter (for file URLs in <img src="">)
	return r.URL.Query().Get("token")
}

// GetToken returns the JWT token from context.
func GetToken(ctx context.Context) string {
	if token, ok := ctx.Value(TokenContextKey).(string); ok {
		return token
	}
	return ""
}

// GetClaims returns the JWT claims from context.
func GetClaims(ctx context.Context) *Claims {
	if claims, ok := ctx.Value("claims").(*Claims); ok {
		return claims
	}
	return nil
}
