// Package handlers provides HTTP request handlers for the Imgable API.
package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
)

// AuthHandler handles authentication endpoints.
type AuthHandler struct {
	config    *config.Config
	jwtAuth   *auth.JWTAuth
	rateLimit *auth.RateLimiter
	logger    *slog.Logger
}

// NewAuthHandler creates a new AuthHandler.
func NewAuthHandler(cfg *config.Config, jwtAuth *auth.JWTAuth, rateLimit *auth.RateLimiter, logger *slog.Logger) *AuthHandler {
	return &AuthHandler{
		config:    cfg,
		jwtAuth:   jwtAuth,
		rateLimit: rateLimit,
		logger:    logger,
	}
}

// LoginRequest represents a login request body.
type LoginRequest struct {
	Password string `json:"password"`
}

// LoginResponse represents a successful login response.
type LoginResponse struct {
	Token     string `json:"token"`
	ExpiresAt int64  `json:"expires_at"`
}

// Login handles POST /api/v1/login.
// It validates the password and returns a JWT token.
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	// Check rate limit
	ip := getClientIP(r)
	if !h.rateLimit.Allow(ip) {
		h.logger.Warn("login rate limited", slog.String("ip", ip))
		response.TooManyRequests(w, "too many login attempts, try again later")
		return
	}

	// Parse request
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	// Validate password
	if req.Password != h.config.Password {
		h.logger.Warn("invalid login attempt", slog.String("ip", ip))
		response.Unauthorized(w, "invalid password")
		return
	}

	// Generate token
	token, expiresAt, err := h.jwtAuth.GenerateToken()
	if err != nil {
		h.logger.Error("failed to generate token", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	h.logger.Info("successful login", slog.String("ip", ip))

	response.OK(w, LoginResponse{
		Token:     token,
		ExpiresAt: expiresAt.Unix(),
	})
}

// getClientIP extracts client IP from request.
func getClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		for i := 0; i < len(xff); i++ {
			if xff[i] == ',' {
				return xff[:i]
			}
		}
		return xff
	}
	if xri := r.Header.Get("X-Real-IP"); xri != "" {
		return xri
	}
	addr := r.RemoteAddr
	for i := len(addr) - 1; i >= 0; i-- {
		if addr[i] == ':' {
			return addr[:i]
		}
	}
	return addr
}
