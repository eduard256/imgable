// Package config provides configuration management for the scanner service.
// Configuration is loaded from environment variables with sensible defaults.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config holds all configuration for the scanner service.
type Config struct {
	// Redis connection URL
	RedisURL string

	// Directory to watch for new files
	UploadsDir string

	// Polling interval for fallback scanning (in addition to fsnotify)
	ScanInterval time.Duration

	// API server configuration
	APIPort string

	// Logging configuration
	LogLevel  string
	LogFormat string
}

// Load loads configuration from environment variables.
func Load() *Config {
	return &Config{
		RedisURL:     getEnv("REDIS_URL", "redis://localhost:6379"),
		UploadsDir:   getEnv("UPLOADS_DIR", "/uploads"),
		ScanInterval: getDurationEnv("SCAN_INTERVAL_SEC", 60) * time.Second,
		APIPort:      getEnv("API_PORT", "8001"),
		LogLevel:     getEnv("LOG_LEVEL", "info"),
		LogFormat:    getEnv("LOG_FORMAT", "text"),
	}
}

// getEnv returns the environment variable value or a default if not set.
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// getIntEnv returns the environment variable as int or a default if not set.
func getIntEnv(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intVal, err := strconv.Atoi(value); err == nil {
			return intVal
		}
	}
	return defaultValue
}

// getDurationEnv returns the environment variable as duration or a default if not set.
func getDurationEnv(key string, defaultSeconds int) time.Duration {
	return time.Duration(getIntEnv(key, defaultSeconds))
}
