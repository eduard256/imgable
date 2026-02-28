// Package fileutil provides file operation utilities used across services.
// It includes functions for file type detection, path manipulation, and safe file operations.
package fileutil

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// Supported file extensions for photos.
var ImageExtensions = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".heic": true,
	".heif": true,
	".webp": true,
	".gif":  true,
	".tiff": true,
	".tif":  true,
	".bmp":  true,
	".raw":  true,
	".cr2":  true,
	".cr3":  true,
	".arw":  true,
	".nef":  true,
	".dng":  true,
	".orf":  true,
	".rw2":  true,
}

// Supported file extensions for videos.
var VideoExtensions = map[string]bool{
	".mp4":  true,
	".mov":  true,
	".avi":  true,
	".mkv":  true,
	".webm": true,
	".m4v":  true,
	".mts":  true,
	".m2ts": true,
	".3gp":  true,
}

// FileType represents the type of media file.
type FileType int

const (
	FileTypeUnknown FileType = iota
	FileTypeImage
	FileTypeVideo
)

// GetFileType determines the file type based on extension.
func GetFileType(filename string) FileType {
	ext := strings.ToLower(filepath.Ext(filename))

	if ImageExtensions[ext] {
		return FileTypeImage
	}
	if VideoExtensions[ext] {
		return FileTypeVideo
	}
	return FileTypeUnknown
}

// OS-generated junk filenames that should always be ignored (case-insensitive).
var ignoredNames = map[string]bool{
	".ds_store":        true, // macOS directory metadata
	".thumbs.db":       true, // Windows thumbnail cache (dot-prefixed variant)
	"thumbs.db":        true, // Windows thumbnail cache
	"desktop.ini":      true, // Windows folder settings
	"ehthumbs.db":      true, // Windows Media Center thumbnails
	"ehthumbs_vista.db": true, // Windows Vista Media Center thumbnails
	".directory":       true, // KDE directory metadata
	".localized":       true, // macOS localization file
}

// IsIgnoredFile checks if a file is OS-generated junk that should be skipped.
// Catches macOS resource forks (._*), hidden dot-files, Windows/Linux metadata,
// temp files, and partial downloads.
func IsIgnoredFile(filename string) bool {
	base := filepath.Base(filename)
	lower := strings.ToLower(base)

	// Known junk filenames
	if ignoredNames[lower] {
		return true
	}

	// macOS resource forks: ._filename.ext
	if strings.HasPrefix(base, "._") {
		return true
	}

	// Temp and partial download files
	if strings.HasSuffix(lower, ".tmp") || strings.HasSuffix(lower, ".part") ||
		strings.HasSuffix(lower, ".crdownload") || strings.HasSuffix(lower, ".download") {
		return true
	}

	// Editor swap/backup files: ~file, file~
	if strings.HasPrefix(base, "~") || strings.HasSuffix(base, "~") {
		return true
	}

	return false
}

// IsSupportedFile checks if a file has a supported extension and is not OS junk.
func IsSupportedFile(filename string) bool {
	if IsIgnoredFile(filename) {
		return false
	}
	return GetFileType(filename) != FileTypeUnknown
}

// IsImageFile checks if a file is a supported image.
func IsImageFile(filename string) bool {
	return GetFileType(filename) == FileTypeImage
}

// IsVideoFile checks if a file is a supported video.
func IsVideoFile(filename string) bool {
	return GetFileType(filename) == FileTypeVideo
}

// HashFile calculates SHA256 hash of a file and returns first 12 characters.
// This is used as the photo ID and determines the storage path.
func HashFile(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", fmt.Errorf("failed to hash file: %w", err)
	}

	fullHash := hex.EncodeToString(h.Sum(nil))
	return fullHash[:12], nil
}

// HashFileWithFullHash calculates SHA256 hash and returns both short (12 chars) and full hash.
func HashFileWithFullHash(path string) (short string, full string, err error) {
	f, err := os.Open(path)
	if err != nil {
		return "", "", fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", "", fmt.Errorf("failed to hash file: %w", err)
	}

	full = hex.EncodeToString(h.Sum(nil))
	short = full[:12]
	return short, full, nil
}

// GetMediaPath returns the storage path for a photo/video based on its ID.
// Format: /media/{id[0:2]}/{id[2:4]}/{id}_{size}.webp
func GetMediaPath(baseDir, id, suffix string) string {
	prefix1 := id[0:2]
	prefix2 := id[2:4]
	return filepath.Join(baseDir, prefix1, prefix2, id+suffix)
}

// GetMediaDir returns the directory path for a photo/video based on its ID.
// Format: /media/{id[0:2]}/{id[2:4]}/
func GetMediaDir(baseDir, id string) string {
	prefix1 := id[0:2]
	prefix2 := id[2:4]
	return filepath.Join(baseDir, prefix1, prefix2)
}

// EnsureDir creates a directory and all parent directories if they don't exist.
func EnsureDir(path string) error {
	return os.MkdirAll(path, 0755)
}

// FileExists checks if a file exists and is not a directory.
func FileExists(path string) bool {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	return err == nil && !info.IsDir()
}

// DirExists checks if a directory exists.
func DirExists(path string) bool {
	info, err := os.Stat(path)
	if os.IsNotExist(err) {
		return false
	}
	return err == nil && info.IsDir()
}

// GetFileSize returns the size of a file in bytes.
func GetFileSize(path string) (int64, error) {
	info, err := os.Stat(path)
	if err != nil {
		return 0, err
	}
	return info.Size(), nil
}

// MoveFile moves a file from src to dst atomically within the same filesystem.
// If cross-filesystem, it copies then deletes.
func MoveFile(src, dst string) error {
	// Ensure destination directory exists
	if err := EnsureDir(filepath.Dir(dst)); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	// Try rename first (atomic on same filesystem)
	if err := os.Rename(src, dst); err == nil {
		return nil
	}

	// Fall back to copy + delete for cross-filesystem moves
	if err := CopyFile(src, dst); err != nil {
		return err
	}

	return os.Remove(src)
}

// CopyFile copies a file from src to dst.
func CopyFile(src, dst string) error {
	srcFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %w", err)
	}
	defer srcFile.Close()

	// Ensure destination directory exists
	if err := EnsureDir(filepath.Dir(dst)); err != nil {
		return fmt.Errorf("failed to create destination directory: %w", err)
	}

	dstFile, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to create destination file: %w", err)
	}
	defer dstFile.Close()

	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Errorf("failed to copy file: %w", err)
	}

	// Sync to ensure data is written to disk
	if err := dstFile.Sync(); err != nil {
		return fmt.Errorf("failed to sync file: %w", err)
	}

	// Copy file permissions
	srcInfo, err := os.Stat(src)
	if err == nil {
		if err := os.Chmod(dst, srcInfo.Mode()); err != nil {
			// Non-fatal, just log
			return nil
		}
	}

	return nil
}

// RemoveEmptyDirs removes empty directories up to (but not including) stopAt.
// Useful for cleaning up after deleting files from /uploads.
func RemoveEmptyDirs(path, stopAt string) error {
	for {
		dir := filepath.Dir(path)

		// Stop if we've reached the stop directory
		if dir == stopAt || dir == "." || dir == "/" {
			return nil
		}

		// Check if directory is empty
		entries, err := os.ReadDir(dir)
		if err != nil {
			return nil // Directory doesn't exist or can't be read
		}

		if len(entries) > 0 {
			return nil // Not empty
		}

		// Remove empty directory
		if err := os.Remove(dir); err != nil {
			return nil // Can't remove, might have files now
		}

		// Continue up the tree
		path = dir
	}
}

// SafeDelete deletes a file only if it exists.
func SafeDelete(path string) error {
	if !FileExists(path) {
		return nil
	}
	return os.Remove(path)
}

// TempDir creates a temporary directory with a specific prefix.
func TempDir(baseDir, prefix string) (string, error) {
	return os.MkdirTemp(baseDir, prefix)
}

// CleanupTempDir removes a temporary directory and all its contents.
func CleanupTempDir(path string) error {
	if path == "" || path == "/" || path == "." {
		return fmt.Errorf("refusing to delete dangerous path: %s", path)
	}
	return os.RemoveAll(path)
}

// RelativePath returns the path relative to a base directory.
func RelativePath(basePath, fullPath string) string {
	rel, err := filepath.Rel(basePath, fullPath)
	if err != nil {
		return fullPath
	}
	return rel
}

// NormalizePath cleans and normalizes a file path.
func NormalizePath(path string) string {
	return filepath.Clean(path)
}

// CreateTemp creates a temporary file in the specified directory.
func CreateTemp(dir, pattern string) (*os.File, error) {
	return os.CreateTemp(dir, pattern)
}
