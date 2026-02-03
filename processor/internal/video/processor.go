// Package video provides video processing functionality using ffmpeg.
// It handles thumbnail extraction and video metadata reading.
package video

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/eduard256/imgable/shared/pkg/fileutil"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

// Processor handles video processing operations.
type Processor struct {
	config ProcessorConfig
	logger *logger.Logger
}

// ProcessorConfig holds video processor configuration.
type ProcessorConfig struct {
	// Thumbnail size (longest edge in pixels)
	ThumbnailPx int

	// WebP quality for thumbnails
	Quality int

	// Output directory for processed files
	OutputDir string
}

// ProcessResult holds the results of video processing.
type ProcessResult struct {
	// Thumbnail file path
	ThumbnailPath string

	// Thumbnail dimensions
	ThumbnailWidth  int
	ThumbnailHeight int

	// Thumbnail file size in bytes
	ThumbnailSize int

	// Original video path (copied to output)
	VideoPath string

	// Video dimensions
	Width  int
	Height int

	// Video metadata
	DurationSec int
	VideoCodec  string
	AudioCodec  string

	// File size of video in bytes
	VideoSize int64

	// Blurhash for thumbnail
	Blurhash string
}

// VideoMetadata holds ffprobe output.
type VideoMetadata struct {
	Format  FormatInfo   `json:"format"`
	Streams []StreamInfo `json:"streams"`
}

// FormatInfo holds video format information.
type FormatInfo struct {
	Duration   string `json:"duration"`
	Size       string `json:"size"`
	FormatName string `json:"format_name"`
}

// StreamInfo holds video/audio stream information.
type StreamInfo struct {
	CodecType string `json:"codec_type"`
	CodecName string `json:"codec_name"`
	Width     int    `json:"width,omitempty"`
	Height    int    `json:"height,omitempty"`
}

// NewProcessor creates a new video processor.
func NewProcessor(cfg ProcessorConfig, log *logger.Logger) *Processor {
	return &Processor{
		config: cfg,
		logger: log.WithField("component", "video-processor"),
	}
}

// Process processes a video file - extracts thumbnail and copies original.
func (p *Processor) Process(inputPath, outputID string) (*ProcessResult, error) {
	p.logger.WithField("input", inputPath).Debug("processing video")

	// Get video metadata
	metadata, err := p.getMetadata(inputPath)
	if err != nil {
		return nil, fmt.Errorf("failed to get video metadata: %w", err)
	}

	result := &ProcessResult{}

	// Extract video stream info
	for _, stream := range metadata.Streams {
		if stream.CodecType == "video" {
			result.Width = stream.Width
			result.Height = stream.Height
			result.VideoCodec = stream.CodecName
		}
		if stream.CodecType == "audio" {
			result.AudioCodec = stream.CodecName
		}
	}

	// Parse duration
	if metadata.Format.Duration != "" {
		if duration, err := strconv.ParseFloat(metadata.Format.Duration, 64); err == nil {
			result.DurationSec = int(duration)
		}
	}

	// Create output directory
	outputDir := fileutil.GetMediaDir(p.config.OutputDir, outputID)
	if err := fileutil.EnsureDir(outputDir); err != nil {
		return nil, fmt.Errorf("failed to create output directory: %w", err)
	}

	// Extract thumbnail from middle of video
	thumbnailPath := fileutil.GetMediaPath(p.config.OutputDir, outputID, "_s.webp")
	if err := p.extractThumbnail(inputPath, thumbnailPath, result.DurationSec); err != nil {
		return nil, fmt.Errorf("failed to extract thumbnail: %w", err)
	}
	result.ThumbnailPath = thumbnailPath

	// Get thumbnail dimensions and size
	thumbInfo, err := p.getThumbnailInfo(thumbnailPath)
	if err != nil {
		p.logger.WithError(err).Warn("failed to get thumbnail info")
	} else {
		result.ThumbnailWidth = thumbInfo.Width
		result.ThumbnailHeight = thumbInfo.Height
	}

	if size, err := fileutil.GetFileSize(thumbnailPath); err == nil {
		result.ThumbnailSize = int(size)
	}

	// Copy video to output (no transcoding)
	videoPath := fileutil.GetMediaPath(p.config.OutputDir, outputID, ".mp4")
	ext := strings.ToLower(filepath.Ext(inputPath))
	if ext != ".mp4" {
		// For non-mp4, keep original extension
		videoPath = fileutil.GetMediaPath(p.config.OutputDir, outputID, ext)
	}

	if err := fileutil.CopyFile(inputPath, videoPath); err != nil {
		return nil, fmt.Errorf("failed to copy video: %w", err)
	}
	result.VideoPath = videoPath

	if size, err := fileutil.GetFileSize(videoPath); err == nil {
		result.VideoSize = size
	}

	p.logger.WithFields(map[string]interface{}{
		"dimensions":  fmt.Sprintf("%dx%d", result.Width, result.Height),
		"duration":    result.DurationSec,
		"codec":       result.VideoCodec,
		"thumb_size":  result.ThumbnailSize,
		"video_size":  result.VideoSize,
	}).Debug("video processing completed")

	return result, nil
}

// getMetadata extracts video metadata using ffprobe.
func (p *Processor) getMetadata(inputPath string) (*VideoMetadata, error) {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_format",
		"-show_streams",
		inputPath,
	)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("ffprobe failed: %v, stderr: %s", err, stderr.String())
	}

	var metadata VideoMetadata
	if err := json.Unmarshal(stdout.Bytes(), &metadata); err != nil {
		return nil, fmt.Errorf("failed to parse ffprobe output: %w", err)
	}

	return &metadata, nil
}

// extractThumbnail extracts a thumbnail from the video at the middle point.
func (p *Processor) extractThumbnail(inputPath, outputPath string, durationSec int) error {
	// Seek to middle of video (or 1 second if very short)
	seekSec := durationSec / 2
	if seekSec < 1 {
		seekSec = 1
	}

	// Calculate scale filter to fit within target size
	scaleFilter := fmt.Sprintf("scale='min(%d,iw)':min'(%d,ih)':force_original_aspect_ratio=decrease",
		p.config.ThumbnailPx, p.config.ThumbnailPx)

	// Create temp file for output (use .tmp extension, but specify format explicitly)
	tempPath := outputPath + ".tmp"

	cmd := exec.Command("ffmpeg",
		"-y",                           // Overwrite output
		"-ss", strconv.Itoa(seekSec),   // Seek position
		"-i", inputPath,                // Input file
		"-vframes", "1",                // Extract 1 frame
		"-vf", scaleFilter,             // Scale filter
		"-c:v", "libwebp",              // WebP codec
		"-quality", strconv.Itoa(p.config.Quality), // Quality
		"-lossless", "0",               // Lossy compression
		"-f", "webp",                   // Force WebP format (extension is .tmp)
		tempPath,
	)

	var stderr bytes.Buffer
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("ffmpeg failed: %v, stderr: %s", err, stderr.String())
	}

	// Atomic rename
	if err := os.Rename(tempPath, outputPath); err != nil {
		os.Remove(tempPath)
		return fmt.Errorf("failed to rename temp file: %w", err)
	}

	return nil
}

// ThumbnailInfo holds thumbnail image information.
type ThumbnailInfo struct {
	Width  int
	Height int
}

// getThumbnailInfo gets thumbnail dimensions using ffprobe.
func (p *Processor) getThumbnailInfo(path string) (*ThumbnailInfo, error) {
	cmd := exec.Command("ffprobe",
		"-v", "quiet",
		"-print_format", "json",
		"-show_streams",
		path,
	)

	var stdout bytes.Buffer
	cmd.Stdout = &stdout

	if err := cmd.Run(); err != nil {
		return nil, err
	}

	var result struct {
		Streams []struct {
			Width  int `json:"width"`
			Height int `json:"height"`
		} `json:"streams"`
	}

	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		return nil, err
	}

	if len(result.Streams) > 0 {
		return &ThumbnailInfo{
			Width:  result.Streams[0].Width,
			Height: result.Streams[0].Height,
		}, nil
	}

	return nil, fmt.Errorf("no streams found")
}

// IsFFmpegAvailable checks if ffmpeg is available in PATH.
func IsFFmpegAvailable() bool {
	_, err := exec.LookPath("ffmpeg")
	return err == nil
}

// IsFFprobeAvailable checks if ffprobe is available in PATH.
func IsFFprobeAvailable() bool {
	_, err := exec.LookPath("ffprobe")
	return err == nil
}
