package fileutil

import (
	"os"
	"path/filepath"
	"testing"
)

func TestGetFileType(t *testing.T) {
	tests := []struct {
		filename string
		expected FileType
	}{
		// Images
		{"photo.jpg", FileTypeImage},
		{"photo.JPEG", FileTypeImage},
		{"image.png", FileTypeImage},
		{"image.PNG", FileTypeImage},
		{"photo.heic", FileTypeImage},
		{"photo.HEIC", FileTypeImage},
		{"photo.heif", FileTypeImage},
		{"image.webp", FileTypeImage},
		{"image.gif", FileTypeImage},
		{"image.tiff", FileTypeImage},
		{"image.tif", FileTypeImage},
		{"image.bmp", FileTypeImage},
		{"photo.raw", FileTypeImage},
		{"photo.cr2", FileTypeImage},
		{"photo.cr3", FileTypeImage},
		{"photo.arw", FileTypeImage},
		{"photo.nef", FileTypeImage},
		{"photo.dng", FileTypeImage},
		{"photo.orf", FileTypeImage},
		{"photo.rw2", FileTypeImage},

		// Videos
		{"video.mp4", FileTypeVideo},
		{"video.MP4", FileTypeVideo},
		{"video.mov", FileTypeVideo},
		{"video.MOV", FileTypeVideo},
		{"video.avi", FileTypeVideo},
		{"video.mkv", FileTypeVideo},
		{"video.webm", FileTypeVideo},
		{"video.m4v", FileTypeVideo},
		{"video.mts", FileTypeVideo},
		{"video.m2ts", FileTypeVideo},
		{"video.3gp", FileTypeVideo},

		// Unknown
		{"document.pdf", FileTypeUnknown},
		{"file.txt", FileTypeUnknown},
		{"archive.zip", FileTypeUnknown},
		{"script.js", FileTypeUnknown},
		{"noextension", FileTypeUnknown},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			result := GetFileType(tt.filename)
			if result != tt.expected {
				t.Errorf("GetFileType(%q) = %v, want %v", tt.filename, result, tt.expected)
			}
		})
	}
}

func TestIsSupportedFile(t *testing.T) {
	tests := []struct {
		filename string
		expected bool
	}{
		{"photo.jpg", true},
		{"video.mp4", true},
		{"document.pdf", false},
		{"file.txt", false},
	}

	for _, tt := range tests {
		t.Run(tt.filename, func(t *testing.T) {
			result := IsSupportedFile(tt.filename)
			if result != tt.expected {
				t.Errorf("IsSupportedFile(%q) = %v, want %v", tt.filename, result, tt.expected)
			}
		})
	}
}

func TestIsImageFile(t *testing.T) {
	if !IsImageFile("photo.jpg") {
		t.Error("IsImageFile should return true for .jpg")
	}
	if IsImageFile("video.mp4") {
		t.Error("IsImageFile should return false for .mp4")
	}
}

func TestIsVideoFile(t *testing.T) {
	if !IsVideoFile("video.mp4") {
		t.Error("IsVideoFile should return true for .mp4")
	}
	if IsVideoFile("photo.jpg") {
		t.Error("IsVideoFile should return false for .jpg")
	}
}

func TestGetMediaPath(t *testing.T) {
	tests := []struct {
		baseDir  string
		id       string
		suffix   string
		expected string
	}{
		{"/media", "abc123def456", "_s.webp", "/media/ab/c1/abc123def456_s.webp"},
		{"/media", "xyz789xyz789", "_l.webp", "/media/xy/z7/xyz789xyz789_l.webp"},
		{"/data/photos", "123456789012", ".mp4", "/data/photos/12/34/123456789012.mp4"},
	}

	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			result := GetMediaPath(tt.baseDir, tt.id, tt.suffix)
			if result != tt.expected {
				t.Errorf("GetMediaPath(%q, %q, %q) = %q, want %q",
					tt.baseDir, tt.id, tt.suffix, result, tt.expected)
			}
		})
	}
}

func TestGetMediaDir(t *testing.T) {
	tests := []struct {
		baseDir  string
		id       string
		expected string
	}{
		{"/media", "abc123def456", "/media/ab/c1"},
		{"/media", "xyz789xyz789", "/media/xy/z7"},
	}

	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			result := GetMediaDir(tt.baseDir, tt.id)
			if result != tt.expected {
				t.Errorf("GetMediaDir(%q, %q) = %q, want %q",
					tt.baseDir, tt.id, result, tt.expected)
			}
		})
	}
}

func TestEnsureDir(t *testing.T) {
	tmpDir := t.TempDir()
	testDir := filepath.Join(tmpDir, "a", "b", "c")

	if err := EnsureDir(testDir); err != nil {
		t.Fatalf("EnsureDir failed: %v", err)
	}

	if !DirExists(testDir) {
		t.Error("Directory should exist after EnsureDir")
	}

	// Should be idempotent
	if err := EnsureDir(testDir); err != nil {
		t.Fatalf("EnsureDir should be idempotent: %v", err)
	}
}

func TestFileExists(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// File doesn't exist
	if FileExists(testFile) {
		t.Error("FileExists should return false for non-existent file")
	}

	// Create file
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// File exists
	if !FileExists(testFile) {
		t.Error("FileExists should return true for existing file")
	}

	// Directory is not a file
	if FileExists(tmpDir) {
		t.Error("FileExists should return false for directory")
	}
}

func TestDirExists(t *testing.T) {
	tmpDir := t.TempDir()

	if !DirExists(tmpDir) {
		t.Error("DirExists should return true for existing directory")
	}

	if DirExists(filepath.Join(tmpDir, "nonexistent")) {
		t.Error("DirExists should return false for non-existent directory")
	}
}

func TestCopyFile(t *testing.T) {
	tmpDir := t.TempDir()
	srcFile := filepath.Join(tmpDir, "source.txt")
	dstFile := filepath.Join(tmpDir, "dest", "copied.txt")
	content := []byte("test content")

	// Create source file
	if err := os.WriteFile(srcFile, content, 0644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	// Copy file
	if err := CopyFile(srcFile, dstFile); err != nil {
		t.Fatalf("CopyFile failed: %v", err)
	}

	// Verify destination exists
	if !FileExists(dstFile) {
		t.Error("Destination file should exist")
	}

	// Verify content
	copied, err := os.ReadFile(dstFile)
	if err != nil {
		t.Fatalf("Failed to read copied file: %v", err)
	}
	if string(copied) != string(content) {
		t.Errorf("Content mismatch: got %q, want %q", copied, content)
	}
}

func TestMoveFile(t *testing.T) {
	tmpDir := t.TempDir()
	srcFile := filepath.Join(tmpDir, "source.txt")
	dstFile := filepath.Join(tmpDir, "dest", "moved.txt")
	content := []byte("test content")

	// Create source file
	if err := os.WriteFile(srcFile, content, 0644); err != nil {
		t.Fatalf("Failed to create source file: %v", err)
	}

	// Move file
	if err := MoveFile(srcFile, dstFile); err != nil {
		t.Fatalf("MoveFile failed: %v", err)
	}

	// Verify source doesn't exist
	if FileExists(srcFile) {
		t.Error("Source file should not exist after move")
	}

	// Verify destination exists
	if !FileExists(dstFile) {
		t.Error("Destination file should exist")
	}

	// Verify content
	moved, err := os.ReadFile(dstFile)
	if err != nil {
		t.Fatalf("Failed to read moved file: %v", err)
	}
	if string(moved) != string(content) {
		t.Errorf("Content mismatch: got %q, want %q", moved, content)
	}
}

func TestSafeDelete(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// Delete non-existent file should not error
	if err := SafeDelete(testFile); err != nil {
		t.Errorf("SafeDelete should not error for non-existent file: %v", err)
	}

	// Create and delete file
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	if err := SafeDelete(testFile); err != nil {
		t.Fatalf("SafeDelete failed: %v", err)
	}

	if FileExists(testFile) {
		t.Error("File should be deleted")
	}
}

func TestRelativePath(t *testing.T) {
	tests := []struct {
		basePath string
		fullPath string
		expected string
	}{
		{"/uploads", "/uploads/photos/image.jpg", "photos/image.jpg"},
		{"/uploads", "/uploads/image.jpg", "image.jpg"},
		{"/data", "/other/path/file.txt", "/other/path/file.txt"}, // Different base
	}

	for _, tt := range tests {
		t.Run(tt.fullPath, func(t *testing.T) {
			result := RelativePath(tt.basePath, tt.fullPath)
			if result != tt.expected {
				t.Errorf("RelativePath(%q, %q) = %q, want %q",
					tt.basePath, tt.fullPath, result, tt.expected)
			}
		})
	}
}

func TestHashFile(t *testing.T) {
	tmpDir := t.TempDir()
	testFile := filepath.Join(tmpDir, "test.txt")

	// Create test file with known content
	content := []byte("test content for hashing")
	if err := os.WriteFile(testFile, content, 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Hash the file
	hash, err := HashFile(testFile)
	if err != nil {
		t.Fatalf("HashFile failed: %v", err)
	}

	// Hash should be 12 characters
	if len(hash) != 12 {
		t.Errorf("Hash length should be 12, got %d", len(hash))
	}

	// Hash should be deterministic
	hash2, err := HashFile(testFile)
	if err != nil {
		t.Fatalf("HashFile failed on second call: %v", err)
	}
	if hash != hash2 {
		t.Errorf("Hash should be deterministic: %q != %q", hash, hash2)
	}

	// Different content should produce different hash
	testFile2 := filepath.Join(tmpDir, "test2.txt")
	if err := os.WriteFile(testFile2, []byte("different content"), 0644); err != nil {
		t.Fatalf("Failed to create test file 2: %v", err)
	}

	hash3, err := HashFile(testFile2)
	if err != nil {
		t.Fatalf("HashFile failed for file 2: %v", err)
	}
	if hash == hash3 {
		t.Error("Different content should produce different hash")
	}
}

func TestRemoveEmptyDirs(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested empty directories
	deepDir := filepath.Join(tmpDir, "a", "b", "c")
	if err := EnsureDir(deepDir); err != nil {
		t.Fatalf("Failed to create directories: %v", err)
	}

	// Create a file in the deepest directory
	testFile := filepath.Join(deepDir, "file.txt")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	// Delete the file
	if err := os.Remove(testFile); err != nil {
		t.Fatalf("Failed to delete test file: %v", err)
	}

	// Remove empty directories
	if err := RemoveEmptyDirs(testFile, tmpDir); err != nil {
		t.Fatalf("RemoveEmptyDirs failed: %v", err)
	}

	// Empty directories should be removed
	if DirExists(deepDir) {
		t.Error("Empty directories should be removed")
	}
}
