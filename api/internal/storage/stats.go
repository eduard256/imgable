// Package storage provides statistics-related database operations.
package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// Stats represents gallery statistics.
type Stats struct {
	TotalPhotos    int64      `json:"total_photos"`
	TotalVideos    int64      `json:"total_videos"`
	TotalAlbums    int64      `json:"total_albums"`
	TotalPlaces    int64      `json:"total_places"`
	TotalFavorites int64      `json:"total_favorites"`
	StorageBytes   int64      `json:"storage_bytes"`
	StorageHuman   string     `json:"storage_human"`
	OldestPhoto    *time.Time `json:"oldest_photo,omitempty"`
	NewestPhoto    *time.Time `json:"newest_photo,omitempty"`
}

// GetStats returns gallery statistics.
func (s *Storage) GetStats(ctx context.Context) (*Stats, error) {
	stats := &Stats{}

	// Count photos and videos
	err := s.db.QueryRow(ctx, `
		SELECT
			COUNT(*) FILTER (WHERE type = 'photo' AND status = 'ready') as photos,
			COUNT(*) FILTER (WHERE type = 'video' AND status = 'ready') as videos,
			COUNT(*) FILTER (WHERE is_favorite = true AND status = 'ready') as favorites,
			COALESCE(SUM(COALESCE(size_small, 0) + COALESCE(size_large, 0) + COALESCE(size_original, 0)) FILTER (WHERE status = 'ready'), 0) as storage
		FROM photos
	`).Scan(&stats.TotalPhotos, &stats.TotalVideos, &stats.TotalFavorites, &stats.StorageBytes)
	if err != nil {
		return nil, fmt.Errorf("query photo stats: %w", err)
	}

	// Count albums (excluding empty place albums)
	err = s.db.QueryRow(ctx, "SELECT COUNT(*) FROM albums WHERE photo_count > 0 OR type = 'favorites'").Scan(&stats.TotalAlbums)
	if err != nil {
		return nil, fmt.Errorf("query album count: %w", err)
	}

	// Count places with photos
	err = s.db.QueryRow(ctx, "SELECT COUNT(*) FROM places WHERE photo_count > 0").Scan(&stats.TotalPlaces)
	if err != nil {
		return nil, fmt.Errorf("query place count: %w", err)
	}

	// Get date range
	var oldest, newest sql.NullTime
	err = s.db.QueryRow(ctx, `
		SELECT MIN(taken_at), MAX(taken_at)
		FROM photos
		WHERE status = 'ready' AND taken_at IS NOT NULL
	`).Scan(&oldest, &newest)
	if err != nil {
		return nil, fmt.Errorf("query date range: %w", err)
	}

	if oldest.Valid {
		stats.OldestPhoto = &oldest.Time
	}
	if newest.Valid {
		stats.NewestPhoto = &newest.Time
	}

	// Format storage size
	stats.StorageHuman = formatBytes(stats.StorageBytes)

	return stats, nil
}

// formatBytes formats bytes as human-readable string.
func formatBytes(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)

	switch {
	case bytes >= TB:
		return fmt.Sprintf("%.1f TB", float64(bytes)/TB)
	case bytes >= GB:
		return fmt.Sprintf("%.1f GB", float64(bytes)/GB)
	case bytes >= MB:
		return fmt.Sprintf("%.1f MB", float64(bytes)/MB)
	case bytes >= KB:
		return fmt.Sprintf("%.1f KB", float64(bytes)/KB)
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
