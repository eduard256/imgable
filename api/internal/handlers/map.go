// Package handlers provides map-related HTTP handlers.
// This file implements endpoints for the photo map with clustering support.
package handlers

import (
	"fmt"
	"log/slog"
	"net/http"
	"strconv"

	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// MapHandler handles map-related endpoints.
type MapHandler struct {
	storage *storage.Storage
	config  *config.Config
	logger  *slog.Logger
}

// NewMapHandler creates a new MapHandler.
func NewMapHandler(store *storage.Storage, cfg *config.Config, logger *slog.Logger) *MapHandler {
	return &MapHandler{
		storage: store,
		config:  cfg,
		logger:  logger,
	}
}

// ClusterItem represents a cluster or single point in the API response.
type ClusterItem struct {
	Lat       float64          `json:"lat"`
	Lon       float64          `json:"lon"`
	Count     int              `json:"count"`
	Preview   string           `json:"preview"`
	PhotoID   *string          `json:"photo_id,omitempty"`
	Bounds    *ClusterBounds   `json:"bounds,omitempty"`
}

// ClusterBounds represents the bounds of a cluster for fetching photos.
type ClusterBounds struct {
	North float64 `json:"n"`
	South float64 `json:"s"`
	East  float64 `json:"e"`
	West  float64 `json:"w"`
}

// ClustersResponse represents the response for map clusters endpoint.
type ClustersResponse struct {
	Clusters []ClusterItem `json:"clusters"`
	Total    int           `json:"total"`
}

// BoundsResponse represents the response for map bounds endpoint.
type BoundsResponse struct {
	Bounds *ClusterBounds `json:"bounds,omitempty"`
	Total  int            `json:"total"`
}

// GetClusters handles GET /api/v1/map/clusters.
// Returns clustered photo points within the given viewport.
//
// Query parameters:
//   - north: Northern latitude boundary (required)
//   - south: Southern latitude boundary (required)
//   - east: Eastern longitude boundary (required)
//   - west: Western longitude boundary (required)
//   - zoom: Map zoom level 0-22 (required)
func (h *MapHandler) GetClusters(w http.ResponseWriter, r *http.Request) {
	// Parse and validate parameters
	params, err := h.parseClusterParams(r)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}

	// Get clusters from storage
	result, err := h.storage.GetMapClusters(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to get map clusters",
			slog.Any("error", err),
			slog.Int("zoom", params.Zoom),
		)
		response.InternalError(w)
		return
	}

	// Get auth token for photo URLs
	token := auth.GetToken(r.Context())

	// Build response with photo URLs
	clusters := make([]ClusterItem, len(result.Clusters))
	for i, c := range result.Clusters {
		clusters[i] = ClusterItem{
			Lat:     c.Lat,
			Lon:     c.Lon,
			Count:   c.Count,
			Preview: h.photoURL(c.PreviewID, "s", token),
			PhotoID: c.PhotoID,
		}

		if c.Bounds != nil {
			clusters[i].Bounds = &ClusterBounds{
				North: c.Bounds.North,
				South: c.Bounds.South,
				East:  c.Bounds.East,
				West:  c.Bounds.West,
			}
		}
	}

	response.OK(w, ClustersResponse{
		Clusters: clusters,
		Total:    result.Total,
	})
}

// GetBounds handles GET /api/v1/map/bounds.
// Returns the bounding box containing all photos with GPS data.
// Used for initial map centering.
func (h *MapHandler) GetBounds(w http.ResponseWriter, r *http.Request) {
	bounds, total, err := h.storage.GetMapBounds(r.Context())
	if err != nil {
		h.logger.Error("failed to get map bounds", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	resp := BoundsResponse{Total: total}
	if bounds != nil {
		resp.Bounds = &ClusterBounds{
			North: bounds.North,
			South: bounds.South,
			East:  bounds.East,
			West:  bounds.West,
		}
	}

	response.OK(w, resp)
}

// parseClusterParams extracts and validates cluster query parameters.
func (h *MapHandler) parseClusterParams(r *http.Request) (storage.MapClusterParams, error) {
	q := r.URL.Query()

	north, err := parseFloat(q.Get("north"), "north")
	if err != nil {
		return storage.MapClusterParams{}, err
	}

	south, err := parseFloat(q.Get("south"), "south")
	if err != nil {
		return storage.MapClusterParams{}, err
	}

	east, err := parseFloat(q.Get("east"), "east")
	if err != nil {
		return storage.MapClusterParams{}, err
	}

	west, err := parseFloat(q.Get("west"), "west")
	if err != nil {
		return storage.MapClusterParams{}, err
	}

	zoom, err := parseInt(q.Get("zoom"), "zoom")
	if err != nil {
		return storage.MapClusterParams{}, err
	}

	// Validate ranges
	if north < -90 || north > 90 {
		return storage.MapClusterParams{}, fmt.Errorf("north must be between -90 and 90")
	}
	if south < -90 || south > 90 {
		return storage.MapClusterParams{}, fmt.Errorf("south must be between -90 and 90")
	}
	if east < -180 || east > 180 {
		return storage.MapClusterParams{}, fmt.Errorf("east must be between -180 and 180")
	}
	if west < -180 || west > 180 {
		return storage.MapClusterParams{}, fmt.Errorf("west must be between -180 and 180")
	}
	if south > north {
		return storage.MapClusterParams{}, fmt.Errorf("south must be less than north")
	}
	if zoom < 0 || zoom > 22 {
		return storage.MapClusterParams{}, fmt.Errorf("zoom must be between 0 and 22")
	}

	return storage.MapClusterParams{
		Bounds: storage.MapBounds{
			North: north,
			South: south,
			East:  east,
			West:  west,
		},
		Zoom: zoom,
	}, nil
}

// photoURL generates a URL for a photo preview.
func (h *MapHandler) photoURL(id, size, token string) string {
	if len(id) < 4 {
		return ""
	}
	return fmt.Sprintf("/photos/%s/%s/%s_%s.webp?token=%s",
		id[:2], id[2:4], id, size, token)
}

// parseFloat parses a required float parameter.
func parseFloat(s, name string) (float64, error) {
	if s == "" {
		return 0, fmt.Errorf("%s is required", name)
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid number", name)
	}
	return v, nil
}

// parseInt parses a required int parameter.
func parseInt(s, name string) (int, error) {
	if s == "" {
		return 0, fmt.Errorf("%s is required", name)
	}
	v, err := strconv.Atoi(s)
	if err != nil {
		return 0, fmt.Errorf("%s must be a valid integer", name)
	}
	return v, nil
}
