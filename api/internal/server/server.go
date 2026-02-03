// Package server provides the HTTP server for the Imgable API.
// It handles graceful shutdown, middleware setup, and request routing.
package server

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"

	"github.com/imgable/api/internal/config"
)

// Server represents the HTTP server with all dependencies.
type Server struct {
	httpServer *http.Server
	logger     *slog.Logger
	config     *config.Config
}

// New creates a new Server instance.
func New(cfg *config.Config, handler http.Handler, logger *slog.Logger) *Server {
	return &Server{
		httpServer: &http.Server{
			Addr:         fmt.Sprintf(":%d", cfg.Port),
			Handler:      handler,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 60 * time.Second, // Longer for file uploads
			IdleTimeout:  120 * time.Second,
		},
		logger: logger,
		config: cfg,
	}
}

// Start begins listening for HTTP requests.
// It blocks until the server is shut down.
func (s *Server) Start() error {
	s.logger.Info("starting HTTP server",
		slog.Int("port", s.config.Port),
	)
	return s.httpServer.ListenAndServe()
}

// Shutdown gracefully stops the server.
// It waits for active connections to complete within the configured timeout.
func (s *Server) Shutdown(ctx context.Context) error {
	s.logger.Info("shutting down HTTP server",
		slog.Duration("timeout", s.config.ShutdownTimeout),
	)

	// Create context with timeout
	shutdownCtx, cancel := context.WithTimeout(ctx, s.config.ShutdownTimeout)
	defer cancel()

	// Attempt graceful shutdown
	if err := s.httpServer.Shutdown(shutdownCtx); err != nil {
		s.logger.Error("shutdown error", slog.Any("error", err))
		return err
	}

	s.logger.Info("HTTP server stopped")
	return nil
}
