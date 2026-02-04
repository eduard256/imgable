// Package config provides configuration management for the API server.
// All configuration is loaded from environment variables with sensible defaults.
package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the API server.
type Config struct {
	// Server
	Port            int
	ShutdownTimeout time.Duration

	// Authentication
	Password      string
	JWTSecretFile string
	JWTSecret     []byte
	JWTExpiry     time.Duration

	// Database
	DatabaseURL string

	// Redis
	RedisURL string

	// Paths
	MediaPath   string
	UploadsPath string
	StaticPath  string

	// Service URLs (for proxy)
	ScannerURL   string
	ProcessorURL string

	// Rate limiting
	LoginRateLimit int // requests per minute

	// Upload
	MaxUploadSize int64 // 0 = unlimited

	// Logging
	LogLevel  string
	LogFormat string
}

// Load reads configuration from environment variables.
// It returns an error if required variables are missing.
func Load() (*Config, error) {
	cfg := &Config{
		// Server defaults
		Port:            getEnvInt("API_PORT", 9812),
		ShutdownTimeout: time.Duration(getEnvInt("SHUTDOWN_TIMEOUT_SEC", 30)) * time.Second,

		// Auth defaults
		Password:      os.Getenv("IMGABLE_PASSWORD"),
		JWTSecretFile: getEnvString("JWT_SECRET_FILE", "/data/.jwt_secret"),
		JWTExpiry:     time.Duration(getEnvInt("JWT_EXPIRY_DAYS", 30)) * 24 * time.Hour,

		// Database
		DatabaseURL: os.Getenv("DATABASE_URL"),

		// Redis
		RedisURL: getEnvString("REDIS_URL", "redis://localhost:6379"),

		// Paths
		MediaPath:   getEnvString("MEDIA_PATH", "/data/media"),
		UploadsPath: getEnvString("UPLOADS_PATH", "/data/uploads"),
		StaticPath:  getEnvString("STATIC_PATH", "/static"),

		// Service URLs
		ScannerURL:   getEnvString("SCANNER_URL", "http://localhost:8001"),
		ProcessorURL: getEnvString("PROCESSOR_URL", "http://localhost:8002"),

		// Rate limiting
		LoginRateLimit: getEnvInt("RATE_LIMIT_LOGIN", 5),

		// Upload
		MaxUploadSize: getEnvInt64("MAX_UPLOAD_SIZE", 0),

		// Logging
		LogLevel:  getEnvString("LOG_LEVEL", "info"),
		LogFormat: getEnvString("LOG_FORMAT", "text"),
	}

	// Validate required fields
	if cfg.Password == "" {
		return nil, fmt.Errorf("IMGABLE_PASSWORD is required")
	}
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	// Load or generate JWT secret
	secret, err := loadOrCreateJWTSecret(cfg.JWTSecretFile)
	if err != nil {
		return nil, fmt.Errorf("failed to load JWT secret: %w", err)
	}
	cfg.JWTSecret = secret

	return cfg, nil
}

// loadOrCreateJWTSecret reads JWT secret from file or generates a new one.
// The secret is stored in a file to persist across container restarts.
func loadOrCreateJWTSecret(path string) ([]byte, error) {
	// Try to read existing secret
	data, err := os.ReadFile(path)
	if err == nil && len(data) >= 32 {
		return data, nil
	}

	// Generate new 32-byte secret
	secret := make([]byte, 32)
	if _, err := rand.Read(secret); err != nil {
		return nil, fmt.Errorf("failed to generate random secret: %w", err)
	}

	// Encode as hex for readability in file
	encoded := make([]byte, hex.EncodedLen(len(secret)))
	hex.Encode(encoded, secret)

	// Ensure directory exists
	dir := path[:len(path)-len("/"+filepath(path))]
	if dir != "" && dir != path {
		if err := os.MkdirAll(dirFromPath(path), 0700); err != nil {
			return nil, fmt.Errorf("failed to create directory: %w", err)
		}
	}

	// Write to file with restricted permissions
	if err := os.WriteFile(path, encoded, 0600); err != nil {
		return nil, fmt.Errorf("failed to write secret file: %w", err)
	}

	return encoded, nil
}

// dirFromPath extracts directory from file path.
func dirFromPath(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[:i]
		}
	}
	return "."
}

// filepath extracts filename from path.
func filepath(path string) string {
	for i := len(path) - 1; i >= 0; i-- {
		if path[i] == '/' {
			return path[i+1:]
		}
	}
	return path
}

// getEnvString returns environment variable or default value.
func getEnvString(key, defaultVal string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return defaultVal
}

// getEnvInt returns environment variable as int or default value.
func getEnvInt(key string, defaultVal int) int {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

// getEnvInt64 returns environment variable as int64 or default value.
func getEnvInt64(key string, defaultVal int64) int64 {
	if val := os.Getenv(key); val != "" {
		if i, err := strconv.ParseInt(val, 10, 64); err == nil {
			return i
		}
	}
	return defaultVal
}

// EnsureDirs creates required directories if they don't exist.
func (c *Config) EnsureDirs() error {
	// Only create uploads dir - media is managed by processor
	if err := os.MkdirAll(c.UploadsPath, 0755); err != nil {
		return fmt.Errorf("failed to create directory %s: %w", c.UploadsPath, err)
	}
	return nil
}
