// Package geo provides geocoding functionality using Nominatim.
package geo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/eduard256/imgable/shared/pkg/logger"
	"github.com/eduard256/imgable/shared/pkg/models"
)

// Geocoder handles reverse geocoding using Nominatim.
type Geocoder struct {
	client        *http.Client
	baseURL       string
	rateLimitMs   int
	enabled       bool
	logger        *logger.Logger

	// Rate limiting
	mu           sync.Mutex
	lastRequest  time.Time
}

// GeocoderConfig holds geocoder configuration.
type GeocoderConfig struct {
	// Nominatim API base URL
	BaseURL string

	// Rate limit in milliseconds between requests
	RateLimitMs int

	// Whether geocoding is enabled
	Enabled bool

	// HTTP client timeout
	Timeout time.Duration
}

// DefaultGeocoderConfig returns default configuration.
func DefaultGeocoderConfig() GeocoderConfig {
	return GeocoderConfig{
		BaseURL:     "https://nominatim.openstreetmap.org",
		RateLimitMs: 1100, // Slightly more than 1 req/sec to be safe
		Enabled:     true,
		Timeout:     10 * time.Second,
	}
}

// NewGeocoder creates a new geocoder.
func NewGeocoder(cfg GeocoderConfig, log *logger.Logger) *Geocoder {
	return &Geocoder{
		client: &http.Client{
			Timeout: cfg.Timeout,
		},
		baseURL:     cfg.BaseURL,
		rateLimitMs: cfg.RateLimitMs,
		enabled:     cfg.Enabled,
		logger:      log.WithField("component", "geocoder"),
	}
}

// ReverseGeocode performs reverse geocoding for the given coordinates.
// Returns nil if geocoding is disabled or fails (not an error for the caller).
func (g *Geocoder) ReverseGeocode(ctx context.Context, lat, lon float64) (*models.NominatimResponse, error) {
	if !g.enabled {
		return nil, nil
	}

	// Rate limiting
	g.mu.Lock()
	elapsed := time.Since(g.lastRequest)
	if elapsed < time.Duration(g.rateLimitMs)*time.Millisecond {
		sleepTime := time.Duration(g.rateLimitMs)*time.Millisecond - elapsed
		g.mu.Unlock()
		time.Sleep(sleepTime)
		g.mu.Lock()
	}
	g.lastRequest = time.Now()
	g.mu.Unlock()

	// Build URL
	url := fmt.Sprintf("%s/reverse?lat=%f&lon=%f&format=json&addressdetails=1",
		g.baseURL, lat, lon)

	// Create request
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	// Nominatim requires a User-Agent
	req.Header.Set("User-Agent", "Imgable/1.0 (https://github.com/eduard256/imgable)")
	req.Header.Set("Accept", "application/json")

	// Send request
	resp, err := g.client.Do(req)
	if err != nil {
		g.logger.WithError(err).Warn("geocoding request failed")
		return nil, nil // Don't fail the whole process
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		g.logger.WithField("status", resp.StatusCode).Warn("geocoding returned non-200 status")
		return nil, nil
	}

	// Parse response
	var result models.NominatimResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		g.logger.WithError(err).Warn("failed to parse geocoding response")
		return nil, nil
	}

	g.logger.WithFields(map[string]interface{}{
		"lat":  lat,
		"lon":  lon,
		"name": result.DisplayName,
	}).Debug("geocoding successful")

	return &result, nil
}

// IsEnabled returns whether geocoding is enabled.
func (g *Geocoder) IsEnabled() bool {
	return g.enabled
}

// SetEnabled enables or disables geocoding.
func (g *Geocoder) SetEnabled(enabled bool) {
	g.enabled = enabled
}
