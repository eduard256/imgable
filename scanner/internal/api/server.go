// Package api provides HTTP API server for the scanner service.
// It exposes health checks, status endpoints, and Prometheus metrics.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/eduard256/imgable/scanner/internal/queue"
	"github.com/eduard256/imgable/scanner/internal/watcher"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

// Server is the HTTP API server for the scanner.
type Server struct {
	router   chi.Router
	server   *http.Server
	watcher  *watcher.Watcher
	producer *queue.Producer
	logger   *logger.Logger
	startTime time.Time
	redisURL string
}

// Config holds API server configuration.
type Config struct {
	Host     string
	Port     string
	Watcher  *watcher.Watcher
	Producer *queue.Producer
	Logger   *logger.Logger
	RedisURL string
}

// New creates a new API server.
func New(cfg Config) *Server {
	s := &Server{
		router:   chi.NewRouter(),
		watcher:  cfg.Watcher,
		producer: cfg.Producer,
		logger:   cfg.Logger.WithField("component", "api"),
		startTime: time.Now(),
		redisURL: cfg.RedisURL,
	}

	s.setupMiddleware()
	s.setupRoutes()

	s.server = &http.Server{
		Addr:         cfg.Host + ":" + cfg.Port,
		Handler:      s.router,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	return s
}

// setupMiddleware configures HTTP middleware.
func (s *Server) setupMiddleware() {
	s.router.Use(middleware.RequestID)
	s.router.Use(middleware.RealIP)
	s.router.Use(middleware.Recoverer)
	s.router.Use(middleware.Timeout(30 * time.Second))

	// Request logging
	s.router.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// Skip logging for health and metrics endpoints
			if r.URL.Path == "/health" || r.URL.Path == "/metrics" {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			next.ServeHTTP(ww, r)

			s.logger.WithFields(map[string]interface{}{
				"method":   r.Method,
				"path":     r.URL.Path,
				"status":   ww.Status(),
				"duration": time.Since(start).String(),
			}).Debug("request handled")
		})
	})
}

// setupRoutes configures HTTP routes.
func (s *Server) setupRoutes() {
	// Health check (for Docker/Kubernetes)
	s.router.Get("/health", s.handleHealth)

	// Status endpoint
	s.router.Get("/status", s.handleStatus)

	// Manual rescan trigger
	s.router.Post("/rescan", s.handleRescan)

	// Prometheus metrics
	s.router.Handle("/metrics", promhttp.Handler())
}

// Start starts the HTTP server.
func (s *Server) Start() error {
	s.logger.WithField("addr", s.server.Addr).Info("starting API server")
	return s.server.ListenAndServe()
}

// Shutdown gracefully shuts down the server.
func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("shutting down API server")
	return s.server.Shutdown(ctx)
}

// handleHealth handles GET /health
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{
		"status": "ok",
	})
}

// StatusResponse represents the /status response.
type StatusResponse struct {
	Status          string           `json:"status"`
	UptimeSeconds   int64            `json:"uptime_seconds"`
	Watcher         watcher.Status   `json:"watcher"`
	Producer        queue.Stats      `json:"producer"`
	Queue           []QueueStatus    `json:"queue,omitempty"`
}

// QueueStatus represents queue statistics.
type QueueStatus struct {
	Name      string `json:"name"`
	Pending   int    `json:"pending"`
	Active    int    `json:"active"`
	Scheduled int    `json:"scheduled"`
	Retry     int    `json:"retry"`
	Archived  int    `json:"archived"`
}

// handleStatus handles GET /status
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	watcherStatus := s.watcher.Status()
	producerStats := s.producer.Stats()

	response := StatusResponse{
		Status:        "running",
		UptimeSeconds: int64(time.Since(s.startTime).Seconds()),
		Watcher:       watcherStatus,
		Producer:      producerStats,
	}

	// Get queue stats from Redis
	if queueStats, err := s.producer.GetQueueStats(s.redisURL); err == nil {
		for _, qs := range queueStats {
			response.Queue = append(response.Queue, QueueStatus{
				Name:      qs.Queue,
				Pending:   qs.Pending,
				Active:    qs.Active,
				Scheduled: qs.Scheduled,
				Retry:     qs.Retry,
				Archived:  qs.Archived,
			})
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// RescanResponse represents the /rescan response.
type RescanResponse struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// handleRescan handles POST /rescan
func (s *Server) handleRescan(w http.ResponseWriter, r *http.Request) {
	s.logger.Info("manual rescan requested")

	// Trigger rescan in background
	go func() {
		if err := s.watcher.Rescan(); err != nil {
			s.logger.WithError(err).Error("rescan failed")
		}
	}()

	response := RescanResponse{
		Status:  "accepted",
		Message: "rescan started",
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	json.NewEncoder(w).Encode(response)
}
