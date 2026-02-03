// Package auth provides JWT authentication for the Imgable API.
// It handles token generation, validation, and provides middleware for protected routes.
package auth

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

var (
	// ErrInvalidToken is returned when the token is malformed or has invalid signature.
	ErrInvalidToken = errors.New("invalid token")
	// ErrExpiredToken is returned when the token has expired.
	ErrExpiredToken = errors.New("token expired")
)

// Claims represents the JWT claims structure.
type Claims struct {
	jwt.RegisteredClaims
}

// JWTAuth handles JWT token operations.
type JWTAuth struct {
	secret []byte
	expiry time.Duration
}

// NewJWTAuth creates a new JWTAuth instance.
func NewJWTAuth(secret []byte, expiry time.Duration) *JWTAuth {
	return &JWTAuth{
		secret: secret,
		expiry: expiry,
	}
}

// GenerateToken creates a new JWT token.
// The token expires after the configured duration.
func (j *JWTAuth) GenerateToken() (string, time.Time, error) {
	expiresAt := time.Now().Add(j.expiry)

	claims := &Claims{
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "imgable",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(j.secret)
	if err != nil {
		return "", time.Time{}, err
	}

	return tokenString, expiresAt, nil
}

// ValidateToken validates a JWT token and returns the claims.
// It returns an error if the token is invalid or expired.
func (j *JWTAuth) ValidateToken(tokenString string) (*Claims, error) {
	token, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(token *jwt.Token) (interface{}, error) {
		// Validate signing method
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, ErrInvalidToken
		}
		return j.secret, nil
	})

	if err != nil {
		if errors.Is(err, jwt.ErrTokenExpired) {
			return nil, ErrExpiredToken
		}
		return nil, ErrInvalidToken
	}

	claims, ok := token.Claims.(*Claims)
	if !ok || !token.Valid {
		return nil, ErrInvalidToken
	}

	return claims, nil
}

// GetExpiry returns the configured token expiry duration.
func (j *JWTAuth) GetExpiry() time.Duration {
	return j.expiry
}
