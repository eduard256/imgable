// Package metadata provides EXIF metadata extraction functionality.
package metadata

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/rwcarlsen/goexif/exif"
	"github.com/rwcarlsen/goexif/mknote"

	"github.com/eduard256/imgable/shared/pkg/logger"
)

func init() {
	// Register maker note parsers for better camera support
	exif.RegisterParsers(mknote.All...)
}

// ImageMetadata holds extracted EXIF metadata.
type ImageMetadata struct {
	// When the photo was taken
	TakenAt *time.Time

	// Camera information
	CameraMake  string
	CameraModel string
	Lens        string

	// Exposure settings
	ISO          int
	Aperture     float64
	ShutterSpeed string
	FocalLength  float64
	Flash        bool

	// GPS coordinates
	GPSLat      *float64
	GPSLon      *float64
	GPSAltitude *float64

	// Image dimensions (from EXIF, may differ from actual)
	Width  int
	Height int

	// Orientation (1-8, EXIF rotation)
	Orientation int
}

// Extractor extracts EXIF metadata from image files.
type Extractor struct {
	logger *logger.Logger
}

// NewExtractor creates a new metadata extractor.
func NewExtractor(log *logger.Logger) *Extractor {
	return &Extractor{
		logger: log.WithField("component", "exif-extractor"),
	}
}

// Extract extracts EXIF metadata from an image file.
// Returns nil if no EXIF data is found (not an error).
func (e *Extractor) Extract(path string) (*ImageMetadata, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	x, err := exif.Decode(file)
	if err != nil {
		// No EXIF data is not an error
		if err == exif.ErrNoExif {
			return nil, nil
		}
		e.logger.WithError(err).WithField("path", path).Debug("failed to decode EXIF")
		return nil, nil
	}

	meta := &ImageMetadata{}

	// Date/time taken
	if dt, err := x.DateTime(); err == nil {
		meta.TakenAt = &dt
	}

	// Camera make
	if tag, err := x.Get(exif.Make); err == nil {
		if val, err := tag.StringVal(); err == nil {
			meta.CameraMake = strings.TrimSpace(val)
		}
	}

	// Camera model
	if tag, err := x.Get(exif.Model); err == nil {
		if val, err := tag.StringVal(); err == nil {
			meta.CameraModel = strings.TrimSpace(val)
		}
	}

	// Lens model
	if tag, err := x.Get(exif.LensModel); err == nil {
		if val, err := tag.StringVal(); err == nil {
			meta.Lens = strings.TrimSpace(val)
		}
	}

	// ISO
	if tag, err := x.Get(exif.ISOSpeedRatings); err == nil {
		if val, err := tag.Int(0); err == nil {
			meta.ISO = val
		}
	}

	// Aperture (F-number)
	if tag, err := x.Get(exif.FNumber); err == nil {
		if num, denom, err := tag.Rat2(0); err == nil && denom != 0 {
			meta.Aperture = float64(num) / float64(denom)
		}
	}

	// Shutter speed (as string like "1/120")
	if tag, err := x.Get(exif.ExposureTime); err == nil {
		if num, denom, err := tag.Rat2(0); err == nil && denom != 0 {
			if denom == 1 {
				meta.ShutterSpeed = fmt.Sprintf("%d", num)
			} else {
				meta.ShutterSpeed = fmt.Sprintf("%d/%d", num, denom)
			}
		}
	}

	// Focal length
	if tag, err := x.Get(exif.FocalLength); err == nil {
		if num, denom, err := tag.Rat2(0); err == nil && denom != 0 {
			meta.FocalLength = float64(num) / float64(denom)
		}
	}

	// Flash
	if tag, err := x.Get(exif.Flash); err == nil {
		if val, err := tag.Int(0); err == nil {
			// Flash fired if bit 0 is set
			meta.Flash = (val & 1) == 1
		}
	}

	// GPS coordinates
	if lat, lon, err := x.LatLong(); err == nil {
		meta.GPSLat = &lat
		meta.GPSLon = &lon
	}

	// GPS altitude
	if tag, err := x.Get(exif.GPSAltitude); err == nil {
		if num, denom, err := tag.Rat2(0); err == nil && denom != 0 {
			alt := float64(num) / float64(denom)
			meta.GPSAltitude = &alt
		}
	}

	// Image dimensions
	if tag, err := x.Get(exif.PixelXDimension); err == nil {
		if val, err := tag.Int(0); err == nil {
			meta.Width = val
		}
	}
	if tag, err := x.Get(exif.PixelYDimension); err == nil {
		if val, err := tag.Int(0); err == nil {
			meta.Height = val
		}
	}

	// Orientation
	if tag, err := x.Get(exif.Orientation); err == nil {
		if val, err := tag.Int(0); err == nil {
			meta.Orientation = val
		}
	}

	return meta, nil
}

// HasGPS returns true if GPS coordinates are available.
func (m *ImageMetadata) HasGPS() bool {
	return m != nil && m.GPSLat != nil && m.GPSLon != nil
}

// GetCameraString returns a human-readable camera description.
func (m *ImageMetadata) GetCameraString() string {
	if m == nil {
		return ""
	}

	parts := []string{}
	if m.CameraMake != "" {
		parts = append(parts, m.CameraMake)
	}
	if m.CameraModel != "" {
		// Avoid duplicating make in model
		model := m.CameraModel
		if m.CameraMake != "" && strings.HasPrefix(model, m.CameraMake) {
			model = strings.TrimPrefix(model, m.CameraMake)
			model = strings.TrimSpace(model)
		}
		if model != "" {
			parts = append(parts, model)
		}
	}

	return strings.Join(parts, " ")
}
