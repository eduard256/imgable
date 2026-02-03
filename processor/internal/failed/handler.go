// Package failed handles moving problematic files to the /failed directory.
package failed

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/eduard256/imgable/shared/pkg/fileutil"
	"github.com/eduard256/imgable/shared/pkg/logger"
	"github.com/eduard256/imgable/shared/pkg/models"
)

// Handler manages failed file operations.
type Handler struct {
	failedDir  string
	uploadsDir string
	logger     *logger.Logger
}

// NewHandler creates a new failed file handler.
func NewHandler(failedDir, uploadsDir string, log *logger.Logger) *Handler {
	return &Handler{
		failedDir:  failedDir,
		uploadsDir: uploadsDir,
		logger:     log.WithField("component", "failed-handler"),
	}
}

// MoveToFailed moves a file to the /failed directory with error information.
func (h *Handler) MoveToFailed(filePath, errorMsg, stage, workerID string) error {
	// Create date-based subdirectory
	dateDir := time.Now().Format("2006-01-02")
	destDir := filepath.Join(h.failedDir, dateDir)

	if err := fileutil.EnsureDir(destDir); err != nil {
		return fmt.Errorf("failed to create failed directory: %w", err)
	}

	// Get original filename
	filename := filepath.Base(filePath)
	destPath := filepath.Join(destDir, filename)

	// Handle filename conflicts
	destPath = h.uniqueFilename(destPath)
	filename = filepath.Base(destPath)

	// Move the file
	if err := fileutil.MoveFile(filePath, destPath); err != nil {
		return fmt.Errorf("failed to move file: %w", err)
	}

	// Create .error file with details
	errorFile := models.FailedFileError{
		OriginalPath: fileutil.RelativePath(h.uploadsDir, filePath),
		Error:        errorMsg,
		Stage:        stage,
		Attempts:     3, // Max retries
		Timestamp:    time.Now(),
		WorkerID:     workerID,
	}

	errorPath := destPath + ".error"
	if err := h.writeErrorFile(errorPath, &errorFile); err != nil {
		h.logger.WithError(err).Warn("failed to write error file")
	}

	// Try to remove empty parent directories in uploads
	fileutil.RemoveEmptyDirs(filePath, h.uploadsDir)

	h.logger.WithFields(map[string]interface{}{
		"original": filePath,
		"dest":     destPath,
		"error":    errorMsg,
	}).Info("file moved to failed directory")

	return nil
}

// writeErrorFile writes the error details to a JSON file.
func (h *Handler) writeErrorFile(path string, errorFile *models.FailedFileError) error {
	data, err := json.MarshalIndent(errorFile, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(path, data, 0644)
}

// uniqueFilename returns a unique filename by adding a suffix if needed.
func (h *Handler) uniqueFilename(path string) string {
	if !fileutil.FileExists(path) {
		return path
	}

	dir := filepath.Dir(path)
	ext := filepath.Ext(path)
	base := path[:len(path)-len(ext)]

	for i := 1; i < 1000; i++ {
		newPath := fmt.Sprintf("%s_%d%s", base, i, ext)
		if !fileutil.FileExists(newPath) {
			return newPath
		}
	}

	// Last resort: use timestamp
	return fmt.Sprintf("%s_%d%s", base, time.Now().UnixNano(), ext)
}

// ListFailed lists all failed files with their error information.
func (h *Handler) ListFailed(limit, offset int) ([]models.FailedFile, int, error) {
	var files []models.FailedFile

	// Walk the failed directory
	err := filepath.Walk(h.failedDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Continue on error
		}

		// Skip directories and .error files
		if info.IsDir() || filepath.Ext(path) == ".error" {
			return nil
		}

		// Read the associated .error file
		errorPath := path + ".error"
		var failedFile models.FailedFile

		failedFile.Path = fileutil.RelativePath(h.failedDir, path)
		failedFile.FileSize = info.Size()
		failedFile.FailedAt = info.ModTime()

		if errorData, err := os.ReadFile(errorPath); err == nil {
			var errorInfo models.FailedFileError
			if err := json.Unmarshal(errorData, &errorInfo); err == nil {
				failedFile.OriginalPath = errorInfo.OriginalPath
				failedFile.Error = errorInfo.Error
				failedFile.Stage = errorInfo.Stage
				failedFile.Attempts = errorInfo.Attempts
				failedFile.FailedAt = errorInfo.Timestamp
			}
		}

		files = append(files, failedFile)
		return nil
	})

	if err != nil {
		return nil, 0, err
	}

	total := len(files)

	// Apply pagination
	if offset >= len(files) {
		return []models.FailedFile{}, total, nil
	}

	end := offset + limit
	if end > len(files) {
		end = len(files)
	}

	return files[offset:end], total, nil
}

// RetryFailed moves a file from /failed back to /uploads for retry.
func (h *Handler) RetryFailed(relativePath string) error {
	srcPath := filepath.Join(h.failedDir, relativePath)

	if !fileutil.FileExists(srcPath) {
		return fmt.Errorf("file not found: %s", relativePath)
	}

	// Read original path from .error file if available
	destPath := filepath.Join(h.uploadsDir, filepath.Base(srcPath))
	errorPath := srcPath + ".error"
	if errorData, err := os.ReadFile(errorPath); err == nil {
		var errorInfo models.FailedFileError
		if err := json.Unmarshal(errorData, &errorInfo); err == nil && errorInfo.OriginalPath != "" {
			destPath = filepath.Join(h.uploadsDir, errorInfo.OriginalPath)
		}
	}

	// Ensure destination directory exists
	if err := fileutil.EnsureDir(filepath.Dir(destPath)); err != nil {
		return fmt.Errorf("failed to create directory: %w", err)
	}

	// Move file back to uploads
	if err := fileutil.MoveFile(srcPath, destPath); err != nil {
		return fmt.Errorf("failed to move file: %w", err)
	}

	// Delete .error file
	os.Remove(errorPath)

	// Try to remove empty directories in failed
	fileutil.RemoveEmptyDirs(srcPath, h.failedDir)

	h.logger.WithFields(map[string]interface{}{
		"src":  srcPath,
		"dest": destPath,
	}).Info("file moved back for retry")

	return nil
}

// DeleteFailed deletes a file from the /failed directory.
func (h *Handler) DeleteFailed(relativePath string) error {
	path := filepath.Join(h.failedDir, relativePath)

	if !fileutil.FileExists(path) {
		return fmt.Errorf("file not found: %s", relativePath)
	}

	// Delete the file
	if err := os.Remove(path); err != nil {
		return fmt.Errorf("failed to delete file: %w", err)
	}

	// Delete .error file if exists
	errorPath := path + ".error"
	os.Remove(errorPath)

	// Try to remove empty directories
	fileutil.RemoveEmptyDirs(path, h.failedDir)

	h.logger.WithField("path", path).Info("failed file deleted")

	return nil
}

// GetFailedCount returns the total number of failed files.
func (h *Handler) GetFailedCount() (int, error) {
	count := 0

	err := filepath.Walk(h.failedDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && filepath.Ext(path) != ".error" {
			count++
		}
		return nil
	})

	return count, err
}
