// Package handlers provides place-related HTTP handlers.
package handlers

import (
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// PlacesHandler handles place-related endpoints.
type PlacesHandler struct {
	storage *storage.Storage
	config  *config.Config
	logger  *slog.Logger
}

// NewPlacesHandler creates a new PlacesHandler.
func NewPlacesHandler(store *storage.Storage, cfg *config.Config, logger *slog.Logger) *PlacesHandler {
	return &PlacesHandler{
		storage: store,
		config:  cfg,
		logger:  logger,
	}
}

// PlaceListItem represents a place in the list response.
type PlaceListItem struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	City       *string `json:"city,omitempty"`
	Country    *string `json:"country,omitempty"`
	GPSLat     float64 `json:"gps_lat"`
	GPSLon     float64 `json:"gps_lon"`
	PhotoCount int     `json:"photo_count"`
}

// PlacesResponse represents the response for listing places.
type PlacesResponse struct {
	Places []PlaceListItem `json:"places"`
}

// List handles GET /api/v1/places.
func (h *PlacesHandler) List(w http.ResponseWriter, r *http.Request) {
	places, err := h.storage.ListPlaces(r.Context())
	if err != nil {
		h.logger.Error("failed to list places", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	items := make([]PlaceListItem, len(places))
	for i, p := range places {
		items[i] = PlaceListItem{
			ID:         p.ID,
			Name:       p.Name,
			City:       p.City,
			Country:    p.Country,
			GPSLat:     p.GPSLat,
			GPSLon:     p.GPSLon,
			PhotoCount: p.PhotoCount,
		}
	}

	response.OK(w, PlacesResponse{Places: items})
}

// PlaceDetailResponse represents place details with photos.
type PlaceDetailResponse struct {
	Place      PlaceDetail `json:"place"`
	Photos     []PhotoItem `json:"photos"`
	NextCursor string      `json:"next_cursor,omitempty"`
	HasMore    bool        `json:"has_more"`
}

// PlaceDetail represents full place information.
type PlaceDetail struct {
	ID         string  `json:"id"`
	Name       string  `json:"name"`
	City       *string `json:"city,omitempty"`
	Country    *string `json:"country,omitempty"`
	Address    *string `json:"address,omitempty"`
	GPSLat     float64 `json:"gps_lat"`
	GPSLon     float64 `json:"gps_lon"`
	PhotoCount int     `json:"photo_count"`
}

// Get handles GET /api/v1/places/:id.
func (h *PlacesHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	place, err := h.storage.GetPlace(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get place", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if place == nil {
		response.NotFound(w, "place not found")
		return
	}

	// Parse pagination params
	limit := parseIntParam(r, "limit", 100)
	var cursor *storage.PhotoCursor
	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		cursor = storage.DecodeCursor(cursorStr)
	}

	photos, nextCursor, err := h.storage.GetPlacePhotos(r.Context(), id, limit, cursor)
	if err != nil {
		h.logger.Error("failed to get place photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())

	// Build response
	photoItems := make([]PhotoItem, len(photos))
	for i, p := range photos {
		photoItems[i] = PhotoItem{
			ID:         p.ID,
			Type:       p.Type,
			Blurhash:   p.Blurhash,
			Small:      h.photoURL(p.ID, "s", token),
			Width:      p.Width,
			Height:     p.Height,
			IsFavorite: p.IsFavorite,
			Duration:   p.Duration,
		}
		if p.TakenAt != nil {
			ts := p.TakenAt.Unix()
			photoItems[i].TakenAt = &ts
		}
	}

	resp := PlaceDetailResponse{
		Place: PlaceDetail{
			ID:         place.ID,
			Name:       place.Name,
			City:       place.City,
			Country:    place.Country,
			Address:    place.Address,
			GPSLat:     place.GPSLat,
			GPSLon:     place.GPSLon,
			PhotoCount: place.PhotoCount,
		},
		Photos:  photoItems,
		HasMore: nextCursor != nil,
	}
	if nextCursor != nil {
		resp.NextCursor = storage.EncodeCursor(nextCursor)
	}

	response.OK(w, resp)
}

// MapResponse represents map data response.
type MapResponse struct {
	Markers []storage.MapMarker `json:"markers"`
	Bounds  *storage.MapBounds  `json:"bounds,omitempty"`
}

// GetMap handles GET /api/v1/map.
func (h *PlacesHandler) GetMap(w http.ResponseWriter, r *http.Request) {
	markers, bounds, err := h.storage.GetMapData(r.Context())
	if err != nil {
		h.logger.Error("failed to get map data", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, MapResponse{
		Markers: markers,
		Bounds:  bounds,
	})
}

// photoURL generates a URL for a photo preview.
func (h *PlacesHandler) photoURL(id, size, token string) string {
	return fmt.Sprintf("/photos/%s/%s/%s_%s.webp?token=%s",
		id[:2], id[2:4], id, size, token)
}
