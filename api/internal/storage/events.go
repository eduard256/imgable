// Package storage provides event-related database operations for SSE.
package storage

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// Event represents a system event for real-time updates.
type Event struct {
	ID        int64           `json:"id"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
	CreatedAt time.Time       `json:"created_at"`
}

// EventType constants for different event types.
const (
	EventPhotoAdded     = "photo_added"
	EventPhotoUpdated   = "photo_updated"
	EventPhotoDeleted   = "photo_deleted"
	EventAlbumCreated   = "album_created"
	EventAlbumUpdated   = "album_updated"
	EventAlbumDeleted   = "album_deleted"
	EventPlaceCreated   = "place_created"
	EventPlaceUpdated   = "place_updated"
	EventSyncStarted    = "sync_started"
	EventSyncCompleted  = "sync_completed"
	EventSyncFailed     = "sync_failed"
)

// GetEventsSince returns events since the given ID.
// If lastID is 0, returns the most recent events.
func (s *Storage) GetEventsSince(ctx context.Context, lastID int64, limit int) ([]Event, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}

	var query string
	var args []interface{}

	if lastID > 0 {
		query = `
			SELECT id, type, payload, created_at
			FROM events
			WHERE id > $1
			ORDER BY id ASC
			LIMIT $2
		`
		args = []interface{}{lastID, limit}
	} else {
		query = `
			SELECT id, type, payload, created_at
			FROM events
			ORDER BY id DESC
			LIMIT $1
		`
		args = []interface{}{limit}
	}

	rows, err := s.db.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	var events []Event
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.Type, &e.Payload, &e.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		events = append(events, e)
	}

	// If we queried DESC, reverse to get chronological order
	if lastID == 0 && len(events) > 1 {
		for i, j := 0, len(events)-1; i < j; i, j = i+1, j-1 {
			events[i], events[j] = events[j], events[i]
		}
	}

	return events, nil
}

// CreateEvent creates a new event.
func (s *Storage) CreateEvent(ctx context.Context, eventType string, payload interface{}) error {
	payloadJSON, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}

	_, err = s.db.Exec(ctx, `
		INSERT INTO events (type, payload, created_at)
		VALUES ($1, $2, NOW())
	`, eventType, payloadJSON)
	return err
}

// GetLatestEventID returns the ID of the most recent event.
func (s *Storage) GetLatestEventID(ctx context.Context) (int64, error) {
	var id int64
	err := s.db.QueryRow(ctx, "SELECT COALESCE(MAX(id), 0) FROM events").Scan(&id)
	return id, err
}

// CleanupOldEvents removes events older than the specified duration.
// This is called periodically to prevent the events table from growing indefinitely.
func (s *Storage) CleanupOldEvents(ctx context.Context, olderThan time.Duration) (int64, error) {
	cutoff := time.Now().Add(-olderThan)
	result, err := s.db.Exec(ctx, "DELETE FROM events WHERE created_at < $1", cutoff)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected(), nil
}
