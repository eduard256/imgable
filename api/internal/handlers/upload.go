// Package handlers provides file upload HTTP handlers.
package handlers

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/response"
)

// UploadHandler handles file upload endpoints.
type UploadHandler struct {
	config *config.Config
	logger *slog.Logger
}

// NewUploadHandler creates a new UploadHandler.
func NewUploadHandler(cfg *config.Config, logger *slog.Logger) *UploadHandler {
	return &UploadHandler{
		config: cfg,
		logger: logger,
	}
}

// UploadResponse represents the upload response.
type UploadResponse struct {
	Status   string `json:"status"`
	Filename string `json:"filename"`
	Message  string `json:"message"`
}

// Supported file extensions.
var supportedExtensions = map[string]bool{
	".jpg": true, ".jpeg": true, ".png": true, ".gif": true, ".webp": true,
	".heic": true, ".heif": true, ".tiff": true, ".tif": true, ".bmp": true,
	".raw": true, ".cr2": true, ".cr3": true, ".arw": true, ".nef": true,
	".dng": true, ".orf": true, ".rw2": true,
	".mp4": true, ".mov": true, ".avi": true, ".mkv": true, ".webm": true,
	".m4v": true, ".mts": true, ".m2ts": true, ".3gp": true,
}

// Upload handles POST /api/v1/upload.
// Accepts multipart form data with a 'file' field.
func (h *UploadHandler) Upload(w http.ResponseWriter, r *http.Request) {
	// Check content type
	contentType := r.Header.Get("Content-Type")
	if !strings.HasPrefix(contentType, "multipart/form-data") {
		response.BadRequest(w, "content type must be multipart/form-data")
		return
	}

	// Parse multipart form
	// MaxUploadSize of 0 means unlimited (but we still need a max for parsing)
	maxSize := h.config.MaxUploadSize
	if maxSize == 0 {
		maxSize = 10 << 30 // 10GB as practical limit
	}

	if err := r.ParseMultipartForm(maxSize); err != nil {
		h.logger.Warn("failed to parse multipart form", slog.Any("error", err))
		response.Error(w, http.StatusRequestEntityTooLarge, "file too large")
		return
	}

	// Get file from form
	file, header, err := r.FormFile("file")
	if err != nil {
		response.BadRequest(w, "file field is required")
		return
	}
	defer file.Close()

	// Validate file extension
	ext := strings.ToLower(filepath.Ext(header.Filename))
	if !supportedExtensions[ext] {
		response.BadRequest(w, "unsupported file type")
		return
	}

	// Generate safe filename
	// Format: web_upload_<timestamp>_<original_filename>
	safeFilename := sanitizeFilename(header.Filename)
	timestamp := time.Now().UnixNano()
	destFilename := fmt.Sprintf("web_upload_%d_%s", timestamp, safeFilename)
	destPath := filepath.Join(h.config.UploadsPath, destFilename)

	// Create destination file
	dest, err := os.Create(destPath)
	if err != nil {
		h.logger.Error("failed to create file", slog.Any("error", err), slog.String("path", destPath))
		response.InternalError(w)
		return
	}
	defer dest.Close()

	// Copy file content
	written, err := io.Copy(dest, file)
	if err != nil {
		h.logger.Error("failed to write file", slog.Any("error", err))
		os.Remove(destPath) // Cleanup on error
		response.InternalError(w)
		return
	}

	h.logger.Info("file uploaded",
		slog.String("filename", safeFilename),
		slog.Int64("size", written),
		slog.String("path", destPath),
	)

	response.JSON(w, http.StatusAccepted, UploadResponse{
		Status:   "queued",
		Filename: header.Filename,
		Message:  "file queued for processing",
	})
}

// sanitizeFilename removes potentially dangerous characters from filename.
func sanitizeFilename(name string) string {
	// Replace path separators and null bytes
	name = strings.ReplaceAll(name, "/", "_")
	name = strings.ReplaceAll(name, "\\", "_")
	name = strings.ReplaceAll(name, "\x00", "")

	// Remove leading dots (hidden files)
	for len(name) > 0 && name[0] == '.' {
		name = name[1:]
	}

	// Limit length
	if len(name) > 200 {
		ext := filepath.Ext(name)
		name = name[:200-len(ext)] + ext
	}

	// Ensure not empty
	if name == "" {
		name = "upload"
	}

	return name
}
