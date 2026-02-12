// Package image provides image processing functionality using bimg/libvips.
// It handles image resizing, format conversion, and blurhash generation.
package image

import (
	"fmt"

	"github.com/h2non/bimg"

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
	SmallPx int
	LargePx int

	// WebP quality (1-100)
	Quality int

	// Output directory for processed files
	OutputDir string
}

// ProcessResult holds the results of image processing.
type ProcessResult struct {
	// Generated file paths
	SmallPath string
	LargePath string

	// Dimensions after processing
	SmallWidth  int
	SmallHeight int
	LargeWidth  int
	LargeHeight int

	// File sizes in bytes
	SmallSize int
	LargeSize int

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

// Initialize initializes the bimg/libvips library.
// Must be called before processing any images.
func Initialize() {
	bimg.Initialize()
	bimg.VipsCacheSetMaxMem(256 * 1024 * 1024) // 256MB cache
}

// Shutdown shuts down the bimg/libvips library.
// Should be called when the application exits.
func Shutdown() {
	bimg.VipsCacheDropAll()
	bimg.Shutdown()
}

// DropCache clears the libvips cache to free memory.
// Call this when processor is idle to reduce memory footprint.
func DropCache() {
	bimg.VipsCacheDropAll()
}

// Process processes an image file and generates previews.
// Returns ProcessResult with paths to generated files.
func (p *Processor) Process(inputPath, outputID string) (*ProcessResult, error) {
	p.logger.WithField("input", inputPath).Debug("processing image")

	// Read the source image
	buffer, err := bimg.Read(inputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read image: %w", err)
	}

	// Auto-rotate based on EXIF orientation first
	buffer, err = bimg.NewImage(buffer).AutoRotate()
	if err != nil {
		p.logger.WithError(err).Warn("failed to auto-rotate image, continuing with original")
		// Re-read original if auto-rotate failed
		buffer, _ = bimg.Read(inputPath)
	}

	// Get original dimensions (after rotation)
	size, err := bimg.NewImage(buffer).Size()
	if err != nil {
		return nil, fmt.Errorf("failed to get image size: %w", err)
	}

	result := &ProcessResult{
		OriginalWidth:  size.Width,
		OriginalHeight: size.Height,
	}

	// Create output directory
	outputDir := fileutil.GetMediaDir(p.config.OutputDir, outputID)
	if err := fileutil.EnsureDir(outputDir); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	// Generate previews (from large to small)
	// Large preview
	largePath, largeW, largeH, largeSize, err := p.generatePreview(buffer, outputID, "l", p.config.LargePx)
	if err != nil {
		return nil, fmt.Errorf("failed to generate large preview: %w", err)
	}
	result.LargePath = largePath
	result.LargeWidth = largeW
	result.LargeHeight = largeH
	result.LargeSize = largeSize

	// Small preview
	smallPath, smallW, smallH, smallSize, err := p.generatePreview(buffer, outputID, "s", p.config.SmallPx)
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
		"large":    fmt.Sprintf("%dx%d (%d bytes)", result.LargeWidth, result.LargeHeight, result.LargeSize),
	}).Debug("image processing completed")

	return result, nil
}

// generatePreview generates a single preview at the specified size.
// It resizes the image so that the longest edge equals targetPx (without upscaling).
func (p *Processor) generatePreview(buffer []byte, outputID, suffix string, targetPx int) (path string, width, height, size int, err error) {
	// Get current dimensions
	imgSize, err := bimg.NewImage(buffer).Size()
	if err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to get image size: %w", err)
	}

	origWidth := imgSize.Width
	origHeight := imgSize.Height

	// Determine longest edge
	longestEdge := origWidth
	if origHeight > origWidth {
		longestEdge = origHeight
	}

	// Don't upscale - if original is smaller than target, use original size
	if longestEdge <= targetPx {
		targetPx = longestEdge
	}

	// Calculate target dimensions preserving aspect ratio
	var newWidth, newHeight int
	if origWidth >= origHeight {
		// Landscape or square
		newWidth = targetPx
		newHeight = (origHeight * targetPx) / origWidth
	} else {
		// Portrait
		newHeight = targetPx
		newWidth = (origWidth * targetPx) / origHeight
	}

	// Ensure minimum dimension of 1 pixel
	if newWidth < 1 {
		newWidth = 1
	}
	if newHeight < 1 {
		newHeight = 1
	}

	// Process image: resize and convert to WebP
	processed, err := bimg.NewImage(buffer).Process(bimg.Options{
		Width:         newWidth,
		Height:        newHeight,
		Type:          bimg.WEBP,
		Quality:       p.config.Quality,
		StripMetadata: true,
		NoAutoRotate:  true, // Already rotated
	})
	if err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to process image: %w", err)
	}

	// Get actual dimensions after processing
	finalSize, err := bimg.NewImage(processed).Size()
	if err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to get final size: %w", err)
	}

	// Write to file
	outputPath := fileutil.GetMediaPath(p.config.OutputDir, outputID, "_"+suffix+".webp")
	if err := bimg.Write(outputPath, processed); err != nil {
		return "", 0, 0, 0, fmt.Errorf("failed to write file: %w", err)
	}

	return outputPath, finalSize.Width, finalSize.Height, len(processed), nil
}
