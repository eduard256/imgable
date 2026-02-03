// Package config provides configuration management for the processor service.
// Configuration is loaded from environment variables with sensible defaults.
package config

import (
	"os"
	"strconv"
	"time"
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
	PreviewQuality   int
	PreviewSmallPx   int
	PreviewMediumPx  int
	PreviewLargePx   int

	// Geocoding
	NominatimEnabled    bool
	NominatimURL        string
	NominatimRateLimitMs int
	PlaceRadiusM        int

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
		UploadsDir: getEnv("UPLOADS_DIR", "/uploads"),
		MediaDir:   getEnv("MEDIA_DIR", "/media"),
		FailedDir:  getEnv("FAILED_DIR", "/failed"),
		TempDir:    getEnv("TEMP_DIR", "/tmp/imgable"),

		// Workers
		Workers:    getIntEnv("WORKERS", 4),
		MaxRetries: getIntEnv("MAX_RETRIES", 3),

		// Resources
		MaxMemoryMB: getIntEnv("MAX_MEMORY_MB", 1024),

		// Image processing
		PreviewQuality:  getIntEnv("PREVIEW_QUALITY", 85),
		PreviewSmallPx:  getIntEnv("PREVIEW_SMALL_PX", 800),
		PreviewMediumPx: getIntEnv("PREVIEW_MEDIUM_PX", 1600),
		PreviewLargePx:  getIntEnv("PREVIEW_LARGE_PX", 2500),

		// Geocoding
		NominatimEnabled:     getBoolEnv("NOMINATIM_ENABLED", true),
		NominatimURL:         getEnv("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),
		NominatimRateLimitMs: getIntEnv("NOMINATIM_RATE_LIMIT_MS", 1100),
		PlaceRadiusM:         getIntEnv("PLACE_RADIUS_M", 500),

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

// getBoolEnv returns the environment variable as bool or a default if not set.
func getBoolEnv(key string, defaultValue bool) bool {
	if value := os.Getenv(key); value != "" {
		if boolVal, err := strconv.ParseBool(value); err == nil {
			return boolVal
		}
	}
	return defaultValue
}

// getDurationEnv returns the environment variable as duration or a default if not set.
func getDurationEnv(key string, defaultMs int) time.Duration {
	return time.Duration(getIntEnv(key, defaultMs)) * time.Millisecond
}

// PreviewConfig returns preview generation configuration.
type PreviewConfig struct {
	Quality  int
	SmallPx  int
	MediumPx int
	LargePx  int
}

// GetPreviewConfig returns the preview configuration.
func (c *Config) GetPreviewConfig() PreviewConfig {
	return PreviewConfig{
		Quality:  c.PreviewQuality,
		SmallPx:  c.PreviewSmallPx,
		MediumPx: c.PreviewMediumPx,
		LargePx:  c.PreviewLargePx,
	}
}
