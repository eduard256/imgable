// Package server provides HTTP routing configuration for the Imgable API.
// All routes are versioned under /api/v1/ for future compatibility.
package server

import (
	"log/slog"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/files"
	"github.com/imgable/api/internal/handlers"
	"github.com/imgable/api/internal/storage"
)

// Dependencies holds all handler dependencies.
type Dependencies struct {
	Config    *config.Config
	Logger    *slog.Logger
	Storage   *storage.Storage
	JWTAuth   *auth.JWTAuth
	RateLimit *auth.RateLimiter
}

// NewRouter creates and configures the HTTP router with all routes.
func NewRouter(deps *Dependencies) http.Handler {
	r := chi.NewRouter()

	// Global middleware (order matters)
	r.Use(Recovery(deps.Logger))
	r.Use(RequestID)
	r.Use(Logger(deps.Logger))
	r.Use(CORS)

	// Health check (no auth required)
	r.Get("/health", handlers.Health(deps.Storage))

	// Create handlers
	authHandler := handlers.NewAuthHandler(deps.Config, deps.JWTAuth, deps.RateLimit, deps.Logger)
	photosHandler := handlers.NewPhotosHandler(deps.Storage, deps.Config, deps.Logger)
	albumsHandler := handlers.NewAlbumsHandler(deps.Storage, deps.Config, deps.Logger)
	placesHandler := handlers.NewPlacesHandler(deps.Storage, deps.Config, deps.Logger)
	sharesHandler := handlers.NewSharesHandler(deps.Storage, deps.Config, deps.Logger)
	statsHandler := handlers.NewStatsHandler(deps.Storage, deps.Logger)
	uploadHandler := handlers.NewUploadHandler(deps.Config, deps.Logger)
	syncHandler := handlers.NewSyncHandler(deps.Config, deps.Logger)
	eventsHandler := handlers.NewEventsHandler(deps.Storage, deps.Logger)
	filesHandler := files.NewHandler(deps.Config, deps.JWTAuth, deps.Logger)
	mapHandler := handlers.NewMapHandler(deps.Storage, deps.Config, deps.Logger)

	// Auth middleware
	requireAuth := auth.Middleware(deps.JWTAuth)

	// API v1 routes
	r.Route("/api/v1", func(r chi.Router) {
		// Public endpoints
		r.Post("/login", authHandler.Login)

		// Protected endpoints
		r.Group(func(r chi.Router) {
			r.Use(requireAuth)

			// Photos
			r.Get("/photos/groups", photosHandler.GetGroups)
			r.Get("/photos", photosHandler.List)
			r.Delete("/photos", photosHandler.BulkDelete)
			r.Get("/photos/{id}", photosHandler.Get)
			r.Patch("/photos/{id}", photosHandler.Update)
			r.Delete("/photos/{id}", photosHandler.Delete)
			r.Post("/photos/{id}/favorite", photosHandler.AddFavorite)
			r.Delete("/photos/{id}/favorite", photosHandler.RemoveFavorite)

			// Albums
			r.Get("/albums", albumsHandler.List)
			r.Post("/albums", albumsHandler.Create)
			r.Get("/albums/{id}", albumsHandler.Get)
			r.Patch("/albums/{id}", albumsHandler.Update)
			r.Delete("/albums/{id}", albumsHandler.Delete)
			r.Post("/albums/{id}/photos", albumsHandler.AddPhotos)
			r.Delete("/albums/{id}/photos", albumsHandler.RemovePhotos)
			r.Delete("/albums/{id}/photos/{photoId}", albumsHandler.RemovePhoto)

			// Places
			r.Get("/places", placesHandler.List)
			r.Get("/places/{id}", placesHandler.Get)

			// Map (photo coordinates with clustering)
			r.Get("/map/clusters", mapHandler.GetClusters)
			r.Get("/map/bounds", mapHandler.GetBounds)

			// Shares
			r.Get("/shares", sharesHandler.List)
			r.Post("/shares", sharesHandler.Create)
			r.Delete("/shares/{id}", sharesHandler.Delete)

			// Stats
			r.Get("/stats", statsHandler.Get)

			// Upload
			r.Post("/upload", uploadHandler.Upload)

			// SSE Events
			r.Get("/events/stream", eventsHandler.Stream)

			// Sync proxy (to scanner, processor, and places)
			r.Route("/sync", func(r chi.Router) {
				r.HandleFunc("/scanner/*", syncHandler.ProxyScanner)
				r.HandleFunc("/processor/*", syncHandler.ProxyProcessor)
				r.HandleFunc("/places/*", syncHandler.ProxyPlaces)
			})
		})
	})

	// Public share access (no auth)
	r.Get("/s/{code}", sharesHandler.GetPublic)
	r.Get("/s/{code}/photo/{size}", sharesHandler.GetPublicPhoto)

	// Media files (token in query string)
	r.Get("/photos/{p1}/{p2}/{filename}", filesHandler.ServePhoto)

	// Static files (SPA fallback)
	r.NotFound(filesHandler.ServeSPA)

	return r
}
