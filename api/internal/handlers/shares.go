// Package handlers provides share-related HTTP handlers.
package handlers

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"path/filepath"

	"github.com/go-chi/chi/v5"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// SharesHandler handles share-related endpoints.
type SharesHandler struct {
	storage *storage.Storage
	config  *config.Config
	logger  *slog.Logger
}

// NewSharesHandler creates a new SharesHandler.
func NewSharesHandler(store *storage.Storage, cfg *config.Config, logger *slog.Logger) *SharesHandler {
	return &SharesHandler{
		storage: store,
		config:  cfg,
		logger:  logger,
	}
}

// ShareListItem represents a share in the list response.
type ShareListItem struct {
	ID          string  `json:"id"`
	Type        string  `json:"type"`
	PhotoID     *string `json:"photo_id,omitempty"`
	AlbumID     *string `json:"album_id,omitempty"`
	Code        string  `json:"code"`
	URL         string  `json:"url"`
	HasPassword bool    `json:"has_password"`
	ExpiresAt   *int64  `json:"expires_at,omitempty"`
	ViewCount   int     `json:"view_count"`
	CreatedAt   int64   `json:"created_at"`
}

// SharesResponse represents the response for listing shares.
type SharesResponse struct {
	Shares []ShareListItem `json:"shares"`
}

// List handles GET /api/v1/shares.
func (h *SharesHandler) List(w http.ResponseWriter, r *http.Request) {
	shares, err := h.storage.ListShares(r.Context())
	if err != nil {
		h.logger.Error("failed to list shares", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	items := make([]ShareListItem, len(shares))
	for i, s := range shares {
		items[i] = ShareListItem{
			ID:          s.ID,
			Type:        s.Type,
			PhotoID:     s.PhotoID,
			AlbumID:     s.AlbumID,
			Code:        s.Code,
			URL:         "/s/" + s.Code,
			HasPassword: s.HasPassword,
			ViewCount:   s.ViewCount,
			CreatedAt:   s.CreatedAt.Unix(),
		}
		if s.ExpiresAt != nil {
			ts := s.ExpiresAt.Unix()
			items[i].ExpiresAt = &ts
		}
	}

	response.OK(w, SharesResponse{Shares: items})
}

// CreateShareRequest represents share creation request.
type CreateShareRequest struct {
	Type        string  `json:"type"`
	PhotoID     *string `json:"photo_id,omitempty"`
	AlbumID     *string `json:"album_id,omitempty"`
	Password    *string `json:"password,omitempty"`
	ExpiresDays *int    `json:"expires_days,omitempty"`
}

// CreateShareResponse represents share creation response.
type CreateShareResponse struct {
	ID          string `json:"id"`
	Code        string `json:"code"`
	URL         string `json:"url"`
	HasPassword bool   `json:"has_password"`
	ExpiresAt   *int64 `json:"expires_at,omitempty"`
}

// Create handles POST /api/v1/shares.
func (h *SharesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req CreateShareRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		response.BadRequest(w, "invalid request body")
		return
	}

	// Validate request
	if req.Type != "photo" && req.Type != "album" {
		response.BadRequest(w, "type must be 'photo' or 'album'")
		return
	}

	if req.Type == "photo" && req.PhotoID == nil {
		response.BadRequest(w, "photo_id is required for photo shares")
		return
	}

	if req.Type == "album" && req.AlbumID == nil {
		response.BadRequest(w, "album_id is required for album shares")
		return
	}

	// Verify photo/album exists
	if req.Type == "photo" {
		exists, err := h.storage.PhotoExists(r.Context(), *req.PhotoID)
		if err != nil {
			h.logger.Error("failed to check photo", slog.Any("error", err))
			response.InternalError(w)
			return
		}
		if !exists {
			response.NotFound(w, "photo not found")
			return
		}
	} else {
		album, err := h.storage.GetAlbum(r.Context(), *req.AlbumID)
		if err != nil {
			h.logger.Error("failed to check album", slog.Any("error", err))
			response.InternalError(w)
			return
		}
		if album == nil {
			response.NotFound(w, "album not found")
			return
		}
	}

	share, err := h.storage.CreateShare(r.Context(), storage.CreateShareParams{
		Type:        req.Type,
		PhotoID:     req.PhotoID,
		AlbumID:     req.AlbumID,
		Password:    req.Password,
		ExpiresDays: req.ExpiresDays,
	})
	if err != nil {
		h.logger.Error("failed to create share", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	resp := CreateShareResponse{
		ID:          share.ID,
		Code:        share.Code,
		URL:         "/s/" + share.Code,
		HasPassword: share.HasPassword,
	}
	if share.ExpiresAt != nil {
		ts := share.ExpiresAt.Unix()
		resp.ExpiresAt = &ts
	}

	response.Created(w, resp)
}

// Delete handles DELETE /api/v1/shares/:id.
func (h *SharesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	if err := h.storage.DeleteShare(r.Context(), id); err != nil {
		h.logger.Error("failed to delete share", slog.Any("error", err))
		response.InternalError(w)
		return
	}

	response.OKStatus(w)
}

// PublicShareResponse represents public share data.
type PublicShareResponse struct {
	Type   string      `json:"type"`
	Photo  *PublicPhoto `json:"photo,omitempty"`
	Album  *PublicAlbum `json:"album,omitempty"`
	Photos []PhotoItem  `json:"photos,omitempty"`
	NextCursor string   `json:"next_cursor,omitempty"`
	HasMore    bool     `json:"has_more,omitempty"`
}

// PublicPhoto represents photo data for public shares.
type PublicPhoto struct {
	ID       string     `json:"id"`
	Blurhash *string    `json:"blurhash,omitempty"`
	URLs     PublicURLs `json:"urls"`
	Width    *int       `json:"width,omitempty"`
	Height   *int       `json:"height,omitempty"`
	TakenAt  *int64     `json:"taken_at,omitempty"`
}

// PublicURLs contains URLs for public share.
type PublicURLs struct {
	Small string `json:"small"`
	Large string `json:"large,omitempty"`
	Video string `json:"video,omitempty"`
}

// PublicAlbum represents album data for public shares.
type PublicAlbum struct {
	Name       string `json:"name"`
	PhotoCount int    `json:"photo_count"`
}

// GetPublic handles GET /s/:code.
// This is a public endpoint that doesn't require authentication.
func (h *SharesHandler) GetPublic(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	password := r.URL.Query().Get("password")

	share, err := h.storage.GetShareByCode(r.Context(), code)
	if err != nil {
		h.logger.Error("failed to get share", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if share == nil {
		response.NotFound(w, "share not found")
		return
	}

	// Check expiration
	if storage.IsShareExpired(share) {
		response.Gone(w, "share expired")
		return
	}

	// Check password
	if !storage.ValidateSharePassword(share, password) {
		response.Unauthorized(w, "password required")
		return
	}

	// Increment view count
	h.storage.IncrementShareViewCount(r.Context(), code)

	// Build response based on share type
	resp := PublicShareResponse{Type: share.Type}

	if share.Type == "photo" {
		photo, err := h.storage.GetPhoto(r.Context(), *share.PhotoID)
		if err != nil || photo == nil {
			response.NotFound(w, "photo not found")
			return
		}

		resp.Photo = &PublicPhoto{
			ID:       photo.ID,
			Blurhash: photo.Blurhash,
			Width:    photo.Width,
			Height:   photo.Height,
			URLs: PublicURLs{
				Small: fmt.Sprintf("/s/%s/photo/small", code),
			},
		}

		if photo.Type == "photo" {
			resp.Photo.URLs.Large = fmt.Sprintf("/s/%s/photo/large", code)
		} else {
			resp.Photo.URLs.Video = fmt.Sprintf("/s/%s/photo/video", code)
		}

		if photo.TakenAt != nil {
			ts := photo.TakenAt.Unix()
			resp.Photo.TakenAt = &ts
		}
	} else {
		// Album share
		album, err := h.storage.GetAlbum(r.Context(), *share.AlbumID)
		if err != nil || album == nil {
			response.NotFound(w, "album not found")
			return
		}

		resp.Album = &PublicAlbum{
			Name:       album.Name,
			PhotoCount: album.PhotoCount,
		}

		// Get photos with pagination
		limit := parseIntParam(r, "limit", 100)
		var cursor *storage.PhotoCursor
		if cursorStr := r.URL.Query().Get("cursor"); cursorStr != "" {
			cursor = storage.DecodeCursor(cursorStr)
		}

		photos, nextCursor, err := h.storage.GetAlbumPhotos(r.Context(), *share.AlbumID, limit, cursor)
		if err != nil {
			h.logger.Error("failed to get album photos", slog.Any("error", err))
			response.InternalError(w)
			return
		}

		// Build photo items with public URLs
		resp.Photos = make([]PhotoItem, len(photos))
		for i, p := range photos {
			resp.Photos[i] = PhotoItem{
				ID:       p.ID,
				Type:     p.Type,
				Blurhash: p.Blurhash,
				Small:    fmt.Sprintf("/s/%s/photo/small?id=%s", code, p.ID),
				Width:    p.Width,
				Height:   p.Height,
				Duration: p.Duration,
			}
			if p.TakenAt != nil {
				ts := p.TakenAt.Unix()
				resp.Photos[i].TakenAt = &ts
			}
		}

		resp.HasMore = nextCursor != nil
		if nextCursor != nil {
			resp.NextCursor = storage.EncodeCursor(nextCursor)
		}
	}

	response.OK(w, resp)
}

// GetPublicPhoto handles GET /s/:code/photo/:size.
// Serves the actual photo file for a public share.
func (h *SharesHandler) GetPublicPhoto(w http.ResponseWriter, r *http.Request) {
	code := chi.URLParam(r, "code")
	size := chi.URLParam(r, "size")
	password := r.URL.Query().Get("password")
	photoIDOverride := r.URL.Query().Get("id") // For album shares with multiple photos

	share, err := h.storage.GetShareByCode(r.Context(), code)
	if err != nil {
		h.logger.Error("failed to get share", slog.Any("error", err))
		response.InternalError(w)
		return
	}
	if share == nil {
		response.NotFound(w, "share not found")
		return
	}

	// Check expiration
	if storage.IsShareExpired(share) {
		response.Gone(w, "share expired")
		return
	}

	// Check password
	if !storage.ValidateSharePassword(share, password) {
		response.Unauthorized(w, "password required")
		return
	}

	// Determine photo ID
	var photoID string
	if share.Type == "photo" {
		photoID = *share.PhotoID
	} else {
		// Album share - need photo ID from query
		if photoIDOverride == "" {
			response.BadRequest(w, "photo id required for album shares")
			return
		}
		photoID = photoIDOverride

		// TODO: Verify photo belongs to album (for security)
	}

	// Get photo info
	photo, err := h.storage.GetPhoto(r.Context(), photoID)
	if err != nil || photo == nil {
		response.NotFound(w, "photo not found")
		return
	}

	// Determine file path
	var filename string
	var contentType string

	switch size {
	case "small":
		filename = photoID + "_s.webp"
		contentType = "image/webp"
	case "large":
		filename = photoID + "_l.webp"
		contentType = "image/webp"
	case "video":
		// Try to find video file
		basePath := filepath.Join(h.config.MediaPath, photoID[:2], photoID[2:4])
		extensions := []string{".mp4", ".mov", ".avi", ".mkv", ".webm"}
		for _, ext := range extensions {
			testPath := filepath.Join(basePath, photoID+ext)
			if _, err := filepath.Abs(testPath); err == nil {
				filename = photoID + ext
				contentType = "video/mp4" // Default content type
				break
			}
		}
		if filename == "" {
			filename = photoID + ".mp4"
			contentType = "video/mp4"
		}
	default:
		response.BadRequest(w, "invalid size")
		return
	}

	filePath := filepath.Join(h.config.MediaPath, photoID[:2], photoID[2:4], filename)

	// Set headers
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")

	// Serve file
	http.ServeFile(w, r, filePath)
}
