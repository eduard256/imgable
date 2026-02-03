// Package handlers provides HTTP request handlers for the Imgable API.
package handlers

import (
	"net/http"

	"github.com/imgable/api/internal/response"
	"github.com/imgable/api/internal/storage"
)

// HealthResponse represents health check response.
type HealthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
	Redis    string `json:"redis"`
}

// Health returns a health check handler.
// It checks database and Redis connectivity.
func Health(store *storage.Storage) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		resp := HealthResponse{
			Status:   "ok",
			Database: "ok",
			Redis:    "ok",
		}

		if err := store.Health(r.Context()); err != nil {
			resp.Status = "degraded"
			// Parse error to determine which component failed
			errStr := err.Error()
			if len(errStr) > 8 && errStr[:8] == "database" {
				resp.Database = "error"
			}
			if len(errStr) > 5 && errStr[:5] == "redis" {
				resp.Redis = "error"
			}
		}

		if resp.Status == "ok" {
			response.OK(w, resp)
		} else {
			response.JSON(w, http.StatusServiceUnavailable, resp)
		}
	}
}
