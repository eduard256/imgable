// Package models defines data structures used across Imgable services.
// These models map directly to database tables and are used for serialization.
package models

import (
	"database/sql"
	"time"
)

// PhotoType represents the type of media file.
type PhotoType string

const (
	PhotoTypePhoto PhotoType = "photo"
	PhotoTypeVideo PhotoType = "video"
)

// PhotoStatus represents the processing status of a photo.
type PhotoStatus string

const (
	PhotoStatusProcessing PhotoStatus = "processing"
	PhotoStatusReady      PhotoStatus = "ready"
	PhotoStatusError      PhotoStatus = "error"
)

// Photo represents a photo or video in the gallery.
// Maps to the 'photos' table in PostgreSQL.
type Photo struct {
	// Identification
	ID     string      `json:"id" db:"id"`         // SHA256 first 12 chars
	Type   PhotoType   `json:"type" db:"type"`     // 'photo' or 'video'
	Status PhotoStatus `json:"status" db:"status"` // 'processing', 'ready', 'error'

	// Original file info
	OriginalPath     sql.NullString `json:"original_path,omitempty" db:"original_path"`
	OriginalFilename sql.NullString `json:"original_filename,omitempty" db:"original_filename"`

	// Timestamps
	TakenAt   sql.NullTime `json:"taken_at,omitempty" db:"taken_at"`
	CreatedAt time.Time    `json:"created_at" db:"created_at"`
	UpdatedAt time.Time    `json:"updated_at" db:"updated_at"`

	// Visual
	Blurhash sql.NullString `json:"blurhash,omitempty" db:"blurhash"`

	// Original dimensions
	Width  sql.NullInt32 `json:"width,omitempty" db:"width"`
	Height sql.NullInt32 `json:"height,omitempty" db:"height"`

	// Preview dimensions
	SmallWidth  sql.NullInt32 `json:"small_width,omitempty" db:"small_width"`
	SmallHeight sql.NullInt32 `json:"small_height,omitempty" db:"small_height"`
	LargeWidth  sql.NullInt32 `json:"large_width,omitempty" db:"large_width"`
	LargeHeight sql.NullInt32 `json:"large_height,omitempty" db:"large_height"`

	// File sizes in bytes
	SizeOriginal sql.NullInt32 `json:"size_original,omitempty" db:"size_original"`
	SizeSmall    sql.NullInt32 `json:"size_small,omitempty" db:"size_small"`
	SizeLarge    sql.NullInt32 `json:"size_large,omitempty" db:"size_large"`

	// Video specific
	DurationSec sql.NullInt32  `json:"duration_sec,omitempty" db:"duration_sec"`
	VideoCodec  sql.NullString `json:"video_codec,omitempty" db:"video_codec"`

	// EXIF metadata
	CameraMake   sql.NullString  `json:"camera_make,omitempty" db:"camera_make"`
	CameraModel  sql.NullString  `json:"camera_model,omitempty" db:"camera_model"`
	Lens         sql.NullString  `json:"lens,omitempty" db:"lens"`
	ISO          sql.NullInt32   `json:"iso,omitempty" db:"iso"`
	Aperture     sql.NullFloat64 `json:"aperture,omitempty" db:"aperture"`
	ShutterSpeed sql.NullString  `json:"shutter_speed,omitempty" db:"shutter_speed"`
	FocalLength  sql.NullFloat64 `json:"focal_length,omitempty" db:"focal_length"`
	Flash        sql.NullBool    `json:"flash,omitempty" db:"flash"`

	// Geolocation
	GPSLat      sql.NullFloat64 `json:"gps_lat,omitempty" db:"gps_lat"`
	GPSLon      sql.NullFloat64 `json:"gps_lon,omitempty" db:"gps_lon"`
	GPSAltitude sql.NullFloat64 `json:"gps_altitude,omitempty" db:"gps_altitude"`
	PlaceID     sql.NullString  `json:"place_id,omitempty" db:"place_id"`

	// User data
	Comment    sql.NullString `json:"comment,omitempty" db:"comment"`
	IsFavorite bool           `json:"is_favorite" db:"is_favorite"`
}

// PhotoInsert represents data for inserting a new photo.
// Uses concrete types for required fields and pointers for optional fields.
type PhotoInsert struct {
	ID               string  `db:"id"`
	Type             string  `db:"type"`
	Status           string  `db:"status"`
	OriginalPath     *string `db:"original_path"`
	OriginalFilename *string `db:"original_filename"`
	TakenAt          *time.Time
	Blurhash     *string
	Width        *int
	Height       *int
	SmallWidth   *int
	SmallHeight  *int
	LargeWidth   *int
	LargeHeight  *int
	SizeOriginal *int
	SizeSmall    *int
	SizeLarge    *int
	DurationSec      *int
	VideoCodec       *string
	CameraMake       *string
	CameraModel      *string
	Lens             *string
	ISO              *int
	Aperture         *float64
	ShutterSpeed     *string
	FocalLength      *float64
	Flash            *bool
	GPSLat           *float64
	GPSLon           *float64
	GPSAltitude      *float64
	PlaceID          *string
}

// PhotoAPI represents photo data for API responses.
// Uses concrete types with omitempty for cleaner JSON.
type PhotoAPI struct {
	ID     string `json:"id"`
	Type   string `json:"type"`
	Status string `json:"status"`

	OriginalPath     string `json:"original_path,omitempty"`
	OriginalFilename string `json:"original_filename,omitempty"`

	TakenAt   *time.Time `json:"taken_at,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`

	Blurhash string `json:"blurhash,omitempty"`

	Width  int `json:"width,omitempty"`
	Height int `json:"height,omitempty"`

	SmallWidth  int `json:"small_width,omitempty"`
	SmallHeight int `json:"small_height,omitempty"`
	LargeWidth  int `json:"large_width,omitempty"`
	LargeHeight int `json:"large_height,omitempty"`

	SizeOriginal int `json:"size_original,omitempty"`
	SizeSmall    int `json:"size_small,omitempty"`
	SizeLarge    int `json:"size_large,omitempty"`

	DurationSec int    `json:"duration_sec,omitempty"`
	VideoCodec  string `json:"video_codec,omitempty"`

	CameraMake   string  `json:"camera_make,omitempty"`
	CameraModel  string  `json:"camera_model,omitempty"`
	Lens         string  `json:"lens,omitempty"`
	ISO          int     `json:"iso,omitempty"`
	Aperture     float64 `json:"aperture,omitempty"`
	ShutterSpeed string  `json:"shutter_speed,omitempty"`
	FocalLength  float64 `json:"focal_length,omitempty"`
	Flash        bool    `json:"flash,omitempty"`

	GPSLat      float64 `json:"gps_lat,omitempty"`
	GPSLon      float64 `json:"gps_lon,omitempty"`
	GPSAltitude float64 `json:"gps_altitude,omitempty"`
	PlaceID     string  `json:"place_id,omitempty"`

	Comment    string `json:"comment,omitempty"`
	IsFavorite bool   `json:"is_favorite"`

	// Computed fields for API
	URLs PhotoURLs `json:"urls,omitempty"`
}

// PhotoURLs contains URLs for different photo sizes.
type PhotoURLs struct {
	Small string `json:"small,omitempty"`
	Large string `json:"large,omitempty"`
	Video string `json:"video,omitempty"` // For video original
}

// ToAPI converts a Photo to PhotoAPI for JSON responses.
func (p *Photo) ToAPI() PhotoAPI {
	api := PhotoAPI{
		ID:         p.ID,
		Type:       string(p.Type),
		Status:     string(p.Status),
		CreatedAt:  p.CreatedAt,
		UpdatedAt:  p.UpdatedAt,
		IsFavorite: p.IsFavorite,
	}

	if p.OriginalPath.Valid {
		api.OriginalPath = p.OriginalPath.String
	}
	if p.OriginalFilename.Valid {
		api.OriginalFilename = p.OriginalFilename.String
	}
	if p.TakenAt.Valid {
		api.TakenAt = &p.TakenAt.Time
	}
	if p.Blurhash.Valid {
		api.Blurhash = p.Blurhash.String
	}
	if p.Width.Valid {
		api.Width = int(p.Width.Int32)
	}
	if p.Height.Valid {
		api.Height = int(p.Height.Int32)
	}
	if p.SmallWidth.Valid {
		api.SmallWidth = int(p.SmallWidth.Int32)
	}
	if p.SmallHeight.Valid {
		api.SmallHeight = int(p.SmallHeight.Int32)
	}
	if p.LargeWidth.Valid {
		api.LargeWidth = int(p.LargeWidth.Int32)
	}
	if p.LargeHeight.Valid {
		api.LargeHeight = int(p.LargeHeight.Int32)
	}
	if p.SizeOriginal.Valid {
		api.SizeOriginal = int(p.SizeOriginal.Int32)
	}
	if p.SizeSmall.Valid {
		api.SizeSmall = int(p.SizeSmall.Int32)
	}
	if p.SizeLarge.Valid {
		api.SizeLarge = int(p.SizeLarge.Int32)
	}
	if p.DurationSec.Valid {
		api.DurationSec = int(p.DurationSec.Int32)
	}
	if p.VideoCodec.Valid {
		api.VideoCodec = p.VideoCodec.String
	}
	if p.CameraMake.Valid {
		api.CameraMake = p.CameraMake.String
	}
	if p.CameraModel.Valid {
		api.CameraModel = p.CameraModel.String
	}
	if p.Lens.Valid {
		api.Lens = p.Lens.String
	}
	if p.ISO.Valid {
		api.ISO = int(p.ISO.Int32)
	}
	if p.Aperture.Valid {
		api.Aperture = p.Aperture.Float64
	}
	if p.ShutterSpeed.Valid {
		api.ShutterSpeed = p.ShutterSpeed.String
	}
	if p.FocalLength.Valid {
		api.FocalLength = p.FocalLength.Float64
	}
	if p.Flash.Valid {
		api.Flash = p.Flash.Bool
	}
	if p.GPSLat.Valid {
		api.GPSLat = p.GPSLat.Float64
	}
	if p.GPSLon.Valid {
		api.GPSLon = p.GPSLon.Float64
	}
	if p.GPSAltitude.Valid {
		api.GPSAltitude = p.GPSAltitude.Float64
	}
	if p.PlaceID.Valid {
		api.PlaceID = p.PlaceID.String
	}
	if p.Comment.Valid {
		api.Comment = p.Comment.String
	}

	return api
}

// GeneratePhotoURLs generates URLs for a photo based on its ID.
func GeneratePhotoURLs(id string, photoType PhotoType) PhotoURLs {
	prefix1 := id[0:2]
	prefix2 := id[2:4]
	basePath := "/" + prefix1 + "/" + prefix2 + "/" + id

	urls := PhotoURLs{
		Small: basePath + "_s.webp",
	}

	if photoType == PhotoTypePhoto {
		urls.Large = basePath + "_l.webp"
	} else {
		urls.Video = basePath + ".mp4"
	}

	return urls
}
