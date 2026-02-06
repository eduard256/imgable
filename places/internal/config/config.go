// Package config provides configuration for the places service.
package config

import (
	"os"
)

// Config holds all configuration for the places service.
type Config struct {
	// Database connection
	DatabaseURL string

	// Nominatim API
	NominatimURL        string
	NominatimRateLimitMs int

	// Clustering
	RadiusDegrees float64

	// Scheduler
	IntervalMinutes int

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

		// Nominatim
		NominatimURL:        getEnv("NOMINATIM_URL", "https://nominatim.openstreetmap.org"),
		NominatimRateLimitMs: 1100, // Hardcoded: 1.1 seconds between requests

		// Clustering
		RadiusDegrees: 0.25, // Hardcoded: ~25 km

		// Scheduler
		IntervalMinutes: 5, // Hardcoded: every 5 minutes

		// API
		APIPort: getEnv("API_PORT", "8003"),

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
