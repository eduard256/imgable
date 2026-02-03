// Package handlers provides SSE (Server-Sent Events) HTTP handlers.
package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/imgable/api/internal/storage"
)

// EventsHandler handles SSE event streaming endpoints.
type EventsHandler struct {
	storage *storage.Storage
	logger  *slog.Logger
}

// NewEventsHandler creates a new EventsHandler.
func NewEventsHandler(store *storage.Storage, logger *slog.Logger) *EventsHandler {
	return &EventsHandler{
		storage: store,
		logger:  logger,
	}
}

// Stream handles GET /api/v1/events/stream.
// Implements Server-Sent Events (SSE) for real-time updates.
//
// Query parameters:
//   - last_id: Start streaming from events after this ID
//
// Event format:
//
//	id: <event_id>
//	event: <event_type>
//	data: <json_payload>
func (h *EventsHandler) Stream(w http.ResponseWriter, r *http.Request) {
	// Check if SSE is supported
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "SSE not supported", http.StatusInternalServerError)
		return
	}

	// Set SSE headers
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("X-Accel-Buffering", "no") // Disable nginx buffering

	// Parse last_id parameter
	var lastID int64
	if idStr := r.URL.Query().Get("last_id"); idStr != "" {
		if id, err := strconv.ParseInt(idStr, 10, 64); err == nil {
			lastID = id
		}
	}

	// If no last_id provided, get current latest
	if lastID == 0 {
		id, err := h.storage.GetLatestEventID(r.Context())
		if err == nil {
			lastID = id
		}
	}

	// Send initial comment to establish connection
	fmt.Fprintf(w, ": connected\n\n")
	flusher.Flush()

	// Create ticker for polling
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	// Create context for cancellation
	ctx := r.Context()

	h.logger.Info("SSE client connected", slog.Int64("last_id", lastID))

	for {
		select {
		case <-ctx.Done():
			h.logger.Info("SSE client disconnected")
			return

		case <-ticker.C:
			// Poll for new events
			events, err := h.storage.GetEventsSince(ctx, lastID, 50)
			if err != nil {
				h.logger.Error("failed to get events", slog.Any("error", err))
				continue
			}

			// Send events to client
			for _, event := range events {
				if err := h.writeEvent(w, flusher, event); err != nil {
					h.logger.Error("failed to write event", slog.Any("error", err))
					return
				}
				lastID = event.ID
			}

			// Send keepalive comment if no events
			if len(events) == 0 {
				fmt.Fprintf(w, ": keepalive\n\n")
				flusher.Flush()
			}
		}
	}
}

// writeEvent writes a single SSE event to the response.
func (h *EventsHandler) writeEvent(w http.ResponseWriter, flusher http.Flusher, event storage.Event) error {
	// Format: id: X\nevent: Y\ndata: Z\n\n
	fmt.Fprintf(w, "id: %d\n", event.ID)
	fmt.Fprintf(w, "event: %s\n", event.Type)

	// Write payload as single-line JSON
	payload := map[string]interface{}{
		"payload":    json.RawMessage(event.Payload),
		"created_at": event.CreatedAt.Unix(),
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	fmt.Fprintf(w, "data: %s\n\n", data)

	flusher.Flush()
	return nil
}

// StartEventCleanup starts a background goroutine to clean up old events.
// Events older than the specified duration are deleted periodically.
func StartEventCleanup(ctx context.Context, store *storage.Storage, logger *slog.Logger, retention time.Duration) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			deleted, err := store.CleanupOldEvents(ctx, retention)
			if err != nil {
				logger.Error("failed to cleanup events", slog.Any("error", err))
			} else if deleted > 0 {
				logger.Info("cleaned up old events", slog.Int64("deleted", deleted))
			}
		}
	}
}
