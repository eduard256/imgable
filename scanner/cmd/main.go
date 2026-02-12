// Package main is the entry point for the scanner service.
// The scanner watches the /uploads directory for new media files
// and queues them for processing by the processor service.
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/eduard256/imgable/scanner/internal/api"
	"github.com/eduard256/imgable/scanner/internal/config"
	"github.com/eduard256/imgable/scanner/internal/metrics"
	"github.com/eduard256/imgable/scanner/internal/queue"
	"github.com/eduard256/imgable/scanner/internal/watcher"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

func main() {
	// Load configuration
	cfg := config.Load()

	// Ensure required directories exist
	if err := cfg.EnsureDirs(); err != nil {
		panic(fmt.Sprintf("failed to create directories: %v", err))
	}

	// Initialize logger
	log := logger.New(logger.Config{
		Level:   cfg.LogLevel,
		Format:  cfg.LogFormat,
		Service: "scanner",
	})

	log.Info("starting scanner service")

	// Initialize metrics
	m := metrics.New()

	// Initialize queue producer
	producer, err := queue.NewProducer(cfg.RedisURL, cfg.AIServiceURL, log)
	if err != nil {
		log.Fatalf("failed to create queue producer: %v", err)
	}
	defer producer.Close()

	// Create watcher
	w, err := watcher.New(watcher.Config{
		Dir:          cfg.UploadsDir,
		FailedDir:    cfg.FailedDir,
		Handler:      producer.HandleFileEvent,
		PollInterval: cfg.ScanInterval,
		StuckTimeout: cfg.StuckFileTimeout,
		Logger:       log,
	})
	if err != nil {
		log.Fatalf("failed to create watcher: %v", err)
	}

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start watcher
	if err := w.Start(ctx); err != nil {
		log.Fatalf("failed to start watcher: %v", err)
	}
	m.SetScannerRunning()

	// Create API server
	apiServer := api.New(api.Config{
		Port:     cfg.APIPort,
		Watcher:  w,
		Producer: producer,
		Logger:   log,
		RedisURL: cfg.RedisURL,
	})

	// Start API server in goroutine
	go func() {
		if err := apiServer.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API server failed: %v", err)
		}
	}()

	log.WithFields(map[string]interface{}{
		"uploads_dir":   cfg.UploadsDir,
		"scan_interval": cfg.ScanInterval.String(),
		"api_port":      cfg.APIPort,
	}).Info("scanner service started")

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigChan
	log.WithField("signal", sig.String()).Info("received shutdown signal")

	// Graceful shutdown
	m.SetScannerStopped()

	// Create shutdown context with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Stop API server
	if err := apiServer.Shutdown(shutdownCtx); err != nil {
		log.WithError(err).Error("API server shutdown error")
	}

	// Stop watcher
	w.Stop()

	// Cancel main context
	cancel()

	log.Info("scanner service stopped")
}
