// Package storage provides map-related database operations.
// This file implements server-side clustering for photo coordinates.
package storage

import (
	"context"
	"database/sql"
	"fmt"
	"math"
)

// MapBounds represents geographic boundaries for a query or cluster.
type MapBounds struct {
	North float64 `json:"n"`
	South float64 `json:"s"`
	East  float64 `json:"e"`
	West  float64 `json:"w"`
}

// MapCluster represents a cluster of photos or a single photo point on the map.
type MapCluster struct {
	Lat       float64    `json:"lat"`
	Lon       float64    `json:"lon"`
	Count     int        `json:"count"`
	PreviewID string     `json:"preview_id"`
	PhotoID   *string    `json:"photo_id,omitempty"`   // Set when count == 1
	Bounds    *MapBounds `json:"bounds,omitempty"`     // Set when count > 1
}

// MapClustersResult contains the clustering result with metadata.
type MapClustersResult struct {
	Clusters []MapCluster `json:"clusters"`
	Total    int          `json:"total"`
}

// MapClusterParams contains parameters for the clustering query.
type MapClusterParams struct {
	Bounds MapBounds
	Zoom   int
}

// gridSizeForZoom returns the grid cell size in degrees for a given zoom level.
// Lower zoom = larger grid = bigger clusters.
func gridSizeForZoom(zoom int) float64 {
	switch {
	case zoom <= 4:
		return 10.0 // Continents
	case zoom <= 6:
		return 5.0 // Large countries
	case zoom <= 8:
		return 2.0 // Countries
	case zoom <= 10:
		return 0.5 // Regions
	case zoom <= 12:
		return 0.2 // Cities
	case zoom <= 14:
		return 0.05 // Districts
	case zoom <= 16:
		return 0.01 // Streets
	default:
		return 0.001 // Individual buildings
	}
}

// GetMapClusters returns clustered photo points within the given bounds.
// Uses grid-based clustering that adapts to zoom level.
// If too many clusters are generated, the grid size is increased automatically.
func (s *Storage) GetMapClusters(ctx context.Context, params MapClusterParams) (*MapClustersResult, error) {
	gridSize := gridSizeForZoom(params.Zoom)
	maxClusters := 300

	// Try clustering with initial grid size
	clusters, total, err := s.queryMapClusters(ctx, params.Bounds, gridSize)
	if err != nil {
		return nil, err
	}

	// If too many clusters, increase grid size and retry (max 3 iterations)
	for i := 0; i < 3 && len(clusters) > maxClusters; i++ {
		gridSize *= 2
		clusters, total, err = s.queryMapClusters(ctx, params.Bounds, gridSize)
		if err != nil {
			return nil, err
		}
	}

	return &MapClustersResult{
		Clusters: clusters,
		Total:    total,
	}, nil
}

// queryMapClusters executes the clustering query with a specific grid size.
func (s *Storage) queryMapClusters(ctx context.Context, bounds MapBounds, gridSize float64) ([]MapCluster, int, error) {
	// Query clusters photos by grid cells
	// For each cell: get center coordinates, count, and one preview photo ID
	query := `
		WITH grid_cells AS (
			SELECT
				FLOOR(gps_lat / $5) * $5 AS cell_lat,
				FLOOR(gps_lon / $5) * $5 AS cell_lon,
				id,
				gps_lat,
				gps_lon,
				taken_at
			FROM photos
			WHERE gps_lat IS NOT NULL
				AND gps_lon IS NOT NULL
				AND status = 'ready'
				AND gps_lat BETWEEN $1 AND $2
				AND gps_lon BETWEEN $3 AND $4
		),
		clustered AS (
			SELECT
				cell_lat,
				cell_lon,
				COUNT(*) AS count,
				AVG(gps_lat) AS center_lat,
				AVG(gps_lon) AS center_lon,
				MIN(gps_lat) AS min_lat,
				MAX(gps_lat) AS max_lat,
				MIN(gps_lon) AS min_lon,
				MAX(gps_lon) AS max_lon,
				(ARRAY_AGG(id ORDER BY taken_at DESC NULLS LAST, id DESC))[1] AS preview_id,
				CASE WHEN COUNT(*) = 1 THEN (ARRAY_AGG(id))[1] ELSE NULL END AS photo_id
			FROM grid_cells
			GROUP BY cell_lat, cell_lon
		)
		SELECT
			center_lat,
			center_lon,
			count,
			preview_id,
			photo_id,
			min_lat,
			max_lat,
			min_lon,
			max_lon
		FROM clustered
		ORDER BY count DESC
		LIMIT 500
	`

	rows, err := s.db.Query(ctx, query,
		bounds.South, bounds.North, // $1, $2: lat range
		bounds.West, bounds.East, // $3, $4: lon range
		gridSize, // $5: grid size
	)
	if err != nil {
		return nil, 0, fmt.Errorf("query map clusters: %w", err)
	}
	defer rows.Close()

	var clusters []MapCluster
	total := 0

	for rows.Next() {
		var c MapCluster
		var photoID sql.NullString
		var minLat, maxLat, minLon, maxLon float64

		if err := rows.Scan(
			&c.Lat, &c.Lon, &c.Count, &c.PreviewID, &photoID,
			&minLat, &maxLat, &minLon, &maxLon,
		); err != nil {
			return nil, 0, fmt.Errorf("scan cluster: %w", err)
		}

		total += c.Count

		if photoID.Valid {
			// Single photo - set photo_id
			c.PhotoID = &photoID.String
		} else {
			// Cluster - set bounds with small padding for better UX
			padding := gridSize * 0.1
			c.Bounds = &MapBounds{
				North: math.Min(maxLat+padding, 90),
				South: math.Max(minLat-padding, -90),
				East:  math.Min(maxLon+padding, 180),
				West:  math.Max(minLon-padding, -180),
			}
		}

		clusters = append(clusters, c)
	}

	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("iterate clusters: %w", err)
	}

	return clusters, total, nil
}

// GetMapBounds returns the bounding box containing all photos with GPS coordinates.
// Used for initial map centering.
func (s *Storage) GetMapBounds(ctx context.Context) (*MapBounds, int, error) {
	query := `
		SELECT
			MIN(gps_lat) AS min_lat,
			MAX(gps_lat) AS max_lat,
			MIN(gps_lon) AS min_lon,
			MAX(gps_lon) AS max_lon,
			COUNT(*) AS total
		FROM photos
		WHERE gps_lat IS NOT NULL
			AND gps_lon IS NOT NULL
			AND status = 'ready'
	`

	var minLat, maxLat, minLon, maxLon sql.NullFloat64
	var total int

	err := s.db.QueryRow(ctx, query).Scan(&minLat, &maxLat, &minLon, &maxLon, &total)
	if err != nil {
		return nil, 0, fmt.Errorf("query map bounds: %w", err)
	}

	if !minLat.Valid || total == 0 {
		return nil, 0, nil
	}

	return &MapBounds{
		North: maxLat.Float64,
		South: minLat.Float64,
		East:  maxLon.Float64,
		West:  minLon.Float64,
	}, total, nil
}
