package models

import (
	"encoding/json"
	"time"
)

// EventType represents the type of event that occurred.
type EventType string

const (
	EventPhotoAdded    EventType = "photo_added"
	EventPhotoUpdated  EventType = "photo_updated"
	EventPhotoDeleted  EventType = "photo_deleted"
	EventAlbumCreated  EventType = "album_created"
	EventAlbumUpdated  EventType = "album_updated"
	EventAlbumDeleted  EventType = "album_deleted"
	EventPlaceCreated  EventType = "place_created"
	EventPlaceUpdated  EventType = "place_updated"
	EventSyncStarted   EventType = "sync_started"
	EventSyncCompleted EventType = "sync_completed"
	EventSyncFailed    EventType = "sync_failed"
)

// Event represents an event in the system for real-time updates.
// Maps to the 'events' table in PostgreSQL.
type Event struct {
	ID        int64           `json:"id" db:"id"`
	Type      EventType       `json:"type" db:"type"`
	Payload   json.RawMessage `json:"payload" db:"payload"`
	CreatedAt time.Time       `json:"created_at" db:"created_at"`
}

// EventPayload is the base interface for event payloads.
type EventPayload interface {
	EventType() EventType
}

// PhotoAddedPayload is the payload for EventPhotoAdded.
type PhotoAddedPayload struct {
	PhotoID  string `json:"photo_id"`
	Type     string `json:"type"` // photo or video
	Blurhash string `json:"blurhash,omitempty"`
}

func (p PhotoAddedPayload) EventType() EventType { return EventPhotoAdded }

// PhotoUpdatedPayload is the payload for EventPhotoUpdated.
type PhotoUpdatedPayload struct {
	PhotoID string   `json:"photo_id"`
	Fields  []string `json:"fields"` // Which fields were updated
}

func (p PhotoUpdatedPayload) EventType() EventType { return EventPhotoUpdated }

// PhotoDeletedPayload is the payload for EventPhotoDeleted.
type PhotoDeletedPayload struct {
	PhotoID string `json:"photo_id"`
}

func (p PhotoDeletedPayload) EventType() EventType { return EventPhotoDeleted }

// AlbumCreatedPayload is the payload for EventAlbumCreated.
type AlbumCreatedPayload struct {
	AlbumID string `json:"album_id"`
	Name    string `json:"name"`
	Type    string `json:"type"` // manual, favorites, place
}

func (p AlbumCreatedPayload) EventType() EventType { return EventAlbumCreated }

// AlbumUpdatedPayload is the payload for EventAlbumUpdated.
type AlbumUpdatedPayload struct {
	AlbumID string   `json:"album_id"`
	Fields  []string `json:"fields"`
}

func (p AlbumUpdatedPayload) EventType() EventType { return EventAlbumUpdated }

// AlbumDeletedPayload is the payload for EventAlbumDeleted.
type AlbumDeletedPayload struct {
	AlbumID string `json:"album_id"`
}

func (p AlbumDeletedPayload) EventType() EventType { return EventAlbumDeleted }

// PlaceCreatedPayload is the payload for EventPlaceCreated.
type PlaceCreatedPayload struct {
	PlaceID string  `json:"place_id"`
	Name    string  `json:"name"`
	GPSLat  float64 `json:"gps_lat"`
	GPSLon  float64 `json:"gps_lon"`
}

func (p PlaceCreatedPayload) EventType() EventType { return EventPlaceCreated }

// PlaceUpdatedPayload is the payload for EventPlaceUpdated.
type PlaceUpdatedPayload struct {
	PlaceID string   `json:"place_id"`
	Fields  []string `json:"fields"`
}

func (p PlaceUpdatedPayload) EventType() EventType { return EventPlaceUpdated }

// SyncStartedPayload is the payload for EventSyncStarted.
type SyncStartedPayload struct {
	TotalFiles int `json:"total_files"`
}

func (p SyncStartedPayload) EventType() EventType { return EventSyncStarted }

// SyncCompletedPayload is the payload for EventSyncCompleted.
type SyncCompletedPayload struct {
	ProcessedFiles int `json:"processed_files"`
	FailedFiles    int `json:"failed_files"`
	DurationMs     int `json:"duration_ms"`
}

func (p SyncCompletedPayload) EventType() EventType { return EventSyncCompleted }

// SyncFailedPayload is the payload for EventSyncFailed.
type SyncFailedPayload struct {
	Error    string `json:"error"`
	FilePath string `json:"file_path,omitempty"`
}

func (p SyncFailedPayload) EventType() EventType { return EventSyncFailed }

// NewEvent creates a new Event with the given payload.
func NewEvent(payload EventPayload) (*Event, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	return &Event{
		Type:      payload.EventType(),
		Payload:   data,
		CreatedAt: time.Now(),
	}, nil
}

// ParsePayload parses the event payload into the appropriate type.
func (e *Event) ParsePayload() (EventPayload, error) {
	var payload EventPayload

	switch e.Type {
	case EventPhotoAdded:
		payload = &PhotoAddedPayload{}
	case EventPhotoUpdated:
		payload = &PhotoUpdatedPayload{}
	case EventPhotoDeleted:
		payload = &PhotoDeletedPayload{}
	case EventAlbumCreated:
		payload = &AlbumCreatedPayload{}
	case EventAlbumUpdated:
		payload = &AlbumUpdatedPayload{}
	case EventAlbumDeleted:
		payload = &AlbumDeletedPayload{}
	case EventPlaceCreated:
		payload = &PlaceCreatedPayload{}
	case EventPlaceUpdated:
		payload = &PlaceUpdatedPayload{}
	case EventSyncStarted:
		payload = &SyncStartedPayload{}
	case EventSyncCompleted:
		payload = &SyncCompletedPayload{}
	case EventSyncFailed:
		payload = &SyncFailedPayload{}
	default:
		return nil, nil
	}

	if err := json.Unmarshal(e.Payload, payload); err != nil {
		return nil, err
	}

	return payload, nil
}
