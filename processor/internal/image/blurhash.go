package image

import (
	"bytes"
	"fmt"
	"image"
	_ "image/png"

	"github.com/bbrks/go-blurhash"
	"github.com/h2non/bimg"
)

// BlurhashComponents defines the number of components for blurhash encoding.
// Higher values = more detail but longer string.
const (
	BlurhashXComponents = 4
	BlurhashYComponents = 3
	blurhashMaxSize     = 64 // Max dimension for blurhash computation
)

// generateBlurhash generates a blurhash string from an image file.
// It reads the image, resizes it to a small size for fast computation,
// and generates the blurhash string.
func (p *Processor) generateBlurhash(imagePath string) (string, error) {
	// Read the image file
	buffer, err := bimg.Read(imagePath)
	if err != nil {
		return "", fmt.Errorf("failed to read image: %w", err)
	}

	// Get current dimensions
	size, err := bimg.NewImage(buffer).Size()
	if err != nil {
		return "", fmt.Errorf("failed to get image size: %w", err)
	}

	// Resize to small size for faster blurhash computation
	// Blurhash doesn't need high resolution
	width := size.Width
	height := size.Height

	if width > blurhashMaxSize || height > blurhashMaxSize {
		var newWidth, newHeight int
		if width >= height {
			newWidth = blurhashMaxSize
			newHeight = (height * blurhashMaxSize) / width
		} else {
			newHeight = blurhashMaxSize
			newWidth = (width * blurhashMaxSize) / height
		}

		// Ensure minimum dimension
		if newWidth < 1 {
			newWidth = 1
		}
		if newHeight < 1 {
			newHeight = 1
		}

		buffer, err = bimg.NewImage(buffer).Process(bimg.Options{
			Width:  newWidth,
			Height: newHeight,
			Type:   bimg.PNG,
		})
		if err != nil {
			return "", fmt.Errorf("failed to resize for blurhash: %w", err)
		}
	} else {
		// Just convert to PNG for Go's image package
		buffer, err = bimg.NewImage(buffer).Process(bimg.Options{
			Type: bimg.PNG,
		})
		if err != nil {
			return "", fmt.Errorf("failed to convert to PNG: %w", err)
		}
	}

	// Decode PNG with Go's standard image package
	goImg, _, err := image.Decode(bytes.NewReader(buffer))
	if err != nil {
		return "", fmt.Errorf("failed to decode image: %w", err)
	}

	// Generate blurhash
	hash, err := blurhash.Encode(BlurhashXComponents, BlurhashYComponents, goImg)
	if err != nil {
		return "", fmt.Errorf("failed to encode blurhash: %w", err)
	}

	return hash, nil
}
