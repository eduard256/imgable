// Package main is the entry point for the processor service.
// The processor handles file processing tasks from the queue:
// - Image resizing and WebP conversion
// - Video thumbnail extraction
// - EXIF metadata extraction
// - Geocoding via Nominatim
package main

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/eduard256/imgable/processor/internal/api"
	"github.com/eduard256/imgable/processor/internal/config"
	"github.com/eduard256/imgable/processor/internal/failed"
	"github.com/eduard256/imgable/processor/internal/geo"
	imgproc "github.com/eduard256/imgable/processor/internal/image"
	"github.com/eduard256/imgable/processor/internal/metadata"
	"github.com/eduard256/imgable/processor/internal/metrics"
	"github.com/eduard256/imgable/processor/internal/video"
	"github.com/eduard256/imgable/processor/internal/worker"
	"github.com/eduard256/imgable/shared/pkg/database"
	"github.com/eduard256/imgable/shared/pkg/logger"
	"github.com/eduard256/imgable/shared/pkg/queue"
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
		Service: "processor",
	})

	log.Info("starting processor service")

	// Check ffmpeg availability
	if !video.IsFFmpegAvailable() {
		log.Fatal("ffmpeg not found in PATH")
	}
	if !video.IsFFprobeAvailable() {
		log.Fatal("ffprobe not found in PATH")
	}

	// Initialize libvips
	imgproc.Initialize()
	defer imgproc.Shutdown()

	// Initialize metrics
	m := metrics.New()

	// Create context with cancellation
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Connect to database
	db, err := database.New(ctx, database.DefaultConfig(cfg.DatabaseURL), log)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	// Create image processor
	imageProc := imgproc.NewProcessor(imgproc.ProcessorConfig{
		SmallPx:   cfg.PreviewSmallPx,
		LargePx:   cfg.PreviewLargePx,
		Quality:   cfg.PreviewQuality,
		OutputDir: cfg.MediaDir,
	}, log)

	// Create video processor
	videoProc := video.NewProcessor(video.ProcessorConfig{
		ThumbnailPx: cfg.PreviewSmallPx,
		Quality:     cfg.PreviewQuality,
		OutputDir:   cfg.MediaDir,
	}, log)

	// Create EXIF extractor
	exifExtractor := metadata.NewExtractor(log)

	// Create geocoder
	geocoder := geo.NewGeocoder(geo.GeocoderConfig{
		BaseURL:     cfg.NominatimURL,
		RateLimitMs: cfg.NominatimRateLimitMs,
		Enabled:     cfg.NominatimEnabled,
		Timeout:     10 * time.Second,
	}, log)

	// Create place manager
	placeManager := geo.NewPlaceManager(geo.PlaceManagerConfig{
		RadiusM:  cfg.PlaceRadiusM,
		DB:       db,
		Geocoder: geocoder,
	}, log)

	// Create failed handler
	failedHandler := failed.NewHandler(cfg.FailedDir, cfg.UploadsDir, log)

	// Create queue inspector
	inspector, err := queue.NewInspector(cfg.RedisURL, log)
	if err != nil {
		log.Fatalf("failed to create queue inspector: %v", err)
	}
	defer inspector.Close()

	// Create queue server
	serverCfg := queue.DefaultServerConfig(cfg.RedisURL, cfg.Workers)
	queueServer, err := queue.NewServer(serverCfg, log)
	if err != nil {
		log.Fatalf("failed to create queue server: %v", err)
	}

	// Create worker
	w := worker.NewWorker(worker.WorkerDeps{
		Config:        cfg,
		DB:            db,
		ImageProc:     imageProc,
		VideoProc:     videoProc,
		ExifExtractor: exifExtractor,
		PlaceManager:  placeManager,
		FailedHandler: failedHandler,
		Logger:        log,
		WorkerID:      fmt.Sprintf("worker-%d", os.Getpid()),
	})

	// Register task handlers
	queueServer.HandleFunc(queue.TypeProcessFile, w.HandleProcessFile)
	queueServer.HandleFunc(queue.TypeRetryFailed, w.HandleProcessFile)

	// Start queue server
	go func() {
		log.WithField("workers", cfg.Workers).Info("starting queue server")
		if err := queueServer.Start(); err != nil {
			log.Fatalf("queue server failed: %v", err)
		}
	}()
	m.SetProcessorRunning()

	// Create API server
	apiServer := api.New(api.Config{
		Port:          cfg.APIPort,
		Inspector:     inspector,
		FailedHandler: failedHandler,
		Logger:        log,
		WorkerCount:   cfg.Workers,
		RedisURL:      cfg.RedisURL,
	})

	// Start API server
	go func() {
		if err := apiServer.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("API server failed: %v", err)
		}
	}()

	log.WithFields(map[string]interface{}{
		"workers":    cfg.Workers,
		"media_dir":  cfg.MediaDir,
		"failed_dir": cfg.FailedDir,
		"api_port":   cfg.APIPort,
	}).Info("processor service started")

	// Wait for shutdown signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	sig := <-sigChan
	log.WithField("signal", sig.String()).Info("received shutdown signal")

	// Graceful shutdown
	m.SetProcessorStopped()

	// Create shutdown context with timeout
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer shutdownCancel()

	// Stop API server
	if err := apiServer.Shutdown(shutdownCtx); err != nil {
		log.WithError(err).Error("API server shutdown error")
	}

	// Stop queue server (waits for active tasks)
	queueServer.Shutdown()

	// Cancel main context
	cancel()

	log.Info("processor service stopped")
}
