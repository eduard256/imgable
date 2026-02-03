// Package api provides HTTP API server for the processor service.
package api

import (
	"context"
	"encoding/json"
	"net/http"
	"runtime"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/prometheus/client_golang/prometheus/promhttp"

	"github.com/eduard256/imgable/processor/internal/failed"
	"github.com/eduard256/imgable/shared/pkg/logger"
	"github.com/eduard256/imgable/shared/pkg/queue"
)

// Server is the HTTP API server for the processor.
type Server struct {
	router        chi.Router
	server        *http.Server
	inspector     *queue.Inspector
	failedHandler *failed.Handler
	logger        *logger.Logger
	startTime     time.Time
	workerCount   int
	paused        bool
	redisURL      string
}

// Config holds API server configuration.
type Config struct {
	Port          string
	Inspector     *queue.Inspector
	FailedHandler *failed.Handler
	Logger        *logger.Logger
	WorkerCount   int
	RedisURL      string
}

// New creates a new API server.
func New(cfg Config) *Server {
	s := &Server{
		router:        chi.NewRouter(),
		inspector:     cfg.Inspector,
		failedHandler: cfg.FailedHandler,
		logger:        cfg.Logger.WithField("component", "api"),
		startTime:     time.Now(),
		workerCount:   cfg.WorkerCount,
		redisURL:      cfg.RedisURL,
	}

	s.setupMiddleware()
	s.setupRoutes()

	s.server = &http.Server{
		Addr:         ":" + cfg.Port,
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
}

// setupRoutes configures HTTP routes.
func (s *Server) setupRoutes() {
	// Health check
	s.router.Get("/health", s.handleHealth)

	// Status endpoint
	s.router.Get("/status", s.handleStatus)

	// Pause/resume processing
	s.router.Post("/pause", s.handlePause)
	s.router.Post("/resume", s.handleResume)

	// Failed files management
	s.router.Get("/failed", s.handleListFailed)
	s.router.Post("/retry/{path}", s.handleRetryFailed)
	s.router.Delete("/failed/{path}", s.handleDeleteFailed)

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
	Status        string             `json:"status"`
	Paused        bool               `json:"paused"`
	UptimeSeconds int64              `json:"uptime_seconds"`
	Workers       WorkersStatus      `json:"workers"`
	Queue         QueueStatus        `json:"queue"`
	Processing    ProcessingStatus   `json:"processing"`
	Resources     ResourcesStatus    `json:"resources"`
}

// WorkersStatus represents worker statistics.
type WorkersStatus struct {
	Total  int `json:"total"`
	Active int `json:"active"`
	Idle   int `json:"idle"`
}

// QueueStatus represents queue statistics.
type QueueStatus struct {
	Pending        int `json:"pending"`
	Processing     int `json:"processing"`
	CompletedTotal int `json:"completed_total"`
	FailedTotal    int `json:"failed_total"`
}

// ProcessingStatus represents current processing information.
type ProcessingStatus struct {
	AvgDurationMs    int `json:"avg_duration_ms"`
	PhotosPerMinute  int `json:"photos_per_minute"`
}

// ResourcesStatus represents resource usage.
type ResourcesStatus struct {
	MemoryUsedMB  int `json:"memory_used_mb"`
	MemoryLimitMB int `json:"memory_limit_mb"`
	NumGoroutines int `json:"num_goroutines"`
}

// handleStatus handles GET /status
func (s *Server) handleStatus(w http.ResponseWriter, r *http.Request) {
	// Get queue stats
	var queueStatus QueueStatus
	if stats, err := s.inspector.GetQueueStats(); err == nil {
		for _, qs := range stats {
			queueStatus.Pending += qs.Pending
			queueStatus.Processing += qs.Active
			queueStatus.CompletedTotal += qs.ProcessedTotal
			queueStatus.FailedTotal += qs.FailedTotal
		}
	}

	// Get memory stats
	var memStats runtime.MemStats
	runtime.ReadMemStats(&memStats)

	// Check pause state
	paused, _ := s.inspector.IsQueuePaused("default")

	response := StatusResponse{
		Status:        "running",
		Paused:        paused,
		UptimeSeconds: int64(time.Since(s.startTime).Seconds()),
		Workers: WorkersStatus{
			Total:  s.workerCount,
			Active: queueStatus.Processing,
			Idle:   s.workerCount - queueStatus.Processing,
		},
		Queue: queueStatus,
		Processing: ProcessingStatus{
			AvgDurationMs:   0, // Would need to track this
			PhotosPerMinute: 0,
		},
		Resources: ResourcesStatus{
			MemoryUsedMB:  int(memStats.Alloc / 1024 / 1024),
			MemoryLimitMB: 0, // Set from config
			NumGoroutines: runtime.NumGoroutine(),
		},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handlePause handles POST /pause
func (s *Server) handlePause(w http.ResponseWriter, r *http.Request) {
	if err := s.inspector.PauseQueue("default"); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.logger.Info("processing paused")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": "processing paused",
	})
}

// handleResume handles POST /resume
func (s *Server) handleResume(w http.ResponseWriter, r *http.Request) {
	if err := s.inspector.ResumeQueue("default"); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	s.logger.Info("processing resumed")

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": "processing resumed",
	})
}

// FailedListResponse represents the /failed response.
type FailedListResponse struct {
	Total int                  `json:"total"`
	Files []FailedFileResponse `json:"files"`
}

// FailedFileResponse represents a failed file in the response.
type FailedFileResponse struct {
	Path         string    `json:"path"`
	OriginalPath string    `json:"original_path"`
	Error        string    `json:"error"`
	Stage        string    `json:"stage"`
	Attempts     int       `json:"attempts"`
	FailedAt     time.Time `json:"failed_at"`
	FileSize     int64     `json:"file_size"`
}

// handleListFailed handles GET /failed
func (s *Server) handleListFailed(w http.ResponseWriter, r *http.Request) {
	limit := 50
	offset := 0

	// Parse query params
	if l := r.URL.Query().Get("limit"); l != "" {
		if parsed, err := parseInt(l); err == nil && parsed > 0 && parsed <= 100 {
			limit = parsed
		}
	}
	if o := r.URL.Query().Get("offset"); o != "" {
		if parsed, err := parseInt(o); err == nil && parsed >= 0 {
			offset = parsed
		}
	}

	files, total, err := s.failedHandler.ListFailed(limit, offset)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	response := FailedListResponse{
		Total: total,
		Files: make([]FailedFileResponse, len(files)),
	}

	for i, f := range files {
		response.Files[i] = FailedFileResponse{
			Path:         f.Path,
			OriginalPath: f.OriginalPath,
			Error:        f.Error,
			Stage:        f.Stage,
			Attempts:     f.Attempts,
			FailedAt:     f.FailedAt,
			FileSize:     f.FileSize,
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

// handleRetryFailed handles POST /retry/{path}
func (s *Server) handleRetryFailed(w http.ResponseWriter, r *http.Request) {
	path := chi.URLParam(r, "path")
	if path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}

	if err := s.failedHandler.RetryFailed(path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": "file queued for retry",
	})
}

// handleDeleteFailed handles DELETE /failed/{path}
func (s *Server) handleDeleteFailed(w http.ResponseWriter, r *http.Request) {
	path := chi.URLParam(r, "path")
	if path == "" {
		http.Error(w, "path required", http.StatusBadRequest)
		return
	}

	if err := s.failedHandler.DeleteFailed(path); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "ok",
		"message": "file deleted",
	})
}

func parseInt(s string) (int, error) {
	var n int
	_, err := json.Unmarshal([]byte(s), &n)
	return n, err
}
