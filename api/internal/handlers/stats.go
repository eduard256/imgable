// Package handlers provides statistics HTTP handlers.
package handlers

import (
	"log/slog"
	"net/http"

	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// StatsHandler handles statistics endpoints.
type StatsHandler struct {
	storage *storage.Storage
	logger  *slog.Logger
}

// NewStatsHandler creates a new StatsHandler.
func NewStatsHandler(store *storage.Storage, logger *slog.Logger) *StatsHandler {
	return &StatsHandler{
		storage: store,
		logger:  logger,
	}
}

// StatsResponse represents the statistics response.
type StatsResponse struct {
	TotalPhotos    int64           `json:"total_photos"`
	TotalVideos    int64           `json:"total_videos"`
	TotalAlbums    int64           `json:"total_albums"`
	TotalPlaces    int64           `json:"total_places"`
	TotalFavorites int64           `json:"total_favorites"`
	Storage        StorageStats    `json:"storage"`
	Dates          DateRangeStats  `json:"dates"`
}

// StorageStats represents storage statistics.
type StorageStats struct {
	Bytes int64  `json:"bytes"`
	Human string `json:"human"`
}

// DateRangeStats represents date range of photos.
type DateRangeStats struct {
	Oldest *int64 `json:"oldest,omitempty"`
	Newest *int64 `json:"newest,omitempty"`
}

// Get handles GET /api/v1/stats.
func (h *StatsHandler) Get(w http.ResponseWriter, r *http.Request) {
	stats, err := h.storage.GetStats(r.Context())
	if err != nil {
		h.logger.Error("failed to get stats", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	resp := StatsResponse{
		TotalPhotos:    stats.TotalPhotos,
		TotalVideos:    stats.TotalVideos,
		TotalAlbums:    stats.TotalAlbums,
		TotalPlaces:    stats.TotalPlaces,
		TotalFavorites: stats.TotalFavorites,
		Storage: StorageStats{
			Bytes: stats.StorageBytes,
			Human: stats.StorageHuman,
		},
	}

	if stats.OldestPhoto != nil {
		ts := stats.OldestPhoto.Unix()
		resp.Dates.Oldest = &ts
	}
	if stats.NewestPhoto != nil {
		ts := stats.NewestPhoto.Unix()
		resp.Dates.Newest = &ts
	}

	response.OK(w, resp)
}
