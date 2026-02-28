// Package handlers provides folder-related HTTP handlers.
// Folders represent the original import directory structure of photos,
// allowing users to browse photos by their source filesystem layout.
package handlers

import (
	"log/slog"
	"net/http"

	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// FoldersHandler handles folder-related endpoints.
type FoldersHandler struct {
	storage *storage.Storage
	logger  *slog.Logger
}

// NewFoldersHandler creates a new FoldersHandler.
func NewFoldersHandler(store *storage.Storage, logger *slog.Logger) *FoldersHandler {
	return &FoldersHandler{
		storage: store,
		logger:  logger,
	}
}

// FolderItem represents a folder in the API response.
type FolderItem struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	PhotoCount int    `json:"photo_count"`
}

// FoldersResponse represents the response for the folders endpoint.
type FoldersResponse struct {
	Path       string       `json:"path"`
	Folders    []FolderItem `json:"folders"`
	PhotoCount int          `json:"photo_count"`
}

// List handles GET /api/v1/folders.
// Returns subfolders and direct photo count for the given path.
//
// Query parameters:
//   - path: Folder path to browse (default "/" for root)
//
// The folder tree is derived from photos.original_path values in the database.
// Files without a directory (e.g. web uploads) are placed in a virtual "root" folder.
func (h *FoldersHandler) List(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Query().Get("path")
	if path == "" {
		path = "/"
	}

	listing, err := h.storage.GetFolderListing(r.Context(), path)
	if err != nil {
		h.logger.Error("failed to get folder listing",
			slog.Any("error", err),
			slog.String("path", path),
		)
		response.InternalError(w)
		return
	}

	// Build response
	folders := make([]FolderItem, len(listing.Folders))
	for i, f := range listing.Folders {
		folders[i] = FolderItem{
			Name:       f.Name,
			Path:       f.Path,
			PhotoCount: f.PhotoCount,
		}
	}

	response.OK(w, FoldersResponse{
		Path:       listing.Path,
		Folders:    folders,
		PhotoCount: listing.PhotoCount,
	})
}
