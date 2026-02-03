package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestMiddleware_ValidToken(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	jwtAuth := NewJWTAuth(secret, time.Hour)

	// Generate valid token
	token, _, err := jwtAuth.GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	// Create test handler that checks context
	var gotToken string
	handler := Middleware(jwtAuth)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = GetToken(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	// Test with Authorization header
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Middleware() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if gotToken != token {
		t.Errorf("GetToken() = %q, want %q", gotToken, token)
	}
}

func TestMiddleware_TokenInQuery(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	jwtAuth := NewJWTAuth(secret, time.Hour)

	token, _, _ := jwtAuth.GenerateToken()

	handler := Middleware(jwtAuth)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	// Test with token in query parameter
	req := httptest.NewRequest(http.MethodGet, "/test?token="+token, nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Middleware() with query token: status = %d, want %d", rec.Code, http.StatusOK)
	}
}

func TestMiddleware_MissingToken(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	jwtAuth := NewJWTAuth(secret, time.Hour)

	handler := Middleware(jwtAuth)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Middleware() without token: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestMiddleware_InvalidToken(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	jwtAuth := NewJWTAuth(secret, time.Hour)

	handler := Middleware(jwtAuth)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Middleware() with invalid token: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestMiddleware_ExpiredToken(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	jwtAuth := NewJWTAuth(secret, time.Millisecond)

	token, _, _ := jwtAuth.GenerateToken()
	time.Sleep(10 * time.Millisecond) // Wait for expiry

	handler := Middleware(jwtAuth)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("Middleware() with expired token: status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}

func TestMiddleware_HeaderPriority(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	jwtAuth := NewJWTAuth(secret, time.Hour)

	validToken, _, _ := jwtAuth.GenerateToken()

	var gotToken string
	handler := Middleware(jwtAuth)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotToken = GetToken(r.Context())
		w.WriteHeader(http.StatusOK)
	}))

	// Provide valid token in header and invalid in query
	req := httptest.NewRequest(http.MethodGet, "/test?token=invalid", nil)
	req.Header.Set("Authorization", "Bearer "+validToken)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Should use header token (valid) and succeed
	if rec.Code != http.StatusOK {
		t.Errorf("Middleware() header priority: status = %d, want %d", rec.Code, http.StatusOK)
	}
	if gotToken != validToken {
		t.Error("Middleware() did not prioritize header over query")
	}
}
