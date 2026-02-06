// Package config provides configuration management for the processor service.
// Configuration is loaded from environment variables with sensible defaults.
package config

import (
	"fmt"
	"os"
	"strconv"
)

// Config holds all configuration for the processor service.
type Config struct {
	// Database connection
	DatabaseURL string

	// Redis connection
	RedisURL string

	// Directory paths
	UploadsDir string
	MediaDir   string
	FailedDir  string
	TempDir    string

	// Worker configuration
	Workers    int
	MaxRetries int

	// Resource limits
	MaxMemoryMB int

	// Image processing
	PreviewQuality int
	PreviewSmallPx int
	PreviewLargePx int

	// API server
	APIPort string

	// Logging
	LogLevel  string
	LogFormat string
}

// Load loads configuration from environment variables.
func Load() *Config {
	return &Config{
		// Database
		DatabaseURL: getEnv("DATABASE_URL", "postgres://imgable:imgable@localhost:5432/imgable?sslmode=disable"),

		// Redis
		RedisURL: getEnv("REDIS_URL", "redis://localhost:6379"),

		// Directories
		UploadsDir: getEnv("UPLOADS_DIR", "/data/uploads"),
		MediaDir:   getEnv("MEDIA_DIR", "/data/media"),
		FailedDir:  getEnv("FAILED_DIR", "/data/failed"),
		TempDir:    getEnv("TEMP_DIR", "/tmp/imgable"),

		// Workers
		Workers:    getIntEnv("WORKERS", 4),
		MaxRetries: getIntEnv("MAX_RETRIES", 3),

		// Resources
		MaxMemoryMB: getIntEnv("MAX_MEMORY_MB", 1024),

		// Image processing
		PreviewQuality: getIntEnv("PREVIEW_QUALITY", 85),
		PreviewSmallPx: getIntEnv("PREVIEW_SMALL_PX", 800),
		PreviewLargePx: getIntEnv("PREVIEW_LARGE_PX", 2500),

		// API
		APIPort: getEnv("API_PORT", "8002"),

		// Logging
		LogLevel:  getEnv("LOG_LEVEL", "info"),
		LogFormat: getEnv("LOG_FORMAT", "text"),
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


// PreviewConfig returns preview generation configuration.
type PreviewConfig struct {
	Quality int
	SmallPx int
	LargePx int
}

// GetPreviewConfig returns the preview configuration.
func (c *Config) GetPreviewConfig() PreviewConfig {
	return PreviewConfig{
		Quality: c.PreviewQuality,
		SmallPx: c.PreviewSmallPx,
		LargePx: c.PreviewLargePx,
	}
}

// EnsureDirs creates required directories if they don't exist.
func (c *Config) EnsureDirs() error {
	dirs := []string{c.UploadsDir, c.MediaDir, c.FailedDir, c.TempDir}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}
	return nil
}
