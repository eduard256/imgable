// Package main is the entry point for the Imgable API server.
// It initializes all dependencies and starts the HTTP server with graceful shutdown.
package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/imgable/api/internal/auth"
	"github.com/imgable/api/internal/config"
	"github.com/imgable/api/internal/handlers"
	"github.com/imgable/api/internal/server"
	"github.com/imgable/api/internal/storage"
)

func main() {
	// Initialize logger
	logger := initLogger()

	logger.Info("starting Imgable API server")

	// Load configuration
	cfg, err := config.Load()
	if err != nil {
		logger.Error("failed to load config", slog.Any("error", err))
		os.Exit(1)
	}

	// Create context for graceful shutdown
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Initialize storage (database + redis)
	store, err := storage.New(ctx, cfg.DatabaseURL, cfg.RedisURL)
	if err != nil {
		logger.Error("failed to initialize storage", slog.Any("error", err))
		os.Exit(1)
	}
	defer store.Close()

	logger.Info("connected to database and redis")

	// Initialize JWT auth
	jwtAuth := auth.NewJWTAuth(cfg.JWTSecret, cfg.JWTExpiry)

	// Initialize rate limiter for login
	rateLimit := auth.NewRateLimiter(cfg.LoginRateLimit, time.Minute)

	// Create router with all dependencies
	deps := &server.Dependencies{
		Config:    cfg,
		Logger:    logger,
		Storage:   store,
		JWTAuth:   jwtAuth,
		RateLimit: rateLimit,
	}
	router := server.NewRouter(deps)

	// Create HTTP server
	srv := server.New(cfg, router, logger)

	// Start event cleanup in background
	go handlers.StartEventCleanup(ctx, store, logger, 24*time.Hour)

	// Handle shutdown signals
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Start server in goroutine
	go func() {
		if err := srv.Start(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Error("server error", slog.Any("error", err))
			cancel()
		}
	}()

	logger.Info("server started",
		slog.Int("port", cfg.Port),
		slog.String("media_path", cfg.MediaPath),
		slog.String("uploads_path", cfg.UploadsPath),
	)

	// Wait for shutdown signal
	sig := <-sigChan
	logger.Info("received shutdown signal", slog.String("signal", sig.String()))

	// Cancel context to stop background tasks
	cancel()

	// Graceful shutdown
	if err := srv.Shutdown(context.Background()); err != nil {
		logger.Error("shutdown error", slog.Any("error", err))
		os.Exit(1)
	}

	logger.Info("server stopped gracefully")
}

// initLogger creates a structured logger based on environment.
func initLogger() *slog.Logger {
	logLevel := os.Getenv("LOG_LEVEL")
	logFormat := os.Getenv("LOG_FORMAT")

	// Determine log level
	var level slog.Level
	switch logLevel {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	// Create handler based on format
	var handler slog.Handler
	opts := &slog.HandlerOptions{
		Level: level,
	}

	if logFormat == "json" {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return slog.New(handler)
}
