// Package worker provides the file processing worker implementation.
// It handles the complete processing pipeline for photos and videos.
package worker

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/eduard256/imgable/processor/internal/config"
	"github.com/eduard256/imgable/processor/internal/failed"
	"github.com/eduard256/imgable/processor/internal/geo"
	"github.com/eduard256/imgable/processor/internal/image"
	"github.com/eduard256/imgable/processor/internal/metadata"
	"github.com/eduard256/imgable/processor/internal/video"
	"github.com/eduard256/imgable/shared/pkg/database"
	"github.com/eduard256/imgable/shared/pkg/fileutil"
	"github.com/eduard256/imgable/shared/pkg/logger"
	"github.com/eduard256/imgable/shared/pkg/models"
	"github.com/eduard256/imgable/shared/pkg/queue"
)

// Worker processes individual file tasks.
type Worker struct {
	cfg           *config.Config
	db            *database.DB
	imageProc     *image.Processor
	videoProc     *video.Processor
	exifExtractor *metadata.Extractor
	placeManager  *geo.PlaceManager
	failedHandler *failed.Handler
	logger        *logger.Logger
	workerID      string
}

// WorkerDeps holds dependencies for creating a worker.
type WorkerDeps struct {
	Config        *config.Config
	DB            *database.DB
	ImageProc     *image.Processor
	VideoProc     *video.Processor
	ExifExtractor *metadata.Extractor
	PlaceManager  *geo.PlaceManager
	FailedHandler *failed.Handler
	Logger        *logger.Logger
	WorkerID      string
}

// NewWorker creates a new file processing worker.
func NewWorker(deps WorkerDeps) *Worker {
	return &Worker{
		cfg:           deps.Config,
		db:            deps.DB,
		imageProc:     deps.ImageProc,
		videoProc:     deps.VideoProc,
		exifExtractor: deps.ExifExtractor,
		placeManager:  deps.PlaceManager,
		failedHandler: deps.FailedHandler,
		logger:        deps.Logger.WithField("worker_id", deps.WorkerID),
		workerID:      deps.WorkerID,
	}
}

// HandleProcessFile handles the file:process task.
func (w *Worker) HandleProcessFile(ctx context.Context, task *asynq.Task) error {
	var payload queue.ProcessFilePayload
	if err := json.Unmarshal(task.Payload(), &payload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	filePath := payload.FilePath
	log := w.logger.WithField("file", filePath)

	log.Info("processing file")
	startTime := time.Now()

	// Check if file exists
	if !fileutil.FileExists(filePath) {
		log.Warn("file not found, skipping")
		return nil // Don't retry - file was probably already processed or deleted
	}

	// Calculate file hash for ID
	fileID, err := fileutil.HashFile(filePath)
	if err != nil {
		return w.handleError(ctx, filePath, "hash", err)
	}

	log = log.WithField("id", fileID)

	// Check for duplicate in database
	exists, err := w.photoExists(ctx, fileID)
	if err != nil {
		return w.handleError(ctx, filePath, "duplicate_check", err)
	}
	if exists {
		log.Info("duplicate found, deleting original")
		w.cleanupOriginal(filePath)
		return nil
	}

	// Determine file type
	fileType := fileutil.GetFileType(filePath)
	if fileType == fileutil.FileTypeUnknown {
		return w.handleError(ctx, filePath, "type_detection", fmt.Errorf("unsupported file type"))
	}

	// Process based on type
	var photo *models.PhotoInsert
	if fileType == fileutil.FileTypeImage {
		photo, err = w.processImage(ctx, filePath, fileID)
	} else {
		photo, err = w.processVideo(ctx, filePath, fileID)
	}

	if err != nil {
		return w.handleError(ctx, filePath, "processing", err)
	}

	// Save to database
	if err := w.savePhoto(ctx, photo); err != nil {
		return w.handleError(ctx, filePath, "database", err)
	}

	// Create event
	if err := w.createEvent(ctx, fileID, string(photo.Type)); err != nil {
		log.WithError(err).Warn("failed to create event")
		// Don't fail the task for event creation failure
	}

	// Delete original file only after successful database save
	w.cleanupOriginal(filePath)

	duration := time.Since(startTime)
	log.WithField("duration_ms", duration.Milliseconds()).Info("file processed successfully")

	return nil
}

// processImage processes an image file.
func (w *Worker) processImage(ctx context.Context, filePath, fileID string) (*models.PhotoInsert, error) {
	// Extract EXIF metadata
	exifMeta, err := w.exifExtractor.Extract(filePath)
	if err != nil {
		w.logger.WithError(err).Warn("failed to extract EXIF metadata")
	}

	// Process image (resize, create previews)
	result, err := w.imageProc.Process(filePath, fileID)
	if err != nil {
		return nil, fmt.Errorf("image processing failed: %w", err)
	}

	// Get original file size
	originalSize, _ := fileutil.GetFileSize(filePath)

	// Build photo record
	photo := &models.PhotoInsert{
		ID:               fileID,
		Type:             "photo",
		Status:           "ready",
		OriginalPath:     strPtr(fileutil.RelativePath(w.cfg.UploadsDir, filePath)),
		OriginalFilename: strPtr(filepath.Base(filePath)),
		Blurhash:         strPtr(result.Blurhash),
		Width:            intPtr(result.OriginalWidth),
		Height:           intPtr(result.OriginalHeight),
		SmallWidth:       intPtr(result.SmallWidth),
		SmallHeight:      intPtr(result.SmallHeight),
		MediumWidth:      intPtr(result.MediumWidth),
		MediumHeight:     intPtr(result.MediumHeight),
		LargeWidth:       intPtr(result.LargeWidth),
		LargeHeight:      intPtr(result.LargeHeight),
		SizeOriginal:     intPtr(int(originalSize)),
		SizeSmall:        intPtr(result.SmallSize),
		SizeMedium:       intPtr(result.MediumSize),
		SizeLarge:        intPtr(result.LargeSize),
	}

	// Add EXIF metadata if available
	if exifMeta != nil {
		if exifMeta.TakenAt != nil {
			photo.TakenAt = exifMeta.TakenAt
		}
		if exifMeta.CameraMake != "" {
			photo.CameraMake = strPtr(exifMeta.CameraMake)
		}
		if exifMeta.CameraModel != "" {
			photo.CameraModel = strPtr(exifMeta.CameraModel)
		}
		if exifMeta.Lens != "" {
			photo.Lens = strPtr(exifMeta.Lens)
		}
		if exifMeta.ISO > 0 {
			photo.ISO = intPtr(exifMeta.ISO)
		}
		if exifMeta.Aperture > 0 {
			photo.Aperture = float64Ptr(exifMeta.Aperture)
		}
		if exifMeta.ShutterSpeed != "" {
			photo.ShutterSpeed = strPtr(exifMeta.ShutterSpeed)
		}
		if exifMeta.FocalLength > 0 {
			photo.FocalLength = float64Ptr(exifMeta.FocalLength)
		}
		photo.Flash = boolPtr(exifMeta.Flash)

		// GPS coordinates
		if exifMeta.HasGPS() {
			photo.GPSLat = exifMeta.GPSLat
			photo.GPSLon = exifMeta.GPSLon
			if exifMeta.GPSAltitude != nil {
				photo.GPSAltitude = exifMeta.GPSAltitude
			}

			// Find or create place
			placeID, err := w.placeManager.FindOrCreatePlace(ctx, *exifMeta.GPSLat, *exifMeta.GPSLon)
			if err != nil {
				w.logger.WithError(err).Warn("failed to find/create place")
			} else if placeID != "" {
				photo.PlaceID = strPtr(placeID)
			}
		}
	}

	return photo, nil
}

// processVideo processes a video file.
func (w *Worker) processVideo(ctx context.Context, filePath, fileID string) (*models.PhotoInsert, error) {
	// Process video (extract thumbnail, copy original)
	result, err := w.videoProc.Process(filePath, fileID)
	if err != nil {
		return nil, fmt.Errorf("video processing failed: %w", err)
	}

	// Build photo record
	photo := &models.PhotoInsert{
		ID:               fileID,
		Type:             "video",
		Status:           "ready",
		OriginalPath:     strPtr(fileutil.RelativePath(w.cfg.UploadsDir, filePath)),
		OriginalFilename: strPtr(filepath.Base(filePath)),
		Blurhash:         strPtr(result.Blurhash),
		Width:            intPtr(result.Width),
		Height:           intPtr(result.Height),
		SmallWidth:       intPtr(result.ThumbnailWidth),
		SmallHeight:      intPtr(result.ThumbnailHeight),
		SizeOriginal:     intPtr(int(result.VideoSize)),
		SizeSmall:        intPtr(result.ThumbnailSize),
		DurationSec:      intPtr(result.DurationSec),
		VideoCodec:       strPtr(result.VideoCodec),
	}

	return photo, nil
}

// photoExists checks if a photo with the given ID exists.
func (w *Worker) photoExists(ctx context.Context, id string) (bool, error) {
	var exists bool
	err := w.db.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM photos WHERE id = $1)", id).Scan(&exists)
	return exists, err
}

// savePhoto inserts a photo record into the database.
func (w *Worker) savePhoto(ctx context.Context, photo *models.PhotoInsert) error {
	query := `
		INSERT INTO photos (
			id, type, status, original_path, original_filename, taken_at,
			created_at, updated_at, blurhash, width, height,
			small_width, small_height, medium_width, medium_height, large_width, large_height,
			size_original, size_small, size_medium, size_large,
			duration_sec, video_codec,
			camera_make, camera_model, lens, iso, aperture, shutter_speed, focal_length, flash,
			gps_lat, gps_lon, gps_altitude, place_id,
			comment, is_favorite
		) VALUES (
			$1, $2, $3, $4, $5, $6,
			NOW(), NOW(), $7, $8, $9,
			$10, $11, $12, $13, $14, $15,
			$16, $17, $18, $19,
			$20, $21,
			$22, $23, $24, $25, $26, $27, $28, $29,
			$30, $31, $32, $33,
			NULL, FALSE
		)
	`

	return w.db.Exec(ctx, query,
		photo.ID, photo.Type, photo.Status, photo.OriginalPath, photo.OriginalFilename, photo.TakenAt,
		photo.Blurhash, photo.Width, photo.Height,
		photo.SmallWidth, photo.SmallHeight, photo.MediumWidth, photo.MediumHeight, photo.LargeWidth, photo.LargeHeight,
		photo.SizeOriginal, photo.SizeSmall, photo.SizeMedium, photo.SizeLarge,
		photo.DurationSec, photo.VideoCodec,
		photo.CameraMake, photo.CameraModel, photo.Lens, photo.ISO, photo.Aperture, photo.ShutterSpeed, photo.FocalLength, photo.Flash,
		photo.GPSLat, photo.GPSLon, photo.GPSAltitude, photo.PlaceID,
	)
}

// createEvent creates a photo_added event.
func (w *Worker) createEvent(ctx context.Context, photoID, photoType string) error {
	payload := models.PhotoAddedPayload{
		PhotoID: photoID,
		Type:    photoType,
	}

	event, err := models.NewEvent(payload)
	if err != nil {
		return err
	}

	query := `INSERT INTO events (type, payload, created_at) VALUES ($1, $2, $3)`
	return w.db.Exec(ctx, query, event.Type, event.Payload, event.CreatedAt)
}

// handleError handles processing errors with retry logic.
func (w *Worker) handleError(ctx context.Context, filePath, stage string, err error) error {
	w.logger.WithFields(map[string]interface{}{
		"file":  filePath,
		"stage": stage,
		"error": err.Error(),
	}).Error("processing failed")

	// Update processing state
	if dbErr := w.updateProcessingState(ctx, filePath, stage, err); dbErr != nil {
		w.logger.WithError(dbErr).Warn("failed to update processing state")
	}

	// Return error to trigger Asynq retry
	return fmt.Errorf("%s failed: %w", stage, err)
}

// updateProcessingState updates the processing state in the database.
func (w *Worker) updateProcessingState(ctx context.Context, filePath, stage string, err error) error {
	query := `
		INSERT INTO processing_state (file_path, status, attempts, last_error, worker_id, started_at, created_at)
		VALUES ($1, 'processing', 1, $2, $3, NOW(), NOW())
		ON CONFLICT (file_path) DO UPDATE SET
			attempts = processing_state.attempts + 1,
			last_error = $2,
			worker_id = $3
	`
	return w.db.Exec(ctx, query, filePath, fmt.Sprintf("%s: %v", stage, err), w.workerID)
}

// cleanupOriginal deletes the original file and empty parent directories.
func (w *Worker) cleanupOriginal(filePath string) {
	if err := os.Remove(filePath); err != nil {
		w.logger.WithError(err).Warn("failed to delete original file")
		return
	}

	// Try to remove empty parent directories
	if err := fileutil.RemoveEmptyDirs(filePath, w.cfg.UploadsDir); err != nil {
		w.logger.WithError(err).Debug("failed to remove empty directories")
	}
}

// HandleFinalFailure is called when all retries are exhausted.
// It moves the file to the /failed directory.
func (w *Worker) HandleFinalFailure(ctx context.Context, task *asynq.Task, err error) {
	var payload queue.ProcessFilePayload
	if jsonErr := json.Unmarshal(task.Payload(), &payload); jsonErr != nil {
		w.logger.WithError(jsonErr).Error("failed to unmarshal payload for final failure")
		return
	}

	filePath := payload.FilePath
	w.logger.WithFields(map[string]interface{}{
		"file":  filePath,
		"error": err.Error(),
	}).Error("moving to failed directory after all retries exhausted")

	// Move to failed directory
	if moveErr := w.failedHandler.MoveToFailed(filePath, err.Error(), "final_failure", w.workerID); moveErr != nil {
		w.logger.WithError(moveErr).Error("failed to move file to failed directory")
	}

	// Update processing state
	query := `
		UPDATE processing_state
		SET status = 'failed', completed_at = NOW(), last_error = $2
		WHERE file_path = $1
	`
	if dbErr := w.db.Exec(ctx, query, filePath, err.Error()); dbErr != nil {
		w.logger.WithError(dbErr).Warn("failed to update processing state to failed")
	}
}

// Helper functions for creating pointers
func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func intPtr(i int) *int {
	if i == 0 {
		return nil
	}
	return &i
}

func float64Ptr(f float64) *float64 {
	if f == 0 {
		return nil
	}
	return &f
}

func boolPtr(b bool) *bool {
	return &b
}
