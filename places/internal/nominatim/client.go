// Package nominatim provides a client for the Nominatim reverse geocoding API.
package nominatim

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/eduard256/imgable/shared/pkg/logger"
)

// Client handles requests to the Nominatim API.
type Client struct {
	httpClient  *http.Client
	baseURL     string
	rateLimitMs int
	logger      *logger.Logger
	lastRequest time.Time
}

// NewClient creates a new Nominatim client.
func NewClient(baseURL string, rateLimitMs int, log *logger.Logger) *Client {
	return &Client{
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		baseURL:     baseURL,
		rateLimitMs: rateLimitMs,
		logger:      log.WithField("component", "nominatim"),
	}
}

// Response represents the response from Nominatim reverse geocoding.
type Response struct {
	PlaceID     int     `json:"place_id"`
	DisplayName string  `json:"display_name"`
	Address     Address `json:"address"`
}

// Address represents address details from Nominatim.
type Address struct {
	HouseNumber   string `json:"house_number"`
	Road          string `json:"road"`
	Neighbourhood string `json:"neighbourhood"`
	Suburb        string `json:"suburb"`
	Borough       string `json:"borough"`
	City          string `json:"city"`
	Town          string `json:"town"`
	Village       string `json:"village"`
	County        string `json:"county"`
	State         string `json:"state"`
	Country       string `json:"country"`
	CountryCode   string `json:"country_code"`
}

// GetCity returns the most specific city-level location.
func (a *Address) GetCity() string {
	if a.City != "" {
		return a.City
	}
	if a.Town != "" {
		return a.Town
	}
	if a.Village != "" {
		return a.Village
	}
	return ""
}

// GetName returns a human-readable place name.
func (a *Address) GetName() string {
	// Prefer city-level name
	if city := a.GetCity(); city != "" {
		return city
	}
	// Fall back to county or state
	if a.County != "" {
		return a.County
	}
	if a.State != "" {
		return a.State
	}
	// Last resort: country
	return a.Country
}

// ReverseGeocode performs reverse geocoding for the given coordinates.
func (c *Client) ReverseGeocode(ctx context.Context, lat, lon float64) (*Response, error) {
	// Rate limiting
	elapsed := time.Since(c.lastRequest)
	if elapsed < time.Duration(c.rateLimitMs)*time.Millisecond {
		sleepTime := time.Duration(c.rateLimitMs)*time.Millisecond - elapsed
		time.Sleep(sleepTime)
	}
	c.lastRequest = time.Now()

	// Build URL
	url := fmt.Sprintf("%s/reverse?lat=%f&lon=%f&format=jsonv2&addressdetails=1",
		c.baseURL, lat, lon)

	// Create request
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	// Required by Nominatim usage policy
	req.Header.Set("User-Agent", "Imgable/1.0 (self-hosted photo gallery)")
	req.Header.Set("Accept", "application/json")

	// Send request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status: %d", resp.StatusCode)
	}

	// Parse response
	var result Response
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("decode response: %w", err)
	}

	c.logger.WithFields(map[string]interface{}{
		"lat":  lat,
		"lon":  lon,
		"name": result.Address.GetName(),
	}).Debug("reverse geocoding successful")

	return &result, nil
}
