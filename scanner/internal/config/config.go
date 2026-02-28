// Package config provides configuration management for the scanner service.
// Configuration is loaded from environment variables with sensible defaults.
package config

import (
	"fmt"
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

	// Directory for stuck/failed files
	FailedDir string

	// Polling interval for fallback scanning (in addition to fsnotify)
	ScanInterval time.Duration

	// Timeout for stuck files (files in pending with unchanged size)
	StuckFileTimeout time.Duration

	// API server configuration
	APIHost string
	APIPort string

	// External services
	AIServiceURL string

	// Logging configuration
	LogLevel  string
	LogFormat string
}

// Load loads configuration from environment variables.
func Load() *Config {
	return &Config{
		RedisURL:         getEnv("REDIS_URL", "redis://localhost:6379"),
		UploadsDir:       getEnv("UPLOADS_DIR", "/data/uploads"),
		FailedDir:        getEnv("FAILED_DIR", "/data/failed"),
		ScanInterval:     getDurationEnv("SCAN_INTERVAL_SEC", 60) * time.Second,
		StuckFileTimeout: getDurationEnv("STUCK_FILE_TIMEOUT_MIN", 5) * time.Minute,
		APIHost:          getEnv("API_HOST", ""),
		APIPort:          getEnv("API_PORT", "8001"),
		AIServiceURL:     getEnv("AI_SERVICE_URL", "http://ai:8004"),
		LogLevel:         getEnv("LOG_LEVEL", "info"),
		LogFormat:        getEnv("LOG_FORMAT", "text"),
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

// EnsureDirs creates required directories if they don't exist.
func (c *Config) EnsureDirs() error {
	dirs := []string{c.UploadsDir, c.FailedDir}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}
	return nil
}
