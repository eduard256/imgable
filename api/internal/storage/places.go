// Package storage provides place-related database operations.
package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Place represents a geographic location.
type Place struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	NameSource string    `json:"name_source,omitempty"`
	Country    *string   `json:"country,omitempty"`
	City       *string   `json:"city,omitempty"`
	Address    *string   `json:"address,omitempty"`
	GPSLat     float64   `json:"gps_lat"`
	GPSLon     float64   `json:"gps_lon"`
	RadiusM    int       `json:"radius_m,omitempty"`
	PhotoCount int       `json:"photo_count"`
	CreatedAt  time.Time `json:"created_at,omitempty"`
	UpdatedAt  time.Time `json:"updated_at,omitempty"`
}

// ListPlaces returns all places with at least one photo.
func (s *Storage) ListPlaces(ctx context.Context) ([]Place, error) {
	query := `
		SELECT id, name, name_source, country, city, address, gps_lat, gps_lon, radius_m, photo_count, created_at, updated_at
		FROM places
		WHERE photo_count > 0
		ORDER BY photo_count DESC
	`

	rows, err := s.db.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("query places: %w", err)
	}
	defer rows.Close()

	var places []Place
	for rows.Next() {
		var p Place
		var country, city, address sql.NullString

		if err := rows.Scan(&p.ID, &p.Name, &p.NameSource, &country, &city, &address, &p.GPSLat, &p.GPSLon, &p.RadiusM, &p.PhotoCount, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan place: %w", err)
		}

		if country.Valid {
			p.Country = &country.String
		}
		if city.Valid {
			p.City = &city.String
		}
		if address.Valid {
			p.Address = &address.String
		}

		places = append(places, p)
	}

	return places, nil
}

// GetPlace returns a place by ID.
func (s *Storage) GetPlace(ctx context.Context, id string) (*Place, error) {
	query := `
		SELECT id, name, name_source, country, city, address, gps_lat, gps_lon, radius_m, photo_count, created_at, updated_at
		FROM places
		WHERE id = $1
	`

	var p Place
	var country, city, address sql.NullString

	err := s.db.QueryRow(ctx, query, id).Scan(&p.ID, &p.Name, &p.NameSource, &country, &city, &address, &p.GPSLat, &p.GPSLon, &p.RadiusM, &p.PhotoCount, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		if err.Error() == "no rows in result set" {
			return nil, nil
		}
		return nil, fmt.Errorf("query place: %w", err)
	}

	if country.Valid {
		p.Country = &country.String
	}
	if city.Valid {
		p.City = &city.String
	}
	if address.Valid {
		p.Address = &address.String
	}

	return &p, nil
}

// GetPlacePhotos returns photos at a specific place with pagination.
func (s *Storage) GetPlacePhotos(ctx context.Context, placeID string, limit int, cursor *PhotoCursor) ([]PhotoListItem, *PhotoCursor, error) {
	if limit <= 0 || limit > 500 {
		limit = 100
	}

	args := []interface{}{placeID}
	argNum := 2

	cursorCond := ""
	if cursor != nil {
		if cursor.TakenAt != nil {
			cursorCond = fmt.Sprintf(" AND (taken_at < $%d OR (taken_at = $%d AND id < $%d))", argNum, argNum, argNum+1)
			args = append(args, *cursor.TakenAt, cursor.ID)
			argNum += 2
		} else {
			cursorCond = fmt.Sprintf(" AND id < $%d", argNum)
			args = append(args, cursor.ID)
			argNum++
		}
	}

	args = append(args, limit+1)

	query := fmt.Sprintf(`
		SELECT id, type, blurhash, small_width, small_height, taken_at, is_favorite, duration_sec
		FROM photos
		WHERE place_id = $1 AND status = 'ready' AND deleted_at IS NULL%s
		ORDER BY taken_at DESC NULLS LAST, id DESC
		LIMIT $%d
	`, cursorCond, argNum)

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, nil, fmt.Errorf("query place photos: %w", err)
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
