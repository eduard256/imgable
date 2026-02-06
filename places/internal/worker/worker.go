// Package worker provides the places processing worker.
package worker

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"
	"sync"
	"time"

	"github.com/eduard256/imgable/places/internal/nominatim"
	"github.com/eduard256/imgable/shared/pkg/database"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

// Worker processes photos and assigns them to places.
type Worker struct {
	db            *database.DB
	nominatim     *nominatim.Client
	radiusDegrees float64
	logger        *logger.Logger

	// State
	mu        sync.RWMutex
	status    Status
	lastRun   *RunStats
	isRunning bool
}

// Status represents the current worker status.
type Status string

const (
	StatusIdle       Status = "idle"
	StatusProcessing Status = "processing"
)

// RunStats holds statistics for a processing run.
type RunStats struct {
	StartedAt          time.Time `json:"started_at"`
	CompletedAt        time.Time `json:"completed_at,omitempty"`
	PhotosProcessed    int       `json:"photos_processed"`
	PlacesCreated      int       `json:"places_created"`
	NominatimRequests  int       `json:"nominatim_requests"`
	Errors             int       `json:"errors"`
}

// StatusResponse represents the full status response.
type StatusResponse struct {
	Status       Status    `json:"status"`
	LastRun      *RunStats `json:"last_run,omitempty"`
	PendingCount int       `json:"pending_count"`
}

// Photo represents a photo pending place assignment.
type Photo struct {
	ID     string
	GPSLat float64
	GPSLon float64
}

// Place represents a place in the database.
type Place struct {
	ID      string
	Name    string
	City    *string
	Country *string
	GPSLat  float64
	GPSLon  float64
}

// NewWorker creates a new places worker.
func NewWorker(db *database.DB, nominatimClient *nominatim.Client, radiusDegrees float64, log *logger.Logger) *Worker {
	return &Worker{
		db:            db,
		nominatim:     nominatimClient,
		radiusDegrees: radiusDegrees,
		logger:        log.WithField("component", "worker"),
		status:        StatusIdle,
	}
}

// GetStatus returns the current status.
func (w *Worker) GetStatus(ctx context.Context) (*StatusResponse, error) {
	w.mu.RLock()
	status := w.status
	lastRun := w.lastRun
	w.mu.RUnlock()

	// Get pending count
	pendingCount, err := w.getPendingCount(ctx)
	if err != nil {
		return nil, err
	}

	return &StatusResponse{
		Status:       status,
		LastRun:      lastRun,
		PendingCount: pendingCount,
	}, nil
}

// Run starts a processing run.
// Returns immediately if already running.
func (w *Worker) Run(ctx context.Context) error {
	w.mu.Lock()
	if w.isRunning {
		w.mu.Unlock()
		w.logger.Info("already running, skipping")
		return nil
	}
	w.isRunning = true
	w.status = StatusProcessing
	w.mu.Unlock()

	defer func() {
		w.mu.Lock()
		w.isRunning = false
		w.status = StatusIdle
		w.mu.Unlock()
	}()

	stats := &RunStats{
		StartedAt: time.Now(),
	}

	w.logger.Info("starting places processing run")

	// Get pending photos
	photos, err := w.getPendingPhotos(ctx)
	if err != nil {
		w.logger.WithError(err).Error("failed to get pending photos")
		stats.Errors++
		return err
	}

	if len(photos) == 0 {
		w.logger.Info("no pending photos")
		stats.CompletedAt = time.Now()
		w.mu.Lock()
		w.lastRun = stats
		w.mu.Unlock()
		return nil
	}

	w.logger.WithField("count", len(photos)).Info("processing photos")

	// Process each photo
	for _, photo := range photos {
		if ctx.Err() != nil {
			w.logger.Info("context cancelled, stopping")
			break
		}

		if err := w.processPhoto(ctx, photo, stats); err != nil {
			w.logger.WithError(err).WithField("photo_id", photo.ID).Error("failed to process photo")
			stats.Errors++
			continue
		}
		stats.PhotosProcessed++
	}

	stats.CompletedAt = time.Now()
	w.mu.Lock()
	w.lastRun = stats
	w.mu.Unlock()

	w.logger.WithFields(map[string]interface{}{
		"photos_processed":   stats.PhotosProcessed,
		"places_created":     stats.PlacesCreated,
		"nominatim_requests": stats.NominatimRequests,
		"errors":             stats.Errors,
		"duration_sec":       stats.CompletedAt.Sub(stats.StartedAt).Seconds(),
	}).Info("places processing run completed")

	return nil
}

// processPhoto processes a single photo.
func (w *Worker) processPhoto(ctx context.Context, photo Photo, stats *RunStats) error {
	// Find existing place within radius
	place, err := w.findNearbyPlace(ctx, photo.GPSLat, photo.GPSLon)
	if err != nil {
		return fmt.Errorf("find nearby place: %w", err)
	}

	var placeID string

	if place != nil {
		// Use existing place
		placeID = place.ID
		w.logger.WithFields(map[string]interface{}{
			"photo_id": photo.ID,
			"place_id": placeID,
			"place":    place.Name,
		}).Debug("found existing place")
	} else {
		// Create new place via Nominatim
		placeID, err = w.createPlace(ctx, photo.GPSLat, photo.GPSLon, stats)
		if err != nil {
			return fmt.Errorf("create place: %w", err)
		}
	}

	// Assign place to photo
	if err := w.assignPlace(ctx, photo.ID, placeID); err != nil {
		return fmt.Errorf("assign place: %w", err)
	}

	return nil
}

// getPendingPhotos returns photos with GPS but without place_id.
func (w *Worker) getPendingPhotos(ctx context.Context) ([]Photo, error) {
	query := `
		SELECT id, gps_lat, gps_lon
		FROM photos
		WHERE gps_lat IS NOT NULL
		  AND place_id IS NULL
		  AND status = 'ready'
		ORDER BY created_at
	`

	rows, err := w.db.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var photos []Photo
	for rows.Next() {
		var p Photo
		if err := rows.Scan(&p.ID, &p.GPSLat, &p.GPSLon); err != nil {
			return nil, err
		}
		photos = append(photos, p)
	}

	return photos, nil
}

// getPendingCount returns the count of pending photos.
func (w *Worker) getPendingCount(ctx context.Context) (int, error) {
	query := `
		SELECT COUNT(*)
		FROM photos
		WHERE gps_lat IS NOT NULL
		  AND place_id IS NULL
		  AND status = 'ready'
	`

	var count int
	if err := w.db.QueryRow(ctx, query).Scan(&count); err != nil {
		return 0, err
	}

	return count, nil
}

// findNearbyPlace finds a place within the configured radius.
func (w *Worker) findNearbyPlace(ctx context.Context, lat, lon float64) (*Place, error) {
	query := `
		SELECT id, name, city, country, gps_lat, gps_lon
		FROM places
		WHERE ABS(gps_lat - $1) < $3
		  AND ABS(gps_lon - $2) < $3
		ORDER BY ABS(gps_lat - $1) + ABS(gps_lon - $2)
		LIMIT 1
	`

	var p Place
	err := w.db.QueryRow(ctx, query, lat, lon, w.radiusDegrees).Scan(
		&p.ID, &p.Name, &p.City, &p.Country, &p.GPSLat, &p.GPSLon,
	)

	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, err
	}

	return &p, nil
}

// createPlace creates a new place using Nominatim and creates an associated album.
func (w *Worker) createPlace(ctx context.Context, lat, lon float64, stats *RunStats) (string, error) {
	// Call Nominatim
	resp, err := w.nominatim.ReverseGeocode(ctx, lat, lon)
	stats.NominatimRequests++
	if err != nil {
		return "", fmt.Errorf("nominatim: %w", err)
	}

	// Generate place ID
	placeID := generatePlaceID(lat, lon)

	// Get name and address info
	name := resp.Address.GetName()
	if name == "" {
		name = fmt.Sprintf("%.4f, %.4f", lat, lon)
	}

	var city, country, address *string
	if c := resp.Address.GetCity(); c != "" {
		city = &c
	}
	if c := resp.Address.Country; c != "" {
		country = &c
	}
	if resp.DisplayName != "" {
		address = &resp.DisplayName
	}

	// Insert place
	placeQuery := `
		INSERT INTO places (id, name, name_source, city, country, address, gps_lat, gps_lon, radius_m, photo_count, created_at, updated_at)
		VALUES ($1, $2, 'auto', $3, $4, $5, $6, $7, 25000, 0, NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`

	if err := w.db.Exec(ctx, placeQuery, placeID, name, city, country, address, lat, lon); err != nil {
		return "", fmt.Errorf("insert place: %w", err)
	}

	// Create album for this place
	albumID := "album_" + placeID[3:] // Remove "pl_" prefix, add "album_"
	albumQuery := `
		INSERT INTO albums (id, type, name, place_id, photo_count, created_at, updated_at)
		VALUES ($1, 'place', $2, $3, 0, NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
	`

	if err := w.db.Exec(ctx, albumQuery, albumID, name, placeID); err != nil {
		return "", fmt.Errorf("insert album: %w", err)
	}

	stats.PlacesCreated++
	w.logger.WithFields(map[string]interface{}{
		"place_id": placeID,
		"name":     name,
		"lat":      lat,
		"lon":      lon,
	}).Info("created new place")

	return placeID, nil
}

// assignPlace assigns a place_id to a photo.
func (w *Worker) assignPlace(ctx context.Context, photoID, placeID string) error {
	query := `UPDATE photos SET place_id = $2 WHERE id = $1`
	return w.db.Exec(ctx, query, photoID, placeID)
}

// generatePlaceID generates a unique ID for a place based on coordinates.
func generatePlaceID(lat, lon float64) string {
	// Round to ~100m precision
	roundedLat := math.Round(lat*10000) / 10000
	roundedLon := math.Round(lon*10000) / 10000

	input := fmt.Sprintf("place:%f:%f", roundedLat, roundedLon)
	hash := sha256.Sum256([]byte(input))
	return "pl_" + hex.EncodeToString(hash[:])[:12]
}
