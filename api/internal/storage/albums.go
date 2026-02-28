// Package storage provides album-related database operations.
package storage

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"time"
)

// Album represents a photo album.
type Album struct {
	ID           string    `json:"id"`
	Type         string    `json:"type"`
	Name         string    `json:"name"`
	Description  *string   `json:"description,omitempty"`
	CoverPhotoID *string   `json:"cover_photo_id,omitempty"`
	PlaceID      *string   `json:"place_id,omitempty"`
	PhotoCount   int       `json:"photo_count"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// AlbumWithCover includes album data with cover photo URL info.
type AlbumWithCover struct {
	Album
	CoverID *string `json:"cover_id,omitempty"` // ID of cover photo for URL generation
}

// ListAlbums returns all albums ordered by type and update time.
func (s *Storage) ListAlbums(ctx context.Context) ([]AlbumWithCover, error) {
	query := `
		SELECT
			a.id, a.type, a.name, a.description, a.cover_photo_id, a.place_id, a.photo_count, a.created_at, a.updated_at,
			COALESCE(a.cover_photo_id, (
				SELECT ap.photo_id
				FROM album_photos ap
				WHERE ap.album_id = a.id
				ORDER BY ap.added_at DESC
				LIMIT 1
			)) as cover_id
		FROM albums a
		ORDER BY
			CASE a.type
				WHEN 'favorites' THEN 1
				WHEN 'manual' THEN 2
				WHEN 'place' THEN 3
			END,
			a.updated_at DESC
	`

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query albums: %w", err)
	}
	defer rows.Close()

	var albums []AlbumWithCover
	for rows.Next() {
		var a AlbumWithCover
		var description, coverPhotoID, placeID, coverID sql.NullString

		if err := rows.Scan(
			&a.ID, &a.Type, &a.Name, &description, &coverPhotoID, &placeID, &a.PhotoCount, &a.CreatedAt, &a.UpdatedAt,
			&coverID,
		); err != nil {
			return nil, fmt.Errorf("scan album: %w", err)
		}

		if description.Valid {
			a.Description = &description.String
		}
		if coverPhotoID.Valid {
			a.CoverPhotoID = &coverPhotoID.String
		}
		if placeID.Valid {
			a.PlaceID = &placeID.String
		}
		if coverID.Valid {
			a.CoverID = &coverID.String
		}

		albums = append(albums, a)
	}

	return albums, nil
}

// GetAlbum returns an album by ID.
func (s *Storage) GetAlbum(ctx context.Context, id string) (*Album, error) {
	query := `
		SELECT id, type, name, description, cover_photo_id, place_id, photo_count, created_at, updated_at
		FROM albums
		WHERE id = $1
	`

	var a Album
	var description, coverPhotoID, placeID sql.NullString

	err := s.db.QueryRow(ctx, query, id).Scan(
		&a.ID, &a.Type, &a.Name, &description, &coverPhotoID, &placeID, &a.PhotoCount, &a.CreatedAt, &a.UpdatedAt,
	)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("query album: %w", err)
	}

	if description.Valid {
		a.Description = &description.String
	}
	if coverPhotoID.Valid {
		a.CoverPhotoID = &coverPhotoID.String
	}
	if placeID.Valid {
		a.PlaceID = &placeID.String
	}

	return &a, nil
}

// CreateAlbumParams contains parameters for creating an album.
type CreateAlbumParams struct {
	Name        string
	Description *string
}

// CreateAlbum creates a new manual album.
func (s *Storage) CreateAlbum(ctx context.Context, params CreateAlbumParams) (string, error) {
	id := generateAlbumID()

	var description sql.NullString
	if params.Description != nil && *params.Description != "" {
		description = sql.NullString{String: *params.Description, Valid: true}
	}

	_, err := s.db.Exec(ctx, `
		INSERT INTO albums (id, type, name, description, photo_count, created_at, updated_at)
		VALUES ($1, 'manual', $2, $3, 0, NOW(), NOW())
	`, id, params.Name, description)
	if err != nil {
		return "", fmt.Errorf("create album: %w", err)
	}

	return id, nil
}

// UpdateAlbumParams contains parameters for updating an album.
type UpdateAlbumParams struct {
	Name         *string
	Description  *string
	CoverPhotoID *string
}

// UpdateAlbum updates an album's properties.
// Only updates fields that are non-nil.
func (s *Storage) UpdateAlbum(ctx context.Context, id string, params UpdateAlbumParams) error {
	// Get current album to check type
	album, err := s.GetAlbum(ctx, id)
	if err != nil {
		return err
	}
	if album == nil {
		return fmt.Errorf("album not found")
	}

	// Cannot modify system albums
	if album.Type == "favorites" || album.Type == "place" {
		return fmt.Errorf("cannot modify system album")
	}

	// Build dynamic update query
	sets := []string{}
	args := []interface{}{}
	argNum := 1

	if params.Name != nil {
		sets = append(sets, fmt.Sprintf("name = $%d", argNum))
		args = append(args, *params.Name)
		argNum++
	}

	if params.Description != nil {
		if *params.Description == "" {
			sets = append(sets, fmt.Sprintf("description = NULL"))
		} else {
			sets = append(sets, fmt.Sprintf("description = $%d", argNum))
			args = append(args, *params.Description)
			argNum++
		}
	}

	if params.CoverPhotoID != nil {
		if *params.CoverPhotoID == "" {
			sets = append(sets, fmt.Sprintf("cover_photo_id = NULL"))
		} else {
			sets = append(sets, fmt.Sprintf("cover_photo_id = $%d", argNum))
			args = append(args, *params.CoverPhotoID)
			argNum++
		}
	}

	if len(sets) == 0 {
		return nil // Nothing to update
	}

	sets = append(sets, "updated_at = NOW()")
	args = append(args, id)

	query := fmt.Sprintf("UPDATE albums SET %s WHERE id = $%d", joinStrings(sets, ", "), argNum)
	_, err = s.db.Exec(ctx, query, args...)
	return err
}

// DeleteAlbum deletes an album.
// Cannot delete system albums (favorites).
func (s *Storage) DeleteAlbum(ctx context.Context, id string) error {
	// Check album type
	album, err := s.GetAlbum(ctx, id)
	if err != nil {
		return err
	}
	if album == nil {
		return nil // Already deleted
	}

	if album.Type == "favorites" {
		return fmt.Errorf("cannot delete favorites album")
	}

	_, err = s.db.Exec(ctx, "DELETE FROM albums WHERE id = $1", id)
	return err
}

// GetAlbumPhotos returns photos in an album with pagination.
func (s *Storage) GetAlbumPhotos(ctx context.Context, albumID string, limit int, cursor *PhotoCursor) ([]PhotoListItem, *PhotoCursor, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	args := []interface{}{albumID}
	argNum := 2

	cursorCond := ""
	if cursor != nil {
		if cursor.TakenAt != nil {
			cursorCond = fmt.Sprintf(" AND (p.taken_at < $%d OR (p.taken_at = $%d AND p.id < $%d))", argNum, argNum, argNum+1)
			args = append(args, *cursor.TakenAt, cursor.ID)
			argNum += 2
		} else {
			cursorCond = fmt.Sprintf(" AND p.id < $%d", argNum)
			args = append(args, cursor.ID)
			argNum++
		}
	}

	args = append(args, limit+1)

	query := fmt.Sprintf(`
		SELECT p.id, p.type, p.blurhash, p.small_width, p.small_height, p.taken_at, p.is_favorite, p.duration_sec
		FROM photos p
		JOIN album_photos ap ON ap.photo_id = p.id
		WHERE ap.album_id = $1 AND p.status = 'ready' AND p.deleted_at IS NULL%s
		ORDER BY COALESCE(ap.sort_order, 0), p.taken_at DESC NULLS LAST, p.id DESC
		LIMIT $%d
	`, cursorCond, argNum)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query album photos: %w", err)
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

// AddPhotosToAlbum adds photos to an album.
// Returns the number of photos actually added (skips duplicates).
func (s *Storage) AddPhotosToAlbum(ctx context.Context, albumID string, photoIDs []string) (int, error) {
	if len(photoIDs) == 0 {
		return 0, nil
	}

	// Use INSERT ON CONFLICT to handle duplicates
	added := 0
	for _, photoID := range photoIDs {
		result, err := s.db.Exec(ctx, `
			INSERT INTO album_photos (album_id, photo_id, added_at)
			VALUES ($1, $2, NOW())
			ON CONFLICT (album_id, photo_id) DO NOTHING
		`, albumID, photoID)
		if err != nil {
			return added, fmt.Errorf("add photo to album: %w", err)
		}
		if result.RowsAffected() > 0 {
			added++
		}
	}

	return added, nil
}

// RemovePhotoFromAlbum removes a photo from an album.
func (s *Storage) RemovePhotoFromAlbum(ctx context.Context, albumID, photoID string) error {
	_, err := s.db.Exec(ctx, `
		DELETE FROM album_photos WHERE album_id = $1 AND photo_id = $2
	`, albumID, photoID)
	return err
}

// RemovePhotosFromAlbum removes multiple photos from an album.
// Returns the number of photos actually removed.
func (s *Storage) RemovePhotosFromAlbum(ctx context.Context, albumID string, photoIDs []string) (int, error) {
	if len(photoIDs) == 0 {
		return 0, nil
	}

	// Build query with multiple IDs
	args := []interface{}{albumID}
	placeholders := ""
	for i, id := range photoIDs {
		if i > 0 {
			placeholders += ", "
		}
		placeholders += fmt.Sprintf("$%d", i+2)
		args = append(args, id)
	}

	result, err := s.db.Exec(ctx, fmt.Sprintf(`
		DELETE FROM album_photos WHERE album_id = $1 AND photo_id IN (%s)
	`, placeholders), args...)
	if err != nil {
		return 0, fmt.Errorf("remove photos from album: %w", err)
	}

	return int(result.RowsAffected()), nil
}

// GetPhotoAlbums returns all albums that contain a specific photo.
func (s *Storage) GetPhotoAlbums(ctx context.Context, photoID string) ([]Album, error) {
	query := `
		SELECT a.id, a.type, a.name, a.description, a.cover_photo_id, a.place_id, a.photo_count, a.created_at, a.updated_at
		FROM albums a
		JOIN album_photos ap ON ap.album_id = a.id
		WHERE ap.photo_id = $1
		ORDER BY a.name
	`

	rows, err := s.db.Query(ctx, query, photoID)
	if err != nil {
		return nil, fmt.Errorf("query photo albums: %w", err)
	}
	defer rows.Close()

	var albums []Album
	for rows.Next() {
		var a Album
		var description, coverPhotoID, placeID sql.NullString

		if err := rows.Scan(&a.ID, &a.Type, &a.Name, &description, &coverPhotoID, &placeID, &a.PhotoCount, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan album: %w", err)
		}

		if description.Valid {
			a.Description = &description.String
		}
		if coverPhotoID.Valid {
			a.CoverPhotoID = &coverPhotoID.String
		}
		if placeID.Valid {
			a.PlaceID = &placeID.String
		}

		albums = append(albums, a)
	}

	return albums, nil
}

// generateAlbumID generates a unique album ID.
func generateAlbumID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return "album_" + hex.EncodeToString(b)
}

// joinStrings joins strings with a separator.
func joinStrings(strs []string, sep string) string {
	if len(strs) == 0 {
		return ""
	}
	result := strs[0]
	for i := 1; i < len(strs); i++ {
		result += sep + strs[i]
	}
	return result
}
