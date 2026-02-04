package models

import (
	"database/sql"
	"testing"
	"time"
)

func TestGeneratePhotoURLs(t *testing.T) {
	tests := []struct {
		id        string
		photoType PhotoType
		wantSmall string
		wantVideo string
	}{
		{
			id:        "abc123def456",
			photoType: PhotoTypePhoto,
			wantSmall: "/ab/c1/abc123def456_s.webp",
		},
		{
			id:        "xyz789xyz789",
			photoType: PhotoTypeVideo,
			wantSmall: "/xy/z7/xyz789xyz789_s.webp",
			wantVideo: "/xy/z7/xyz789xyz789.mp4",
		},
	}

	for _, tt := range tests {
		t.Run(tt.id, func(t *testing.T) {
			urls := GeneratePhotoURLs(tt.id, tt.photoType)

			if urls.Small != tt.wantSmall {
				t.Errorf("Small URL mismatch: got %q, want %q", urls.Small, tt.wantSmall)
			}

			if tt.photoType == PhotoTypePhoto {
				// Photo should have large
				if urls.Large == "" {
					t.Error("Photo should have Large URL")
				}
			} else {
				// Video should have video URL
				if urls.Video != tt.wantVideo {
					t.Errorf("Video URL mismatch: got %q, want %q", urls.Video, tt.wantVideo)
				}
			}
		})
	}
}

func TestPhotoToAPI(t *testing.T) {
	now := time.Now()
	photo := &Photo{
		ID:         "abc123def456",
		Type:       PhotoTypePhoto,
		Status:     PhotoStatusReady,
		CreatedAt:  now,
		UpdatedAt:  now,
		IsFavorite: true,
		Width:      sql.NullInt32{Int32: 4000, Valid: true},
		Height:     sql.NullInt32{Int32: 3000, Valid: true},
		Blurhash:   sql.NullString{String: "LEHV6nWB2yk8", Valid: true},
		CameraMake: sql.NullString{String: "Apple", Valid: true},
	}

	api := photo.ToAPI()

	if api.ID != photo.ID {
		t.Errorf("ID mismatch: got %q, want %q", api.ID, photo.ID)
	}

	if api.Type != string(photo.Type) {
		t.Errorf("Type mismatch: got %q, want %q", api.Type, photo.Type)
	}

	if api.Status != string(photo.Status) {
		t.Errorf("Status mismatch: got %q, want %q", api.Status, photo.Status)
	}

	if !api.IsFavorite {
		t.Error("IsFavorite should be true")
	}

	if api.Width != 4000 {
		t.Errorf("Width mismatch: got %d, want 4000", api.Width)
	}

	if api.Height != 3000 {
		t.Errorf("Height mismatch: got %d, want 3000", api.Height)
	}

	if api.Blurhash != "LEHV6nWB2yk8" {
		t.Errorf("Blurhash mismatch: got %q", api.Blurhash)
	}

	if api.CameraMake != "Apple" {
		t.Errorf("CameraMake mismatch: got %q", api.CameraMake)
	}
}

func TestPhotoTypes(t *testing.T) {
	// Verify type constants
	if PhotoTypePhoto != "photo" {
		t.Errorf("PhotoTypePhoto should be 'photo', got %q", PhotoTypePhoto)
	}

	if PhotoTypeVideo != "video" {
		t.Errorf("PhotoTypeVideo should be 'video', got %q", PhotoTypeVideo)
	}
}

func TestPhotoStatus(t *testing.T) {
	// Verify status constants
	if PhotoStatusProcessing != "processing" {
		t.Errorf("PhotoStatusProcessing should be 'processing', got %q", PhotoStatusProcessing)
	}

	if PhotoStatusReady != "ready" {
		t.Errorf("PhotoStatusReady should be 'ready', got %q", PhotoStatusReady)
	}

	if PhotoStatusError != "error" {
		t.Errorf("PhotoStatusError should be 'error', got %q", PhotoStatusError)
	}
}

func TestPhotoURLsGeneration(t *testing.T) {
	// Test URL generation for photo
	photoURLs := GeneratePhotoURLs("abc123def456", PhotoTypePhoto)

	expectedSmall := "/ab/c1/abc123def456_s.webp"
	if photoURLs.Small != expectedSmall {
		t.Errorf("Small URL: got %q, want %q", photoURLs.Small, expectedSmall)
	}

	expectedLarge := "/ab/c1/abc123def456_l.webp"
	if photoURLs.Large != expectedLarge {
		t.Errorf("Large URL: got %q, want %q", photoURLs.Large, expectedLarge)
	}

	// Test URL generation for video
	videoURLs := GeneratePhotoURLs("xyz789xyz789", PhotoTypeVideo)

	expectedVideoThumb := "/xy/z7/xyz789xyz789_s.webp"
	if videoURLs.Small != expectedVideoThumb {
		t.Errorf("Video thumbnail URL: got %q, want %q", videoURLs.Small, expectedVideoThumb)
	}

	expectedVideo := "/xy/z7/xyz789xyz789.mp4"
	if videoURLs.Video != expectedVideo {
		t.Errorf("Video URL: got %q, want %q", videoURLs.Video, expectedVideo)
	}

	// Video should not have large
	if videoURLs.Large != "" {
		t.Error("Video should not have large URL")
	}
}
