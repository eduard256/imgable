// Package storage provides photo-related database operations.
package storage

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"
)

// Photo represents a photo or video in the gallery.
type Photo struct {
	ID           string  `json:"id"`
	Type         string  `json:"type"`
	Status       string  `json:"status,omitempty"`
	Blurhash     *string `json:"blurhash,omitempty"`
	Width        *int    `json:"width,omitempty"`
	Height       *int    `json:"height,omitempty"`
	SmallWidth   *int    `json:"small_width,omitempty"`
	SmallHeight  *int    `json:"small_height,omitempty"`
	LargeWidth   *int    `json:"large_width,omitempty"`
	LargeHeight  *int    `json:"large_height,omitempty"`
	SizeOriginal *int    `json:"size_original,omitempty"`
	SizeSmall    *int    `json:"size_small,omitempty"`
	SizeLarge    *int    `json:"size_large,omitempty"`
	TakenAt          *time.Time `json:"taken_at,omitempty"`
	CreatedAt        time.Time  `json:"created_at"`
	UpdatedAt        time.Time  `json:"updated_at"`
	IsFavorite       bool       `json:"is_favorite"`
	Comment          *string    `json:"comment,omitempty"`
	OriginalFilename *string    `json:"original_filename,omitempty"`
	OriginalPath     *string    `json:"original_path,omitempty"`
	DurationSec      *int       `json:"duration_sec,omitempty"`
	VideoCodec       *string    `json:"video_codec,omitempty"`
	CameraMake       *string    `json:"camera_make,omitempty"`
	CameraModel      *string    `json:"camera_model,omitempty"`
	Lens             *string    `json:"lens,omitempty"`
	ISO              *int       `json:"iso,omitempty"`
	Aperture         *float64   `json:"aperture,omitempty"`
	ShutterSpeed     *string    `json:"shutter_speed,omitempty"`
	FocalLength      *float64   `json:"focal_length,omitempty"`
	Flash            *bool      `json:"flash,omitempty"`
	GPSLat           *float64   `json:"gps_lat,omitempty"`
	GPSLon           *float64   `json:"gps_lon,omitempty"`
	GPSAltitude      *float64   `json:"gps_altitude,omitempty"`
	PlaceID          *string    `json:"place_id,omitempty"`
}

// PhotoListItem is a minimal photo representation for list views.
// Optimized for fast transfer and rendering.
type PhotoListItem struct {
	ID         string     `json:"id"`
	Type       string     `json:"type"`
	Blurhash   *string    `json:"blurhash,omitempty"`
	Width      int        `json:"w"`
	Height     int        `json:"h"`
	TakenAt    *time.Time `json:"taken_at,omitempty"`
	IsFavorite bool       `json:"is_favorite"`
	Duration   *int       `json:"duration,omitempty"` // Only for videos
}

// PhotoGroup represents a month group with photo count.
type PhotoGroup struct {
	Key   string `json:"key"`   // "2024-12" or "unknown"
	Label string `json:"label"` // "December 2024" or "No date"
	Count int    `json:"count"`
}

// PhotoCursor represents pagination cursor for stable scrolling.
type PhotoCursor struct {
	TakenAt *time.Time `json:"t,omitempty"`
	ID      string     `json:"i"`
}

// PhotoListParams contains parameters for listing photos.
type PhotoListParams struct {
	Limit      int
	Cursor     *PhotoCursor
	Month      string // "2024-12" or "unknown"
	Type       string // "photo", "video", or ""
	Favorite   *bool
	Sort       string // "date", "created", "size"
	Order      string // "desc", "asc"
}

// GetPhotoGroups returns photo counts grouped by month.
// The "unknown" group contains photos without taken_at date.
func (s *Storage) GetPhotoGroups(ctx context.Context, photoType string) ([]PhotoGroup, int, error) {
	// Build query based on type filter
	typeFilter := ""
	args := []interface{}{}
	argNum := 1

	if photoType != "" && photoType != "all" {
		typeFilter = fmt.Sprintf(" AND type = $%d", argNum)
		args = append(args, photoType)
		argNum++
	}

	query := fmt.Sprintf(`
		SELECT
			COALESCE(TO_CHAR(taken_at, 'YYYY-MM'), 'unknown') as month_key,
			COUNT(*) as count
		FROM photos
		WHERE status = 'ready'%s
		GROUP BY month_key
		ORDER BY month_key DESC
	`, typeFilter)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, fmt.Errorf("query photo groups: %w", err)
	}
	defer rows.Close()

	var groups []PhotoGroup
	total := 0
	unknownGroup := PhotoGroup{Key: "unknown", Label: "No date", Count: 0}

	for rows.Next() {
		var key string
		var count int
		if err := rows.Scan(&key, &count); err != nil {
			return nil, 0, fmt.Errorf("scan photo group: %w", err)
		}

		total += count

		if key == "unknown" {
			unknownGroup.Count = count
		} else {
			groups = append(groups, PhotoGroup{
				Key:   key,
				Label: formatMonthLabel(key),
				Count: count,
			})
		}
	}

	// Add unknown group at the end if it has photos
	if unknownGroup.Count > 0 {
		groups = append(groups, unknownGroup)
	}

	return groups, total, nil
}

// ListPhotos returns a paginated list of photos.
// Uses cursor-based pagination for stable results.
func (s *Storage) ListPhotos(ctx context.Context, params PhotoListParams) ([]PhotoListItem, *PhotoCursor, error) {
	// Build query dynamically
	conditions := []string{"status = 'ready'"}
	args := []interface{}{}
	argNum := 1

	// Type filter
	if params.Type != "" && params.Type != "all" {
		conditions = append(conditions, fmt.Sprintf("type = $%d", argNum))
		args = append(args, params.Type)
		argNum++
	}

	// Month filter
	if params.Month != "" {
		if params.Month == "unknown" {
			conditions = append(conditions, "taken_at IS NULL")
		} else {
			conditions = append(conditions, fmt.Sprintf("TO_CHAR(taken_at, 'YYYY-MM') = $%d", argNum))
			args = append(args, params.Month)
			argNum++
		}
	}

	// Favorite filter
	if params.Favorite != nil {
		conditions = append(conditions, fmt.Sprintf("is_favorite = $%d", argNum))
		args = append(args, *params.Favorite)
		argNum++
	}

	// Cursor pagination
	sortCol := "taken_at"
	switch params.Sort {
	case "created":
		sortCol = "created_at"
	case "size":
		sortCol = "size_original"
	}

	sortOrder := "DESC"
	if params.Order == "asc" {
		sortOrder = "ASC"
	}

	if params.Cursor != nil {
		var cursorCond string
		if params.Cursor.TakenAt != nil {
			if sortOrder == "DESC" {
				cursorCond = fmt.Sprintf("(%s < $%d OR (%s = $%d AND id < $%d))", sortCol, argNum, sortCol, argNum, argNum+1)
			} else {
				cursorCond = fmt.Sprintf("(%s > $%d OR (%s = $%d AND id > $%d))", sortCol, argNum, sortCol, argNum, argNum+1)
			}
			args = append(args, *params.Cursor.TakenAt, params.Cursor.ID)
			argNum += 2
		} else {
			// For photos without taken_at, use id only
			if sortOrder == "DESC" {
				cursorCond = fmt.Sprintf("id < $%d", argNum)
			} else {
				cursorCond = fmt.Sprintf("id > $%d", argNum)
			}
			args = append(args, params.Cursor.ID)
			argNum++
		}
		conditions = append(conditions, cursorCond)
	}

	// Build WHERE clause
	whereClause := ""
	for i, cond := range conditions {
		if i == 0 {
			whereClause = "WHERE " + cond
		} else {
			whereClause += " AND " + cond
		}
	}

	// Limit
	limit := params.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	query := fmt.Sprintf(`
		SELECT id, type, blurhash, small_width, small_height, taken_at, is_favorite, duration_sec
		FROM photos
		%s
		ORDER BY %s %s NULLS LAST, id %s
		LIMIT $%d
	`, whereClause, sortCol, sortOrder, sortOrder, argNum)
	args = append(args, limit+1) // +1 to check if there are more

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query photos: %w", err)
	}
	defer rows.Close()

	var photos []PhotoListItem
	for rows.Next() {
		var p PhotoListItem
		var smallWidth, smallHeight sql.NullInt32
		var takenAt sql.NullTime
		var blurhash sql.NullString
		var duration sql.NullInt32

		if err := rows.Scan(&p.ID, &p.Type, &blurhash, &smallWidth, &smallHeight, &takenAt, &p.IsFavorite, &duration); err != nil {
			return nil, nil, fmt.Errorf("scan photo: %w", err)
		}

		if blurhash.Valid {
			p.Blurhash = &blurhash.String
		}
		if smallWidth.Valid {
			p.Width = int(smallWidth.Int32)
		}
		if smallHeight.Valid {
			p.Height = int(smallHeight.Int32)
		}
		if takenAt.Valid {
			p.TakenAt = &takenAt.Time
		}
		if duration.Valid {
			d := int(duration.Int32)
			p.Duration = &d
		}

		photos = append(photos, p)
	}

	// Check if there are more results
	var nextCursor *PhotoCursor
	if len(photos) > limit {
		photos = photos[:limit]
		last := photos[len(photos)-1]
		nextCursor = &PhotoCursor{
			TakenAt: last.TakenAt,
			ID:      last.ID,
		}
	}

	return photos, nextCursor, nil
}

// GetPhoto returns full photo details by ID.
func (s *Storage) GetPhoto(ctx context.Context, id string) (*Photo, error) {
	query := `
		SELECT
			id, type, status, blurhash,
			width, height,
			small_width, small_height,
			large_width, large_height,
			size_original, size_small, size_large,
			taken_at, created_at, updated_at,
			is_favorite, comment,
			original_filename, original_path,
			duration_sec, video_codec,
			camera_make, camera_model, lens,
			iso, aperture, shutter_speed, focal_length, flash,
			gps_lat, gps_lon, gps_altitude, place_id
		FROM photos
		WHERE id = $1
	`

	var p Photo
	var blurhash, comment, originalFilename, originalPath, videoCodec sql.NullString
	var cameraMake, cameraModel, lens, shutterSpeed sql.NullString
	var width, height, smallWidth, smallHeight sql.NullInt32
	var largeWidth, largeHeight, sizeOriginal, sizeSmall, sizeLarge sql.NullInt32
	var durationSec, iso sql.NullInt32
	var aperture, focalLength, gpsLat, gpsLon, gpsAltitude sql.NullFloat64
	var flash sql.NullBool
	var takenAt sql.NullTime
	var placeID sql.NullString

	err := s.db.QueryRow(ctx, query, id).Scan(
		&p.ID, &p.Type, &p.Status, &blurhash,
		&width, &height,
		&smallWidth, &smallHeight,
		&largeWidth, &largeHeight,
		&sizeOriginal, &sizeSmall, &sizeLarge,
		&takenAt, &p.CreatedAt, &p.UpdatedAt,
		&p.IsFavorite, &comment,
		&originalFilename, &originalPath,
		&durationSec, &videoCodec,
		&cameraMake, &cameraModel, &lens,
		&iso, &aperture, &shutterSpeed, &focalLength, &flash,
		&gpsLat, &gpsLon, &gpsAltitude, &placeID,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("query photo: %w", err)
	}

	// Map nullable fields
	if blurhash.Valid {
		p.Blurhash = &blurhash.String
	}
	if width.Valid {
		w := int(width.Int32)
		p.Width = &w
	}
	if height.Valid {
		h := int(height.Int32)
		p.Height = &h
	}
	if smallWidth.Valid {
		w := int(smallWidth.Int32)
		p.SmallWidth = &w
	}
	if smallHeight.Valid {
		h := int(smallHeight.Int32)
		p.SmallHeight = &h
	}
	if largeWidth.Valid {
		w := int(largeWidth.Int32)
		p.LargeWidth = &w
	}
	if largeHeight.Valid {
		h := int(largeHeight.Int32)
		p.LargeHeight = &h
	}
	if sizeOriginal.Valid {
		s := int(sizeOriginal.Int32)
		p.SizeOriginal = &s
	}
	if sizeSmall.Valid {
		s := int(sizeSmall.Int32)
		p.SizeSmall = &s
	}
	if sizeLarge.Valid {
		s := int(sizeLarge.Int32)
		p.SizeLarge = &s
	}
	if takenAt.Valid {
		p.TakenAt = &takenAt.Time
	}
	if comment.Valid {
		p.Comment = &comment.String
	}
	if originalFilename.Valid {
		p.OriginalFilename = &originalFilename.String
	}
	if originalPath.Valid {
		p.OriginalPath = &originalPath.String
	}
	if durationSec.Valid {
		d := int(durationSec.Int32)
		p.DurationSec = &d
	}
	if videoCodec.Valid {
		p.VideoCodec = &videoCodec.String
	}
	if cameraMake.Valid {
		p.CameraMake = &cameraMake.String
	}
	if cameraModel.Valid {
		p.CameraModel = &cameraModel.String
	}
	if lens.Valid {
		p.Lens = &lens.String
	}
	if iso.Valid {
		i := int(iso.Int32)
		p.ISO = &i
	}
	if aperture.Valid {
		p.Aperture = &aperture.Float64
	}
	if shutterSpeed.Valid {
		p.ShutterSpeed = &shutterSpeed.String
	}
	if focalLength.Valid {
		p.FocalLength = &focalLength.Float64
	}
	if flash.Valid {
		p.Flash = &flash.Bool
	}
	if gpsLat.Valid {
		p.GPSLat = &gpsLat.Float64
	}
	if gpsLon.Valid {
		p.GPSLon = &gpsLon.Float64
	}
	if gpsAltitude.Valid {
		p.GPSAltitude = &gpsAltitude.Float64
	}
	if placeID.Valid {
		p.PlaceID = &placeID.String
	}

	return &p, nil
}

// UpdatePhotoComment updates the comment on a photo.
func (s *Storage) UpdatePhotoComment(ctx context.Context, id string, comment *string) error {
	var sqlComment sql.NullString
	if comment != nil && *comment != "" {
		sqlComment = sql.NullString{String: *comment, Valid: true}
	}

	_, err := s.db.Exec(ctx, `
		UPDATE photos SET comment = $1, updated_at = NOW() WHERE id = $2
	`, sqlComment, id)
	return err
}

// DeletePhoto deletes a photo and returns its file paths for cleanup.
func (s *Storage) DeletePhoto(ctx context.Context, id string) (*Photo, error) {
	// Get photo info first
	photo, err := s.GetPhoto(ctx, id)
	if err != nil {
		return nil, err
	}
	if photo == nil {
		return nil, nil
	}

	// Delete from database (CASCADE handles album_photos)
	_, err = s.db.Exec(ctx, "DELETE FROM photos WHERE id = $1", id)
	if err != nil {
		return nil, fmt.Errorf("delete photo: %w", err)
	}

	return photo, nil
}

// DeletePhotos deletes multiple photos and returns their info for cleanup.
func (s *Storage) DeletePhotos(ctx context.Context, ids []string) ([]Photo, error) {
	if len(ids) == 0 {
		return nil, nil
	}

	// Get photos info first
	var photos []Photo
	for _, id := range ids {
		photo, err := s.GetPhoto(ctx, id)
		if err != nil {
			return nil, err
		}
		if photo != nil {
			photos = append(photos, *photo)
		}
	}

	if len(photos) == 0 {
		return nil, nil
	}

	// Delete from database
	_, err := s.db.Exec(ctx, "DELETE FROM photos WHERE id = ANY($1)", ids)
	if err != nil {
		return nil, fmt.Errorf("delete photos: %w", err)
	}

	return photos, nil
}

// SetPhotoFavorite sets the favorite status of a photo.
func (s *Storage) SetPhotoFavorite(ctx context.Context, id string, favorite bool) error {
	_, err := s.db.Exec(ctx, `
		UPDATE photos SET is_favorite = $1, updated_at = NOW() WHERE id = $2
	`, favorite, id)
	return err
}

// PhotoExists checks if a photo exists.
func (s *Storage) PhotoExists(ctx context.Context, id string) (bool, error) {
	var exists bool
	err := s.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM photos WHERE id = $1)", id).Scan(&exists)
	return exists, err
}

// EncodeCursor encodes a cursor to base64 string.
func EncodeCursor(cursor *PhotoCursor) string {
	if cursor == nil {
		return ""
	}
	data, _ := json.Marshal(cursor)
	return base64.URLEncoding.EncodeToString(data)
}

// DecodeCursor decodes a base64 cursor string.
func DecodeCursor(s string) *PhotoCursor {
	if s == "" {
		return nil
	}
	data, err := base64.URLEncoding.DecodeString(s)
	if err != nil {
		return nil
	}
	var cursor PhotoCursor
	if err := json.Unmarshal(data, &cursor); err != nil {
		return nil
	}
	return &cursor
}

// formatMonthLabel formats "2024-12" to "December 2024".
func formatMonthLabel(key string) string {
	if len(key) != 7 {
		return key
	}

	months := map[string]string{
		"01": "January", "02": "February", "03": "March",
		"04": "April", "05": "May", "06": "June",
		"07": "July", "08": "August", "09": "September",
		"10": "October", "11": "November", "12": "December",
	}

	year := key[:4]
	month := key[5:7]

	if name, ok := months[month]; ok {
		return name + " " + year
	}
	return key
}
