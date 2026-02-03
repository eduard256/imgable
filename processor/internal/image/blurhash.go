package image

import (
	"fmt"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"os"

	"github.com/bbrks/go-blurhash"
	"github.com/davidbyttow/govips/v2/vips"
)

// BlurhashComponents defines the number of components for blurhash encoding.
// Higher values = more detail but longer string.
const (
	BlurhashXComponents = 4
	BlurhashYComponents = 3
)

// generateBlurhash generates a blurhash string from an image file.
func (p *Processor) generateBlurhash(imagePath string) (string, error) {
	// Load image with vips for better format support
	img, err := vips.NewImageFromFile(imagePath)
	if err != nil {
		return "", fmt.Errorf("failed to load image for blurhash: %w", err)
	}
	defer img.Close()

	// Resize to small size for faster blurhash computation
	// Blurhash doesn't need high resolution
	const maxSize = 64
	scale := float64(maxSize) / float64(max(img.Width(), img.Height()))
	if scale < 1 {
		if err := img.Resize(scale, vips.KernelNearest); err != nil {
			return "", fmt.Errorf("failed to resize for blurhash: %w", err)
		}
	}

	// Export as PNG for Go's image package
	pngParams := vips.NewPngExportParams()
	pngBytes, _, err := img.ExportPng(pngParams)
	if err != nil {
		return "", fmt.Errorf("failed to export for blurhash: %w", err)
	}

	// Create temporary file
	tmpFile, err := os.CreateTemp("", "blurhash-*.png")
	if err != nil {
		return "", fmt.Errorf("failed to create temp file: %w", err)
	}
	tmpPath := tmpFile.Name()
	defer os.Remove(tmpPath)

	if _, err := tmpFile.Write(pngBytes); err != nil {
		tmpFile.Close()
		return "", fmt.Errorf("failed to write temp file: %w", err)
	}
	tmpFile.Close()

	// Open with Go's image package
	file, err := os.Open(tmpPath)
	if err != nil {
		return "", fmt.Errorf("failed to open temp file: %w", err)
	}
	defer file.Close()

	goImg, _, err := image.Decode(file)
	if err != nil {
		return "", fmt.Errorf("failed to decode image for blurhash: %w", err)
	}

	// Generate blurhash
	hash, err := blurhash.Encode(BlurhashXComponents, BlurhashYComponents, goImg)
	if err != nil {
		return "", fmt.Errorf("failed to encode blurhash: %w", err)
	}

	return hash, nil
}

// GenerateBlurhashFromFile generates a blurhash from an image file path.
func GenerateBlurhashFromFile(imagePath string) (string, error) {
	file, err := os.Open(imagePath)
	if err != nil {
		return "", fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil {
		return "", fmt.Errorf("failed to decode image: %w", err)
	}

	hash, err := blurhash.Encode(BlurhashXComponents, BlurhashYComponents, img)
	if err != nil {
		return "", fmt.Errorf("failed to encode blurhash: %w", err)
	}

	return hash, nil
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
