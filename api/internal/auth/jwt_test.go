package auth

import (
	"testing"
	"time"
)

func TestJWTAuth_GenerateAndValidate(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	expiry := time.Hour

	jwtAuth := NewJWTAuth(secret, expiry)

	// Generate token
	token, expiresAt, err := jwtAuth.GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	if token == "" {
		t.Error("GenerateToken() returned empty token")
	}

	if expiresAt.Before(time.Now()) {
		t.Error("GenerateToken() returned expired time")
	}

	// Validate token
	claims, err := jwtAuth.ValidateToken(token)
	if err != nil {
		t.Fatalf("ValidateToken() error = %v", err)
	}

	if claims.Issuer != "imgable" {
		t.Errorf("ValidateToken() issuer = %v, want imgable", claims.Issuer)
	}
}

func TestJWTAuth_ValidateToken_Invalid(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	jwtAuth := NewJWTAuth(secret, time.Hour)

	tests := []struct {
		name  string
		token string
		want  error
	}{
		{
			name:  "empty token",
			token: "",
			want:  ErrInvalidToken,
		},
		{
			name:  "malformed token",
			token: "not-a-valid-jwt",
			want:  ErrInvalidToken,
		},
		{
			name:  "wrong signature",
			token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJpbWdhYmxlIn0.wrong_signature",
			want:  ErrInvalidToken,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := jwtAuth.ValidateToken(tt.token)
			if err == nil {
				t.Error("ValidateToken() expected error, got nil")
			}
		})
	}
}

func TestJWTAuth_ValidateToken_Expired(t *testing.T) {
	secret := []byte("test-secret-key-32-bytes-long!!!")
	// Create with very short expiry
	jwtAuth := NewJWTAuth(secret, time.Millisecond)

	token, _, err := jwtAuth.GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	// Wait for token to expire
	time.Sleep(10 * time.Millisecond)

	_, err = jwtAuth.ValidateToken(token)
	if err != ErrExpiredToken {
		t.Errorf("ValidateToken() error = %v, want %v", err, ErrExpiredToken)
	}
}

func TestJWTAuth_DifferentSecrets(t *testing.T) {
	secret1 := []byte("first-secret-key-32-bytes-long!!")
	secret2 := []byte("second-secret-key-32bytes-long!!")

	jwtAuth1 := NewJWTAuth(secret1, time.Hour)
	jwtAuth2 := NewJWTAuth(secret2, time.Hour)

	// Generate token with first secret
	token, _, err := jwtAuth1.GenerateToken()
	if err != nil {
		t.Fatalf("GenerateToken() error = %v", err)
	}

	// Try to validate with different secret
	_, err = jwtAuth2.ValidateToken(token)
	if err != ErrInvalidToken {
		t.Errorf("ValidateToken() with wrong secret: error = %v, want %v", err, ErrInvalidToken)
	}
}
