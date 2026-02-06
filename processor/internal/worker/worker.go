// Package worker provides the file processing worker implementation.
// It handles the complete processing pipeline for photos and videos.
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5"

	"github.com/eduard256/imgable/processor/internal/config"
	"github.com/eduard256/imgable/processor/internal/failed"
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

	// Determine file type BEFORE reserving (needed for DB constraint)
	fileType := fileutil.GetFileType(filePath)
	if fileType == fileutil.FileTypeUnknown {
		return w.handleError(ctx, filePath, "type_detection", fmt.Errorf("unsupported file type"))
	}

	// Convert to DB type string
	var dbType string
	if fileType == fileutil.FileTypeImage {
		dbType = "photo"
	} else {
		dbType = "video"
	}

	// Atomically reserve this photo ID to prevent race conditions.
	// If another worker already reserved it, this is a duplicate file.
	reserved, err := w.reservePhotoID(ctx, fileID, filePath, dbType)
	if err != nil {
		return w.handleError(ctx, filePath, "reserve", err)
	}
	if !reserved {
		log.Info("duplicate found, deleting original")
		w.cleanupOriginal(filePath)
		return nil
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
		LargeWidth:       intPtr(result.LargeWidth),
		LargeHeight:      intPtr(result.LargeHeight),
		SizeOriginal:     intPtr(int(originalSize)),
		SizeSmall:        intPtr(result.SmallSize),
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

		// GPS coordinates (place_id is assigned by a separate geocoding worker)
		if exifMeta.HasGPS() {
			photo.GPSLat = exifMeta.GPSLat
			photo.GPSLon = exifMeta.GPSLon
			if exifMeta.GPSAltitude != nil {
				photo.GPSAltitude = exifMeta.GPSAltitude
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

	// Add GPS coordinates if available (place_id is assigned by places service)
	if result.GPSLat != nil && result.GPSLon != nil {
		photo.GPSLat = result.GPSLat
		photo.GPSLon = result.GPSLon
	}

	// Add taken_at if available
	if result.TakenAt != nil {
		photo.TakenAt = result.TakenAt
	}

	return photo, nil
}

// reservePhotoID attempts to atomically reserve a photo ID for processing.
// Returns true if this worker reserved the ID (should process the file).
// Returns false if the ID already exists (duplicate file, should skip).
// This is an atomic operation that prevents race conditions between workers.
func (w *Worker) reservePhotoID(ctx context.Context, fileID, filePath, fileType string) (bool, error) {
	var reserved bool
	err := w.db.QueryRow(ctx, `
		INSERT INTO photos (id, type, status, original_path, created_at, updated_at)
		VALUES ($1, $2, 'processing', $3, NOW(), NOW())
		ON CONFLICT (id) DO NOTHING
		RETURNING TRUE
	`, fileID, fileType, filePath).Scan(&reserved)

	if errors.Is(err, pgx.ErrNoRows) {
		// ON CONFLICT triggered - duplicate file
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return reserved, nil
}

// savePhoto updates the reserved photo record with full data.
func (w *Worker) savePhoto(ctx context.Context, photo *models.PhotoInsert) error {
	query := `
		UPDATE photos SET
			type = $2,
			status = $3,
			original_path = $4,
			original_filename = $5,
			taken_at = $6,
			updated_at = NOW(),
			blurhash = $7,
			width = $8,
			height = $9,
			small_width = $10,
			small_height = $11,
			large_width = $12,
			large_height = $13,
			size_original = $14,
			size_small = $15,
			size_large = $16,
			duration_sec = $17,
			video_codec = $18,
			camera_make = $19,
			camera_model = $20,
			lens = $21,
			iso = $22,
			aperture = $23,
			shutter_speed = $24,
			focal_length = $25,
			flash = $26,
			gps_lat = $27,
			gps_lon = $28,
			gps_altitude = $29
		WHERE id = $1
	`

	return w.db.Exec(ctx, query,
		photo.ID, photo.Type, photo.Status, photo.OriginalPath, photo.OriginalFilename, photo.TakenAt,
		photo.Blurhash, photo.Width, photo.Height,
		photo.SmallWidth, photo.SmallHeight, photo.LargeWidth, photo.LargeHeight,
		photo.SizeOriginal, photo.SizeSmall, photo.SizeLarge,
		photo.DurationSec, photo.VideoCodec,
		photo.CameraMake, photo.CameraModel, photo.Lens, photo.ISO, photo.Aperture, photo.ShutterSpeed, photo.FocalLength, photo.Flash,
		photo.GPSLat, photo.GPSLon, photo.GPSAltitude,
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
	// Convert json.RawMessage to string for SimpleProtocol compatibility
	return w.db.Exec(ctx, query, event.Type, string(event.Payload), event.CreatedAt)
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

// cleanupPreviews removes generated preview files for a photo ID.
// Used when we detect a duplicate after previews were already created.
func (w *Worker) cleanupPreviews(fileID string) {
	suffixes := []string{"_s.webp", "_l.webp", ".mp4", ".mov", ".avi", ".mkv", ".webm"}
	for _, suffix := range suffixes {
		path := fileutil.GetMediaPath(w.cfg.MediaDir, fileID, suffix)
		if fileutil.FileExists(path) {
			if err := os.Remove(path); err != nil {
				w.logger.WithError(err).WithField("path", path).Debug("failed to cleanup preview")
			}
		}
	}

	// Try to remove empty directories
	dir := fileutil.GetMediaDir(w.cfg.MediaDir, fileID)
	fileutil.RemoveEmptyDirs(dir+"/dummy", w.cfg.MediaDir)
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
