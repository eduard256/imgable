// Package handlers provides photo-related HTTP handlers.
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// PhotosHandler handles photo-related endpoints.
type PhotosHandler struct {
	storage *storage.Storage
	config  *config.Config
	logger  *slog.Logger
}

// NewPhotosHandler creates a new PhotosHandler.
func NewPhotosHandler(store *storage.Storage, cfg *config.Config, logger *slog.Logger) *PhotosHandler {
	return &PhotosHandler{
		storage: store,
		config:  cfg,
		logger:  logger,
	}
}

// PhotoListResponse represents the response for listing photos.
type PhotoListResponse struct {
	Photos     []PhotoItem `json:"photos"`
	NextCursor string      `json:"next_cursor,omitempty"`
	HasMore    bool        `json:"has_more"`
}

// PhotoItem represents a photo in the list response.
// Optimized for minimal size (~100 bytes per photo).
type PhotoItem struct {
	ID         string  `json:"id"`
	Type       string  `json:"type"`
	Blurhash   *string `json:"blurhash,omitempty"`
	Small      string  `json:"small"`
	Width      int     `json:"w"`
	Height     int     `json:"h"`
	TakenAt    *int64  `json:"taken_at,omitempty"` // Unix timestamp for smaller JSON
	IsFavorite bool    `json:"is_favorite"`
	Duration   *int    `json:"duration,omitempty"`
	DeletedAt  *int64  `json:"deleted_at,omitempty"` // Unix timestamp, only in trash mode
}

// GroupsResponse represents photo groups response.
type GroupsResponse struct {
	Groups []storage.PhotoGroup `json:"groups"`
	Total  int                  `json:"total"`
}

// GetGroups handles GET /api/v1/photos/groups.
// Returns photo counts grouped by month.
func (h *PhotosHandler) GetGroups(w http.ResponseWriter, r *http.Request) {
	photoType := r.URL.Query().Get("type")

	groups, total, err := h.storage.GetPhotoGroups(r.Context(), photoType)
	if err != nil {
		h.logger.Error("failed to get photo groups", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, GroupsResponse{
		Groups: groups,
		Total:  total,
	})
}

// List handles GET /api/v1/photos.
// Returns paginated list of photos with cursor-based pagination.
//
// Query parameters:
//   - limit: Max photos to return (default 100, max 500)
//   - cursor: Pagination cursor
//   - month: Filter by month "2024-12" or "unknown"
//   - type: Filter by "photo" or "video"
//   - favorite: Filter by favorite status "true" or "false"
//   - sort: Sort by "date", "created", or "size"
//   - order: Sort order "desc" or "asc"
//   - north, south, east, west: Geographic bounds filter (all required together)
//   - path: Filter by folder path (returns photos from this folder and all subfolders by default)
//   - recursive: Include subfolders "true" (default) or "false" (only direct photos)
//   - trash: If "true", return only soft-deleted photos sorted by deleted_at DESC (other filters ignored)
func (h *PhotosHandler) List(w http.ResponseWriter, r *http.Request) {
	// Parse query parameters
	recursiveStr := r.URL.Query().Get("recursive")
	recursive := recursiveStr != "false" // default true
	trash := r.URL.Query().Get("trash") == "true"

	params := storage.PhotoListParams{
		Limit:           parseIntParam(r, "limit", 100),
		Month:           r.URL.Query().Get("month"),
		Type:            r.URL.Query().Get("type"),
		Sort:            r.URL.Query().Get("sort"),
		Order:           r.URL.Query().Get("order"),
		FolderPath:      r.URL.Query().Get("path"),
		FolderRecursive: recursive,
		Trash:           trash,
	}

	// Parse cursor
	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		params.Cursor = storage.DecodeCursor(cursorStr)
	}

	// Parse favorite filter
	if favStr := r.URL.Query().Get("favorite"); favStr != "" {
		fav := favStr == "true" || favStr == "1"
		params.Favorite = &fav
	}

	// Parse geographic bounds filter (for map cluster clicks)
	bounds, err := parseGeoBounds(r)
	if err != nil {
		response.BadRequest(w, err.Error())
		return
	}
	params.Bounds = bounds

	// Fetch photos
	photos, nextCursor, err := h.storage.ListPhotos(r.Context(), params)
	if err != nil {
		h.logger.Error("failed to list photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	// Get token for generating URLs
	token := auth.GetToken(r.Context())

	// Build response
	items := make([]PhotoItem, len(photos))
	for i, p := range photos {
		items[i] = PhotoItem{
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
			items[i].TakenAt = &ts
		}
		if p.DeletedAt != nil {
			ts := p.DeletedAt.Unix()
			items[i].DeletedAt = &ts
		}
	}

	resp := PhotoListResponse{
		Photos:  items,
		HasMore: nextCursor != nil,
	}
	if nextCursor != nil {
		resp.NextCursor = storage.EncodeCursor(nextCursor)
	}

	response.OK(w, resp)
}

// PhotoDetailResponse represents full photo details.
type PhotoDetailResponse struct {
	ID               string                  `json:"id"`
	Type             string                  `json:"type"`
	Blurhash         *string                 `json:"blurhash,omitempty"`
	URLs             PhotoURLs               `json:"urls"`
	Width            *int                    `json:"width,omitempty"`
	Height           *int                    `json:"height,omitempty"`
	SizeBytes        *int                    `json:"size_bytes,omitempty"`
	TakenAt          *int64                  `json:"taken_at,omitempty"`
	CreatedAt        int64                   `json:"created_at"`
	IsFavorite       bool                    `json:"is_favorite"`
	Comment          *string                 `json:"comment,omitempty"`
	OriginalFilename *string                 `json:"original_filename,omitempty"`
	DurationSec      *int                    `json:"duration_sec,omitempty"`
	VideoCodec       *string                 `json:"video_codec,omitempty"`
	EXIF             *PhotoEXIF              `json:"exif,omitempty"`
	GPS              *PhotoGPS               `json:"gps,omitempty"`
	Place            *PhotoPlace             `json:"place,omitempty"`
	Albums           []PhotoAlbum            `json:"albums,omitempty"`
}

// PhotoURLs contains URLs for different photo sizes.
type PhotoURLs struct {
	Small string `json:"small"`
	Large string `json:"large,omitempty"`
	Video string `json:"video,omitempty"`
}

// PhotoEXIF contains EXIF metadata.
type PhotoEXIF struct {
	CameraMake   *string  `json:"camera_make,omitempty"`
	CameraModel  *string  `json:"camera_model,omitempty"`
	Lens         *string  `json:"lens,omitempty"`
	ISO          *int     `json:"iso,omitempty"`
	Aperture     *float64 `json:"aperture,omitempty"`
	ShutterSpeed *string  `json:"shutter_speed,omitempty"`
	FocalLength  *float64 `json:"focal_length,omitempty"`
	Flash        *bool    `json:"flash,omitempty"`
}

// PhotoGPS contains GPS coordinates.
type PhotoGPS struct {
	Lat      *float64 `json:"lat,omitempty"`
	Lon      *float64 `json:"lon,omitempty"`
	Altitude *float64 `json:"altitude,omitempty"`
}

// PhotoPlace contains place information.
type PhotoPlace struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	City    *string `json:"city,omitempty"`
	Country *string `json:"country,omitempty"`
}

// PhotoAlbum contains album reference.
type PhotoAlbum struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// Get handles GET /api/v1/photos/:id.
// Returns full photo details.
func (h *PhotosHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	photo, err := h.storage.GetPhoto(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get photo", slog.Any("error", err), slog.String("id", id))
		response.InternalError(w)
		return
	}
	if photo == nil {
		response.NotFound(w, "photo not found")
		return
	}

	token := auth.GetToken(r.Context())

	// Build response
	resp := PhotoDetailResponse{
		ID:               photo.ID,
		Type:             photo.Type,
		Blurhash:         photo.Blurhash,
		Width:            photo.Width,
		Height:           photo.Height,
		SizeBytes:        photo.SizeOriginal,
		CreatedAt:        photo.CreatedAt.Unix(),
		IsFavorite:       photo.IsFavorite,
		Comment:          photo.Comment,
		OriginalFilename: photo.OriginalFilename,
		DurationSec:      photo.DurationSec,
		VideoCodec:       photo.VideoCodec,
	}

	if photo.TakenAt != nil {
		ts := photo.TakenAt.Unix()
		resp.TakenAt = &ts
	}

	// Build URLs
	resp.URLs = PhotoURLs{
		Small: h.photoURL(photo.ID, "s", token),
	}
	if photo.Type == "photo" {
		resp.URLs.Large = h.photoURL(photo.ID, "l", token)
	} else {
		ext := getVideoExtension(photo.OriginalFilename)
		resp.URLs.Video = h.videoURL(photo.ID, ext, token)
	}

	// Build EXIF if any field is present
	if photo.CameraMake != nil || photo.CameraModel != nil || photo.ISO != nil {
		resp.EXIF = &PhotoEXIF{
			CameraMake:   photo.CameraMake,
			CameraModel:  photo.CameraModel,
			Lens:         photo.Lens,
			ISO:          photo.ISO,
			Aperture:     photo.Aperture,
			ShutterSpeed: photo.ShutterSpeed,
			FocalLength:  photo.FocalLength,
			Flash:        photo.Flash,
		}
	}

	// Build GPS if present
	if photo.GPSLat != nil && photo.GPSLon != nil {
		resp.GPS = &PhotoGPS{
			Lat:      photo.GPSLat,
			Lon:      photo.GPSLon,
			Altitude: photo.GPSAltitude,
		}
	}

	// Get place if linked
	if photo.PlaceID != nil {
		place, err := h.storage.GetPlace(r.Context(), *photo.PlaceID)
		if err == nil && place != nil {
			resp.Place = &PhotoPlace{
				ID:      place.ID,
				Name:    place.Name,
				City:    place.City,
				Country: place.Country,
			}
		}
	}

	// Get albums containing this photo
	albums, err := h.storage.GetPhotoAlbums(r.Context(), id)
	if err == nil && len(albums) > 0 {
		resp.Albums = make([]PhotoAlbum, len(albums))
		for i, a := range albums {
			resp.Albums[i] = PhotoAlbum{ID: a.ID, Name: a.Name}
		}
	}

	response.OK(w, resp)
}

// UpdateRequest represents a photo update request.
type UpdateRequest struct {
	Comment *string `json:"comment"`
}

// Update handles PATCH /api/v1/photos/:id.
// Updates the photo comment.
func (h *PhotosHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	// Check if photo exists
	exists, err := h.storage.PhotoExists(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to check photo", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if !exists {
		response.NotFound(w, "photo not found")
		return
	}

	if err := h.storage.UpdatePhotoComment(r.Context(), id, req.Comment); err != nil {
		h.logger.Error("failed to update photo", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OKStatus(w)
}

// Delete handles DELETE /api/v1/photos/:id.
// Soft-deletes a photo (moves to trash).
func (h *PhotosHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	found, err := h.storage.SoftDeletePhoto(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to soft-delete photo", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if !found {
		response.NotFound(w, "photo not found")
		return
	}

	response.OKStatus(w)
}

// BulkDeleteRequest represents bulk delete request.
type BulkDeleteRequest struct {
	IDs []string `json:"ids"`
}

// BulkDeleteResponse represents bulk delete response.
type BulkDeleteResponse struct {
	Deleted int `json:"deleted"`
}

// BulkDelete handles DELETE /api/v1/photos.
// Soft-deletes multiple photos at once (moves to trash).
func (h *PhotosHandler) BulkDelete(w http.ResponseWriter, r *http.Request) {
	var req BulkDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	if len(req.IDs) == 0 {
		response.BadRequest(w, "ids is required")
		return
	}

	if len(req.IDs) > 100 {
		response.BadRequest(w, "maximum 100 photos per request")
		return
	}

	deleted, err := h.storage.SoftDeletePhotos(r.Context(), req.IDs)
	if err != nil {
		h.logger.Error("failed to soft-delete photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, BulkDeleteResponse{Deleted: int(deleted)})
}

// TrashDeleteRequest represents a request to permanently delete photos from trash.
// If IDs is empty, all photos in trash are deleted.
type TrashDeleteRequest struct {
	IDs []string `json:"ids"`
}

// TrashDeleteResponse represents the response after permanently deleting from trash.
type TrashDeleteResponse struct {
	Deleted int `json:"deleted"`
}

// TrashDelete handles DELETE /api/v1/trash.
// Permanently deletes photos from trash and removes files from disk.
// If ids are provided, deletes only those photos. If ids are empty, clears entire trash.
func (h *PhotosHandler) TrashDelete(w http.ResponseWriter, r *http.Request) {
	var req TrashDeleteRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		// Empty body is fine -- means "delete all"
		req.IDs = nil
	}

	if len(req.IDs) > 100 {
		response.BadRequest(w, "maximum 100 photos per request")
		return
	}

	photos, err := h.storage.PermanentDeletePhotos(r.Context(), req.IDs)
	if err != nil {
		h.logger.Error("failed to permanently delete photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	// Delete files from disk
	for _, photo := range photos {
		h.deletePhotoFiles(&photo)
	}

	response.OK(w, TrashDeleteResponse{Deleted: len(photos)})
}

// TrashRestoreRequest represents a request to restore photos from trash.
type TrashRestoreRequest struct {
	IDs []string `json:"ids"`
}

// TrashRestoreResponse represents the response after restoring photos.
type TrashRestoreResponse struct {
	Restored int `json:"restored"`
}

// TrashRestore handles POST /api/v1/trash/restore.
// Restores soft-deleted photos back to the library.
func (h *PhotosHandler) TrashRestore(w http.ResponseWriter, r *http.Request) {
	var req TrashRestoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	if len(req.IDs) == 0 {
		response.BadRequest(w, "ids is required")
		return
	}

	if len(req.IDs) > 100 {
		response.BadRequest(w, "maximum 100 photos per request")
		return
	}

	restored, err := h.storage.RestorePhotos(r.Context(), req.IDs)
	if err != nil {
		h.logger.Error("failed to restore photos", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, TrashRestoreResponse{Restored: int(restored)})
}

// AddFavorite handles POST /api/v1/photos/:id/favorite.
func (h *PhotosHandler) AddFavorite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	exists, err := h.storage.PhotoExists(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to check photo", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if !exists {
		response.NotFound(w, "photo not found")
		return
	}

	if err := h.storage.SetPhotoFavorite(r.Context(), id, true); err != nil {
		h.logger.Error("failed to add favorite", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, map[string]interface{}{"status": "ok", "is_favorite": true})
}

// RemoveFavorite handles DELETE /api/v1/photos/:id/favorite.
func (h *PhotosHandler) RemoveFavorite(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	exists, err := h.storage.PhotoExists(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to check photo", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if !exists {
		response.NotFound(w, "photo not found")
		return
	}

	if err := h.storage.SetPhotoFavorite(r.Context(), id, false); err != nil {
		h.logger.Error("failed to remove favorite", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, map[string]interface{}{"status": "ok", "is_favorite": false})
}

// photoURL generates a URL for a photo preview.
func (h *PhotosHandler) photoURL(id, size, token string) string {
	return fmt.Sprintf("/photos/%s/%s/%s_%s.webp?token=%s",
		id[:2], id[2:4], id, size, token)
}

// videoURL generates a URL for a video file.
func (h *PhotosHandler) videoURL(id, ext, token string) string {
	return fmt.Sprintf("/photos/%s/%s/%s%s?token=%s",
		id[:2], id[2:4], id, ext, token)
}

// getVideoExtension extracts video extension from original filename.
// Returns ".mp4" as default if extension cannot be determined.
func getVideoExtension(filename *string) string {
	if filename == nil || *filename == "" {
		return ".mp4"
	}
	ext := filepath.Ext(*filename)
	if ext == "" {
		return ".mp4"
	}
	return ext
}

// deletePhotoFiles removes photo files from disk.
func (h *PhotosHandler) deletePhotoFiles(photo *storage.Photo) {
	deletePhotoFilesFromDisk(h.config.MediaPath, photo)
}

// parseIntParam parses an integer query parameter with default.
func parseIntParam(r *http.Request, name string, defaultVal int) int {
	if val := r.URL.Query().Get(name); val != "" {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

// parseGeoBounds parses geographic bounds from query parameters.
// Returns nil if no bounds parameters are provided.
// Returns error if bounds are partially provided or invalid.
func parseGeoBounds(r *http.Request) (*storage.GeoBounds, error) {
	q := r.URL.Query()
	northStr := q.Get("north")
	southStr := q.Get("south")
	eastStr := q.Get("east")
	westStr := q.Get("west")

	// Check if any bounds parameter is provided
	hasAny := northStr != "" || southStr != "" || eastStr != "" || westStr != ""
	if !hasAny {
		return nil, nil
	}

	// If any is provided, all must be provided
	if northStr == "" || southStr == "" || eastStr == "" || westStr == "" {
		return nil, fmt.Errorf("all bounds parameters (north, south, east, west) are required together")
	}

	north, err := strconv.ParseFloat(northStr, 64)
	if err != nil {
		return nil, fmt.Errorf("north must be a valid number")
	}

	south, err := strconv.ParseFloat(southStr, 64)
	if err != nil {
		return nil, fmt.Errorf("south must be a valid number")
	}

	east, err := strconv.ParseFloat(eastStr, 64)
	if err != nil {
		return nil, fmt.Errorf("east must be a valid number")
	}

	west, err := strconv.ParseFloat(westStr, 64)
	if err != nil {
		return nil, fmt.Errorf("west must be a valid number")
	}

	// Validate ranges
	if north < -90 || north > 90 || south < -90 || south > 90 {
		return nil, fmt.Errorf("latitude must be between -90 and 90")
	}
	if east < -180 || east > 180 || west < -180 || west > 180 {
		return nil, fmt.Errorf("longitude must be between -180 and 180")
	}
	if south > north {
		return nil, fmt.Errorf("south must be less than north")
	}

	return &storage.GeoBounds{
		North: north,
		South: south,
		East:  east,
		West:  west,
	}, nil
}

// StartTrashCleanup starts a background goroutine that permanently deletes
// photos that have been in trash longer than maxAge.
// Runs every hour, deletes files from disk and records from the database.
func StartTrashCleanup(ctx context.Context, store *storage.Storage, cfg *config.Config, logger *slog.Logger, maxAge time.Duration) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			photos, err := store.PurgeExpiredTrash(ctx, maxAge)
			if err != nil {
				logger.Error("failed to purge expired trash", slog.Any("error", err))
				continue
			}
			if len(photos) > 0 {
				// Delete files from disk
				for _, photo := range photos {
					deletePhotoFilesFromDisk(cfg.MediaPath, &photo)
				}
				logger.Info("purged expired trash", slog.Int("deleted", len(photos)))
			}
		}
	}
}

// deletePhotoFilesFromDisk removes photo files from disk given a media path.
// Standalone function usable from both handlers and background goroutines.
func deletePhotoFilesFromDisk(mediaPath string, photo *storage.Photo) {
	basePath := filepath.Join(mediaPath, photo.ID[:2], photo.ID[2:4])

	// Delete previews
	os.Remove(filepath.Join(basePath, photo.ID+"_s.webp"))
	if photo.Type == "photo" {
		os.Remove(filepath.Join(basePath, photo.ID+"_l.webp"))
	}

	// Delete video original
	if photo.Type == "video" {
		os.Remove(filepath.Join(basePath, photo.ID+".mp4"))
		os.Remove(filepath.Join(basePath, photo.ID+".mov"))
		os.Remove(filepath.Join(basePath, photo.ID+".avi"))
		os.Remove(filepath.Join(basePath, photo.ID+".mkv"))
		os.Remove(filepath.Join(basePath, photo.ID+".webm"))
	}
}
