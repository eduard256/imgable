package geo

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"math"

	"github.com/jackc/pgx/v5"

	"github.com/eduard256/imgable/shared/pkg/database"
	"github.com/eduard256/imgable/shared/pkg/logger"
	"github.com/eduard256/imgable/shared/pkg/models"
)

// PlaceManager handles place creation and clustering.
type PlaceManager struct {
	db        *database.DB
	geocoder  *Geocoder
	radiusM   int
	logger    *logger.Logger
}

// PlaceManagerConfig holds configuration for the place manager.
type PlaceManagerConfig struct {
	// Radius in meters for clustering photos into places
	RadiusM int

	// Database connection
	DB *database.DB

	// Geocoder for reverse geocoding
	Geocoder *Geocoder
}

// NewPlaceManager creates a new place manager.
func NewPlaceManager(cfg PlaceManagerConfig, log *logger.Logger) *PlaceManager {
	return &PlaceManager{
		db:       cfg.DB,
		geocoder: cfg.Geocoder,
		radiusM:  cfg.RadiusM,
		logger:   log.WithField("component", "place-manager"),
	}
}

// FindOrCreatePlace finds an existing place within radius or creates a new one.
// Returns the place ID.
func (pm *PlaceManager) FindOrCreatePlace(ctx context.Context, lat, lon float64) (string, error) {
	// First, try to find an existing place within radius
	placeID, err := pm.findNearbyPlace(ctx, lat, lon)
	if err != nil {
		return "", fmt.Errorf("failed to find nearby place: %w", err)
	}

	if placeID != "" {
		pm.logger.WithFields(map[string]interface{}{
			"place_id": placeID,
			"lat":      lat,
			"lon":      lon,
		}).Debug("found existing place")
		return placeID, nil
	}

	// No existing place found, create a new one
	return pm.createPlace(ctx, lat, lon)
}

// findNearbyPlace finds a place within the configured radius.
func (pm *PlaceManager) findNearbyPlace(ctx context.Context, lat, lon float64) (string, error) {
	// Use PostgreSQL earthdistance extension for accurate distance calculation
	query := `
		SELECT id
		FROM places
		WHERE earth_box(ll_to_earth($1, $2), $3) @> ll_to_earth(gps_lat, gps_lon)
		  AND earth_distance(ll_to_earth($1, $2), ll_to_earth(gps_lat, gps_lon)) < $3
		ORDER BY earth_distance(ll_to_earth($1, $2), ll_to_earth(gps_lat, gps_lon))
		LIMIT 1
	`

	var placeID string
	err := pm.db.QueryRow(ctx, query, lat, lon, pm.radiusM).Scan(&placeID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return "", nil
		}
		return "", err
	}

	return placeID, nil
}

// createPlace creates a new place with geocoding.
func (pm *PlaceManager) createPlace(ctx context.Context, lat, lon float64) (string, error) {
	// Generate place ID from coordinates
	placeID := generatePlaceID(lat, lon)

	// Default name is coordinates
	name := fmt.Sprintf("%.4f, %.4f", lat, lon)
	nameSource := "auto"
	var country, city, address *string

	// Try to get location name from Nominatim
	if pm.geocoder != nil && pm.geocoder.IsEnabled() {
		result, err := pm.geocoder.ReverseGeocode(ctx, lat, lon)
		if err == nil && result != nil {
			// Extract meaningful name
			locality := result.Address.GetLocality()
			if locality != "" {
				name = locality
			} else if result.Address.GetCity() != "" {
				name = result.Address.GetCity()
			}

			if result.Address.Country != "" {
				country = &result.Address.Country
			}
			cityName := result.Address.GetCity()
			if cityName != "" {
				city = &cityName
			}
			if result.DisplayName != "" {
				address = &result.DisplayName
			}
		}
	}

	// Insert the new place
	query := `
		INSERT INTO places (id, name, name_source, country, city, address, gps_lat, gps_lon, radius_m, photo_count, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
		RETURNING id
	`

	var insertedID string
	err := pm.db.QueryRow(ctx, query, placeID, name, nameSource, country, city, address, lat, lon, pm.radiusM).Scan(&insertedID)
	if err != nil {
		if err == pgx.ErrNoRows {
			// Conflict - place was created by another worker, find it
			return pm.findNearbyPlace(ctx, lat, lon)
		}
		return "", fmt.Errorf("failed to insert place: %w", err)
	}

	pm.logger.WithFields(map[string]interface{}{
		"place_id": placeID,
		"name":     name,
		"lat":      lat,
		"lon":      lon,
	}).Info("created new place")

	return insertedID, nil
}

// generatePlaceID generates a unique ID for a place based on coordinates.
// Uses a hash of rounded coordinates to ensure nearby points get different IDs.
func generatePlaceID(lat, lon float64) string {
	// Round to ~10m precision (4 decimal places)
	roundedLat := math.Round(lat*10000) / 10000
	roundedLon := math.Round(lon*10000) / 10000

	input := fmt.Sprintf("place:%f:%f", roundedLat, roundedLon)
	hash := sha256.Sum256([]byte(input))
	return "pl_" + hex.EncodeToString(hash[:])[:12]
}

// UpdatePlaceName allows updating a place's name (for user renames).
func (pm *PlaceManager) UpdatePlaceName(ctx context.Context, placeID, newName string) error {
	query := `
		UPDATE places
		SET name = $2, name_source = 'manual', updated_at = NOW()
		WHERE id = $1
	`

	if err := pm.db.Exec(ctx, query, placeID, newName); err != nil {
		return fmt.Errorf("failed to update place name: %w", err)
	}

	return nil
}

// GetPlace retrieves a place by ID.
func (pm *PlaceManager) GetPlace(ctx context.Context, placeID string) (*models.Place, error) {
	query := `
		SELECT id, name, name_source, country, city, address, gps_lat, gps_lon, radius_m, photo_count, created_at, updated_at
		FROM places
		WHERE id = $1
	`

	var place models.Place
	err := pm.db.QueryRow(ctx, query, placeID).Scan(
		&place.ID,
		&place.Name,
		&place.NameSource,
		&place.Country,
		&place.City,
		&place.Address,
		&place.GPSLat,
		&place.GPSLon,
		&place.RadiusM,
		&place.PhotoCount,
		&place.CreatedAt,
		&place.UpdatedAt,
	)

	if err != nil {
		if err == pgx.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}

	return &place, nil
}

// Haversine calculates the distance between two points on Earth in meters.
func Haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const earthRadiusM = 6371000

	lat1Rad := lat1 * math.Pi / 180
	lat2Rad := lat2 * math.Pi / 180
	deltaLat := (lat2 - lat1) * math.Pi / 180
	deltaLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(deltaLat/2)*math.Sin(deltaLat/2) +
		math.Cos(lat1Rad)*math.Cos(lat2Rad)*
			math.Sin(deltaLon/2)*math.Sin(deltaLon/2)

	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusM * c
}
