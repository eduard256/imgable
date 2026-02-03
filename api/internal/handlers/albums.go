// Package handlers provides album-related HTTP handlers.
package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// AlbumsHandler handles album-related endpoints.
type AlbumsHandler struct {
	storage *storage.Storage
	config  *config.Config
	logger  *slog.Logger
}

// NewAlbumsHandler creates a new AlbumsHandler.
func NewAlbumsHandler(store *storage.Storage, cfg *config.Config, logger *slog.Logger) *AlbumsHandler {
	return &AlbumsHandler{
		storage: store,
		config:  cfg,
		logger:  logger,
	}
}

// AlbumListItem represents an album in the list response.
type AlbumListItem struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
	PhotoCount  int     `json:"photo_count"`
	Cover       *string `json:"cover,omitempty"`
	CreatedAt   int64   `json:"created_at"`
	UpdatedAt   int64   `json:"updated_at"`
}

// AlbumsResponse represents the response for listing albums.
type AlbumsResponse struct {
	Albums []AlbumListItem `json:"albums"`
}

// List handles GET /api/v1/albums.
func (h *AlbumsHandler) List(w http.ResponseWriter, r *http.Request) {
	albums, err := h.storage.ListAlbums(r.Context())
	if err != nil {
		h.logger.Error("failed to list albums", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	token := auth.GetToken(r.Context())

	items := make([]AlbumListItem, len(albums))
	for i, a := range albums {
		items[i] = AlbumListItem{
			ID:          a.ID,
			Type:        a.Type,
			Name:        a.Name,
			Description: a.Description,
			PhotoCount:  a.PhotoCount,
			CreatedAt:   a.CreatedAt.Unix(),
			UpdatedAt:   a.UpdatedAt.Unix(),
		}
		if a.CoverID != nil {
			coverURL := h.photoURL(*a.CoverID, "s", token)
			items[i].Cover = &coverURL
		}
	}

	response.OK(w, AlbumsResponse{Albums: items})
}

// CreateAlbumRequest represents album creation request.
type CreateAlbumRequest struct {
	Name        string  `json:"name"`
	Description *string `json:"description,omitempty"`
}

// CreateAlbumResponse represents album creation response.
type CreateAlbumResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`
}

// Create handles POST /api/v1/albums.
func (h *AlbumsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateAlbumRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	if req.Name == "" {
		response.BadRequest(w, "name is required")
		return
	}

	id, err := h.storage.CreateAlbum(r.Context(), storage.CreateAlbumParams{
		Name:        req.Name,
		Description: req.Description,
	})
	if err != nil {
		h.logger.Error("failed to create album", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.Created(w, CreateAlbumResponse{
		ID:     id,
		Status: "ok",
	})
}

// AlbumDetailResponse represents album details with photos.
type AlbumDetailResponse struct {
	Album      AlbumListItem `json:"album"`
	Photos     []PhotoItem   `json:"photos"`
	NextCursor string        `json:"next_cursor,omitempty"`
	HasMore    bool          `json:"has_more"`
}

// Get handles GET /api/v1/albums/:id.
func (h *AlbumsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	album, err := h.storage.GetAlbum(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get album", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if album == nil {
		response.NotFound(w, "album not found")
		return
	}

	// Parse pagination params
	limit := parseIntParam(r, "limit", 100)
	var cursor *storage.PhotoCursor
	if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
		cursor = storage.DecodeCursor(cursorStr)
	}

	photos, nextCursor, err := h.storage.GetAlbumPhotos(r.Context(), id, limit, cursor)
	if err != nil {
		h.logger.Error("failed to get album photos", slog.Any("error", err))
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

	resp := AlbumDetailResponse{
		Album: AlbumListItem{
			ID:          album.ID,
			Type:        album.Type,
			Name:        album.Name,
			Description: album.Description,
			PhotoCount:  album.PhotoCount,
			CreatedAt:   album.CreatedAt.Unix(),
			UpdatedAt:   album.UpdatedAt.Unix(),
		},
		Photos:  photoItems,
		HasMore: nextCursor != nil,
	}
	if nextCursor != nil {
		resp.NextCursor = storage.EncodeCursor(nextCursor)
	}

	response.OK(w, resp)
}

// UpdateAlbumRequest represents album update request.
type UpdateAlbumRequest struct {
	Name         *string `json:"name,omitempty"`
	Description  *string `json:"description,omitempty"`
	CoverPhotoID *string `json:"cover_photo_id,omitempty"`
}

// Update handles PATCH /api/v1/albums/:id.
func (h *AlbumsHandler) Update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req UpdateAlbumRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	err := h.storage.UpdateAlbum(r.Context(), id, storage.UpdateAlbumParams{
		Name:         req.Name,
		Description:  req.Description,
		CoverPhotoID: req.CoverPhotoID,
	})
	if err != nil {
		if err.Error() == "album not found" {
			response.NotFound(w, "album not found")
			return
		}
		if err.Error() == "cannot modify system album" {
			response.Forbidden(w, "cannot modify system album")
			return
		}
		h.logger.Error("failed to update album", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OKStatus(w)
}

// Delete handles DELETE /api/v1/albums/:id.
func (h *AlbumsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	err := h.storage.DeleteAlbum(r.Context(), id)
	if err != nil {
		if err.Error() == "cannot delete favorites album" {
			response.Forbidden(w, "cannot delete system album")
			return
		}
		h.logger.Error("failed to delete album", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OKStatus(w)
}

// AddPhotosRequest represents request to add photos to album.
type AddPhotosRequest struct {
	PhotoIDs []string `json:"photo_ids"`
}

// AddPhotosResponse represents response after adding photos.
type AddPhotosResponse struct {
	Status string `json:"status"`
	Added  int    `json:"added"`
}

// AddPhotos handles POST /api/v1/albums/:id/photos.
func (h *AlbumsHandler) AddPhotos(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	var req AddPhotosRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	if len(req.PhotoIDs) == 0 {
		response.BadRequest(w, "photo_ids is required")
		return
	}

	// Check album exists
	album, err := h.storage.GetAlbum(r.Context(), id)
	if err != nil {
		h.logger.Error("failed to get album", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if album == nil {
		response.NotFound(w, "album not found")
		return
	}

	added, err := h.storage.AddPhotosToAlbum(r.Context(), id, req.PhotoIDs)
	if err != nil {
		h.logger.Error("failed to add photos to album", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OK(w, AddPhotosResponse{
		Status: "ok",
		Added:  added,
	})
}

// RemovePhoto handles DELETE /api/v1/albums/:id/photos/:photoId.
func (h *AlbumsHandler) RemovePhoto(w http.ResponseWriter, r *http.Request) {
	albumID := chi.URLParam(r, "id")
	photoID := chi.URLParam(r, "photoId")

	err := h.storage.RemovePhotoFromAlbum(r.Context(), albumID, photoID)
	if err != nil {
		h.logger.Error("failed to remove photo from album", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OKStatus(w)
}

// photoURL generates a URL for a photo preview.
func (h *AlbumsHandler) photoURL(id, size, token string) string {
	return fmt.Sprintf("/photos/%s/%s/%s_%s.webp?token=%s",
		id[:2], id[2:4], id, size, token)
}
