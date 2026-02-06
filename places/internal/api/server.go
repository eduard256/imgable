// Package api provides the HTTP API server for the places service.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/eduard256/imgable/places/internal/worker"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

// Server is the HTTP API server.
type Server struct {
	router *chi.Mux
	server *http.Server
	worker *worker.Worker
	logger *logger.Logger
	port   string
}

// NewServer creates a new API server.
func NewServer(w *worker.Worker, port string, log *logger.Logger) *Server {
	s := &Server{
		router: chi.NewRouter(),
		worker: w,
		logger: log.WithField("component", "api"),
		port:   port,
	}

	s.setupRoutes()
	return s
}

// setupRoutes configures the HTTP routes.
func (s *Server) setupRoutes() {
	s.router.Use(middleware.Recoverer)
	s.router.Use(middleware.Timeout(30 * time.Second))

	// Health check
	s.router.Get("/health", s.handleHealth)

	// API v1
	s.router.Route("/api/v1", func(r chi.Router) {
		r.Get("/status", s.handleStatus)
		r.Post("/run", s.handleRun)
	})
}

// Start starts the HTTP server.
func (s *Server) Start() error {
	s.server = &http.Server{
		Addr:    ":" + s.port,
		Handler: s.router,
	}

	s.logger.WithField("port", s.port).Info("starting API server")
	return s.server.ListenAndServe()
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown(ctx context.Context) error {
	return s.server.Shutdown(ctx)
}

// handleHealth handles GET /health.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleStatus handles GET /api/v1/status.
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	status, err := s.worker.GetStatus(r.Context())
	if err != nil {
		s.logger.WithError(err).Error("failed to get status")
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// handleRun handles POST /api/v1/run.
func (s *Server) handleRun(w http.ResponseWriter, r *http.Request) {
	// Run in background
	go func() {
		ctx := context.Background()
		if err := s.worker.Run(ctx); err != nil {
			s.logger.WithError(err).Error("manual run failed")
		}
	}()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(map[string]string{"status": "started"})
}
