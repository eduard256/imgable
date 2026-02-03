// Package files provides static file serving for the Imgable API.
// It handles serving photo/video files with token authentication
// and the React SPA with fallback routing.
package files

import (
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
)

// Handler handles static file serving.
type Handler struct {
	config  *config.Config
	jwtAuth *auth.JWTAuth
	logger  *slog.Logger
}

// NewHandler creates a new file handler.
func NewHandler(cfg *config.Config, jwtAuth *auth.JWTAuth, logger *slog.Logger) *Handler {
	return &Handler{
		config:  cfg,
		jwtAuth: jwtAuth,
		logger:  logger,
	}
}

// ServePhoto handles GET /photos/:p1/:p2/:filename.
// Serves photo/video files with JWT token authentication from query parameter.
//
// This endpoint uses http.ServeFile which utilizes sendfile() syscall
// for zero-copy file transfer directly from disk to network socket.
//
// Headers set:
//   - Content-Type: image/webp or video/mp4
//   - Cache-Control: private, max-age=86400 (1 day)
//   - ETag: based on filename (content-addressable)
func (h *Handler) ServePhoto(w http.ResponseWriter, r *http.Request) {
	// Extract path parameters
	p1 := chi.URLParam(r, "p1")
	p2 := chi.URLParam(r, "p2")
	filename := chi.URLParam(r, "filename")

	// Validate path components (prevent directory traversal)
	if !isValidPathComponent(p1) || !isValidPathComponent(p2) || !isValidFilename(filename) {
		response.BadRequest(w, "invalid path")
		return
	}

	// Validate token from query parameter
	token := r.URL.Query().Get("token")
	if token == "" {
		response.Unauthorized(w, "missing token")
		return
	}

	_, err := h.jwtAuth.ValidateToken(token)
	if err != nil {
		if err == auth.ErrExpiredToken {
			response.Unauthorized(w, "token expired")
		} else {
			response.Unauthorized(w, "invalid token")
		}
		return
	}

	// Build file path
	filePath := filepath.Join(h.config.MediaPath, p1, p2, filename)

	// Check file exists
	stat, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			response.NotFound(w, "file not found")
		} else {
			h.logger.Error("stat file failed", slog.Any("error", err))
			response.InternalError(w)
		}
		return
	}

	// Determine content type from extension
	contentType := getContentType(filename)

	// Set headers for caching
	// Photos are content-addressable (ID = hash), so they never change
	// Cache for 1 day with private directive (only browser, not CDN)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("ETag", `"`+filename+`"`)

	// Check If-None-Match for 304 response
	if match := r.Header.Get("If-None-Match"); match != "" {
		if match == `"`+filename+`"` || match == filename {
			w.WriteHeader(http.StatusNotModified)
			return
		}
	}

	// Mark stat as used (we need it only for existence check above)
	_ = stat

	// Serve file using http.ServeFile (uses sendfile syscall)
	// This is the most efficient way to serve files in Go
	http.ServeFile(w, r, filePath)
}

// ServeSPA handles all unmatched routes by serving the React SPA.
// For API routes, it returns 404 JSON. For all other routes, it serves index.html.
func (h *Handler) ServeSPA(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path

	// API routes should return JSON 404
	if strings.HasPrefix(path, "/api/") {
		response.NotFound(w, "endpoint not found")
		return
	}

	// Try to serve static file first
	staticPath := filepath.Join(h.config.StaticPath, path)
	if info, err := os.Stat(staticPath); err == nil && !info.IsDir() {
		http.ServeFile(w, r, staticPath)
		return
	}

	// Serve index.html for SPA routing
	indexPath := filepath.Join(h.config.StaticPath, "index.html")
	if _, err := os.Stat(indexPath); err != nil {
		// No frontend built yet, return simple message
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`<!DOCTYPE html>
<html>
<head><title>Imgable API</title></head>
<body>
<h1>Imgable API</h1>
<p>API is running. Frontend not yet deployed.</p>
<p>API endpoints available at <code>/api/v1/</code></p>
</body>
</html>`))
		return
	}

	http.ServeFile(w, r, indexPath)
}

// isValidPathComponent checks if a path component is safe (no traversal).
func isValidPathComponent(s string) bool {
	if len(s) != 2 {
		return false
	}
	for _, c := range s {
		if !((c >= 'a' && c <= 'f') || (c >= '0' && c <= '9')) {
			return false
		}
	}
	return true
}

// isValidFilename checks if a filename is safe.
func isValidFilename(s string) bool {
	if s == "" || len(s) > 100 {
		return false
	}
	// Must not contain path separators or start with dot
	if strings.Contains(s, "/") || strings.Contains(s, "\\") || strings.HasPrefix(s, ".") {
		return false
	}
	// Must have valid extension
	ext := filepath.Ext(s)
	validExts := map[string]bool{
		".webp": true, ".mp4": true, ".mov": true, ".avi": true, ".mkv": true, ".webm": true,
	}
	return validExts[ext]
}

// getContentType returns the MIME type for a filename.
func getContentType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".webp":
		return "image/webp"
	case ".mp4":
		return "video/mp4"
	case ".mov":
		return "video/quicktime"
	case ".avi":
		return "video/x-msvideo"
	case ".mkv":
		return "video/x-matroska"
	case ".webm":
		return "video/webm"
	default:
		return "application/octet-stream"
	}
}
