package models

import (
	"encoding/json"
	"testing"
)

func TestNewEvent(t *testing.T) {
	payload := PhotoAddedPayload{
		PhotoID:  "abc123",
		Type:     "photo",
		Blurhash: "LEHV6nWB",
	}

	event, err := NewEvent(payload)
	if err != nil {
		t.Fatalf("NewEvent failed: %v", err)
	}

	if event.Type != EventPhotoAdded {
		t.Errorf("Event type mismatch: got %q, want %q", event.Type, EventPhotoAdded)
	}

	if event.Payload == nil {
		t.Error("Event payload should not be nil")
	}

	if event.CreatedAt.IsZero() {
		t.Error("Event CreatedAt should not be zero")
	}
}

func TestEventParsePayload(t *testing.T) {
	tests := []struct {
		name      string
		eventType EventType
		payload   interface{}
	}{
		{
			name:      "photo_added",
			eventType: EventPhotoAdded,
			payload:   PhotoAddedPayload{PhotoID: "abc123", Type: "photo"},
		},
		{
			name:      "photo_updated",
			eventType: EventPhotoUpdated,
			payload:   PhotoUpdatedPayload{PhotoID: "abc123", Fields: []string{"comment"}},
		},
		{
			name:      "photo_deleted",
			eventType: EventPhotoDeleted,
			payload:   PhotoDeletedPayload{PhotoID: "abc123"},
		},
		{
			name:      "album_created",
			eventType: EventAlbumCreated,
			payload:   AlbumCreatedPayload{AlbumID: "album1", Name: "Test", Type: "manual"},
		},
		{
			name:      "place_created",
			eventType: EventPlaceCreated,
			payload:   PlaceCreatedPayload{PlaceID: "place1", Name: "Moscow", GPSLat: 55.75, GPSLon: 37.61},
		},
		{
			name:      "sync_completed",
			eventType: EventSyncCompleted,
			payload:   SyncCompletedPayload{ProcessedFiles: 100, FailedFiles: 5, DurationMs: 60000},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Marshal the payload
			payloadData, err := json.Marshal(tt.payload)
			if err != nil {
				t.Fatalf("Failed to marshal payload: %v", err)
			}

			// Create event
			event := &Event{
				ID:      1,
				Type:    tt.eventType,
				Payload: payloadData,
			}

			// Parse the payload
			parsed, err := event.ParsePayload()
			if err != nil {
				t.Fatalf("ParsePayload failed: %v", err)
			}

			if parsed == nil {
				t.Fatal("Parsed payload should not be nil")
			}

			// Verify the EventType method
			if parsed.EventType() != tt.eventType {
				t.Errorf("EventType mismatch: got %q, want %q", parsed.EventType(), tt.eventType)
			}
		})
	}
}

func TestEventTypes(t *testing.T) {
	// Verify all event types are unique
	types := []EventType{
		EventPhotoAdded,
		EventPhotoUpdated,
		EventPhotoDeleted,
		EventAlbumCreated,
		EventAlbumUpdated,
		EventAlbumDeleted,
		EventPlaceCreated,
		EventPlaceUpdated,
		EventSyncStarted,
		EventSyncCompleted,
		EventSyncFailed,
	}

	seen := make(map[EventType]bool)
	for _, t := range types {
		if seen[t] {
			// Can't use t.Errorf here due to variable name collision
			panic("Duplicate event type: " + string(t))
		}
		seen[t] = true
	}
}

func TestPhotoAddedPayload(t *testing.T) {
	payload := PhotoAddedPayload{
		PhotoID:  "abc123def456",
		Type:     "photo",
		Blurhash: "LEHV6nWB2yk8pyo0adR*.7kCMdnj",
	}

	if payload.EventType() != EventPhotoAdded {
		t.Errorf("EventType should be %q, got %q", EventPhotoAdded, payload.EventType())
	}

	// Test JSON serialization
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var decoded PhotoAddedPayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if decoded.PhotoID != payload.PhotoID {
		t.Errorf("PhotoID mismatch: got %q, want %q", decoded.PhotoID, payload.PhotoID)
	}
}

func TestSyncCompletedPayload(t *testing.T) {
	payload := SyncCompletedPayload{
		ProcessedFiles: 500,
		FailedFiles:    10,
		DurationMs:     120000,
	}

	if payload.EventType() != EventSyncCompleted {
		t.Errorf("EventType should be %q, got %q", EventSyncCompleted, payload.EventType())
	}

	// Test JSON serialization
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal: %v", err)
	}

	var decoded SyncCompletedPayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal: %v", err)
	}

	if decoded.ProcessedFiles != payload.ProcessedFiles {
		t.Errorf("ProcessedFiles mismatch: got %d, want %d", decoded.ProcessedFiles, payload.ProcessedFiles)
	}

	if decoded.FailedFiles != payload.FailedFiles {
		t.Errorf("FailedFiles mismatch: got %d, want %d", decoded.FailedFiles, payload.FailedFiles)
	}

	if decoded.DurationMs != payload.DurationMs {
		t.Errorf("DurationMs mismatch: got %d, want %d", decoded.DurationMs, payload.DurationMs)
	}
}
