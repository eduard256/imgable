// Package image provides image processing functionality using libvips.
// It handles image resizing, format conversion, and blurhash generation.
package image

import (
	"fmt"
	"path/filepath"

	"github.com/davidbyttow/govips/v2/vips"

	"github.com/eduard256/imgable/shared/pkg/fileutil"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

// Processor handles image processing operations.
type Processor struct {
	config ProcessorConfig
	logger *logger.Logger
}

// ProcessorConfig holds image processor configuration.
type ProcessorConfig struct {
	// Preview sizes (longest edge in pixels)
	SmallPx  int
	MediumPx int
	LargePx  int

	// WebP quality (1-100)
	Quality int

	// Temporary directory for intermediate files
	TempDir string

	// Output directory for processed files
	OutputDir string
}

// ProcessResult holds the results of image processing.
type ProcessResult struct {
	// Generated file paths
	SmallPath  string
	MediumPath string
	LargePath  string

	// Dimensions after processing
	SmallWidth   int
	SmallHeight  int
	MediumWidth  int
	MediumHeight int
	LargeWidth   int
	LargeHeight  int

	// File sizes in bytes
	SmallSize  int
	MediumSize int
	LargeSize  int

	// Original dimensions
	OriginalWidth  int
	OriginalHeight int

	// Blurhash for placeholder
	Blurhash string
}

// NewProcessor creates a new image processor.
func NewProcessor(cfg ProcessorConfig, log *logger.Logger) *Processor {
	return &Processor{
		config: cfg,
		logger: log.WithField("component", "image-processor"),
	}
}

// Initialize initializes the vips library.
// Must be called before processing any images.
func Initialize() {
	vips.LoggingSettings(nil, vips.LogLevelWarning)
	vips.Startup(nil)
}

// Shutdown shuts down the vips library.
// Should be called when the application exits.
func Shutdown() {
	vips.Shutdown()
}

// Process processes an image file and generates previews.
// Returns ProcessResult with paths to generated files.
func (p *Processor) Process(inputPath, outputID string) (*ProcessResult, error) {
	p.logger.WithField("input", inputPath).Debug("processing image")

	// Load image
	img, err := vips.NewImageFromFile(inputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to load image: %w", err)
	}
	defer img.Close()

	// Auto-rotate based on EXIF orientation
	if err := img.AutoRotate(); err != nil {
		p.logger.WithError(err).Warn("failed to auto-rotate image")
	}

	result := &ProcessResult{
		OriginalWidth:  img.Width(),
		OriginalHeight: img.Height(),
	}

	// Create output directory
	outputDir := fileutil.GetMediaDir(p.config.OutputDir, outputID)
	if err := fileutil.EnsureDir(outputDir); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	// Generate previews (from large to small to avoid quality loss)
	// Large preview
	largePath, largeW, largeH, largeSize, err := p.generatePreview(img, outputID, "l", p.config.LargePx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate large preview: %w", err)
	}
	result.LargePath = largePath
	result.LargeWidth = largeW
	result.LargeHeight = largeH
	result.LargeSize = largeSize

	// Medium preview
	mediumPath, mediumW, mediumH, mediumSize, err := p.generatePreview(img, outputID, "m", p.config.MediumPx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate medium preview: %w", err)
	}
	result.MediumPath = mediumPath
	result.MediumWidth = mediumW
	result.MediumHeight = mediumH
	result.MediumSize = mediumSize

	// Small preview (also used for blurhash)
	smallPath, smallW, smallH, smallSize, err := p.generatePreview(img, outputID, "s", p.config.SmallPx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate small preview: %w", err)
	}
	result.SmallPath = smallPath
	result.SmallWidth = smallW
	result.SmallHeight = smallH
	result.SmallSize = smallSize

	// Generate blurhash from small preview
	blurhash, err := p.generateBlurhash(smallPath)
	if err != nil {
		p.logger.WithError(err).Warn("failed to generate blurhash")
	} else {
		result.Blurhash = blurhash
	}

	p.logger.WithFields(map[string]interface{}{
		"original": fmt.Sprintf("%dx%d", result.OriginalWidth, result.OriginalHeight),
		"small":    fmt.Sprintf("%dx%d (%d bytes)", result.SmallWidth, result.SmallHeight, result.SmallSize),
		"medium":   fmt.Sprintf("%dx%d (%d bytes)", result.MediumWidth, result.MediumHeight, result.MediumSize),
		"large":    fmt.Sprintf("%dx%d (%d bytes)", result.LargeWidth, result.LargeHeight, result.LargeSize),
	}).Debug("image processing completed")

	return result, nil
}

// generatePreview generates a single preview at the specified size.
func (p *Processor) generatePreview(img *vips.ImageRef, outputID, suffix string, targetPx int) (path string, width, height, size int, err error) {
	// Calculate scale factor
	originalWidth := img.Width()
	originalHeight := img.Height()

	// Determine longest edge
	longestEdge := originalWidth
	if originalHeight > originalWidth {
		longestEdge = originalHeight
	}

	// Don't upscale - if original is smaller than target, use original size
	if longestEdge <= targetPx {
		targetPx = longestEdge
	}

	// Calculate scale
	scale := float64(targetPx) / float64(longestEdge)

	// Create a copy for resizing
	resized, err := img.Copy()
	if err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to copy image: %w", err)
	}
	defer resized.Close()

	// Resize
	if err := resized.Resize(scale, vips.KernelLanczos3); err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to resize: %w", err)
	}

	// Output path
	outputPath := fileutil.GetMediaPath(p.config.OutputDir, outputID, "_"+suffix+".webp")

	// Export to WebP
	webpParams := vips.NewWebpExportParams()
	webpParams.Quality = p.config.Quality
	webpParams.Lossless = false
	webpParams.StripMetadata = true

	webpBytes, _, err := resized.ExportWebp(webpParams)
	if err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to export WebP: %w", err)
	}

	// Write to file
	if err := writeFile(outputPath, webpBytes); err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to write file: %w", err)
	}

	return outputPath, resized.Width(), resized.Height(), len(webpBytes), nil
}

// writeFile writes bytes to a file, creating parent directories if needed.
func writeFile(path string, data []byte) error {
	if err := fileutil.EnsureDir(filepath.Dir(path)); err != nil {
		return err
	}

	f, err := fileutil.CreateTemp(filepath.Dir(path), "imgable-")
	if err != nil {
		return err
	}
	tempPath := f.Name()

	if _, err := f.Write(data); err != nil {
		f.Close()
		fileutil.SafeDelete(tempPath)
		return err
	}

	if err := f.Sync(); err != nil {
		f.Close()
		fileutil.SafeDelete(tempPath)
		return err
	}

	if err := f.Close(); err != nil {
		fileutil.SafeDelete(tempPath)
		return err
	}

	// Atomic rename
	if err := fileutil.MoveFile(tempPath, path); err != nil {
		fileutil.SafeDelete(tempPath)
		return err
	}

	return nil
}
