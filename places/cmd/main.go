// Package main is the entry point for the places service.
// The places service processes photos with GPS coordinates and assigns them to places.
package main

import (
	"context"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/eduard256/imgable/places/internal/api"
	"github.com/eduard256/imgable/places/internal/config"
	"github.com/eduard256/imgable/places/internal/nominatim"
	"github.com/eduard256/imgable/places/internal/worker"
	"github.com/eduard256/imgable/shared/pkg/database"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Initialize logger
	log := logger.New(logger.Config{
		Level:   cfg.LogLevel,
		Format:  cfg.LogFormat,
		Service: "places",
	})

	log.Info("starting places service")

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Connect to database
	db, err := database.New(ctx, database.DefaultConfig(cfg.DatabaseURL), log)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	// Create Nominatim client
	nominatimClient := nominatim.NewClient(cfg.NominatimURL, cfg.NominatimRateLimitMs, log)

	// Create worker
	w := worker.NewWorker(db, nominatimClient, cfg.RadiusDegrees, log)

	// Create API server
	apiServer := api.NewServer(w, cfg.APIPort, log)

	// Start API server
	go func() {
		if err := apiServer.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API server failed: %v", err)
		}
	}()

	// Start scheduler
	go runScheduler(ctx, w, cfg.IntervalMinutes, log)

	log.WithFields(map[string]interface{}{
		"api_port":         cfg.APIPort,
		"interval_minutes": cfg.IntervalMinutes,
		"radius_degrees":   cfg.RadiusDegrees,
		"nominatim_url":    cfg.NominatimURL,
	}).Info("places service started")

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigChan
	log.WithField("signal", sig.String()).Info("received shutdown signal")

	// Cancel context to stop scheduler
	cancel()

	// Graceful shutdown
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	if err := apiServer.Shutdown(shutdownCtx); err != nil {
		log.WithError(err).Error("API server shutdown error")
	}

	log.Info("places service stopped")
}

// runScheduler runs the worker on a fixed interval.
func runScheduler(ctx context.Context, w *worker.Worker, intervalMinutes int, log *logger.Logger) {
	ticker := time.NewTicker(time.Duration(intervalMinutes) * time.Minute)
	defer ticker.Stop()

	// Run immediately on startup
	log.Info("running initial places processing")
	if err := w.Run(ctx); err != nil {
		log.WithError(err).Error("initial run failed")
	}

	for {
		select {
		case <-ctx.Done():
			log.Info("scheduler stopped")
			return
		case <-ticker.C:
			log.Info("scheduled places processing")
			if err := w.Run(ctx); err != nil {
				log.WithError(err).Error("scheduled run failed")
			}
		}
	}
}
