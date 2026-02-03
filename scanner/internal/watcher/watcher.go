// Package watcher provides file system watching capabilities.
// It combines fsnotify for real-time detection with periodic polling as fallback.
package watcher

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/eduard256/imgable/shared/pkg/fileutil"
	"github.com/eduard256/imgable/shared/pkg/logger"
)

// FileEvent represents a detected file event.
type FileEvent struct {
	Path      string
	Size      int64
	IsNew     bool
	Timestamp time.Time
}

// Handler is called when a new file is detected.
type Handler func(event FileEvent) error

// Watcher watches a directory for new media files.
type Watcher struct {
	dir          string
	handler      Handler
	pollInterval time.Duration
	logger       *logger.Logger

	// State
	mu           sync.RWMutex
	running      bool
	watchedDirs  int
	lastScanAt   time.Time
	lastScanDur  time.Duration
	filesFound   int64
	filesQueued  int64
	filesSkipped int64

	// Known files (to avoid re-processing)
	knownFiles map[string]time.Time

	// Components
	fsWatcher *FSNotifyWatcher
	poller    *Poller

	// Control
	stopChan chan struct{}
	doneChan chan struct{}
}

// Config holds watcher configuration.
type Config struct {
	// Directory to watch
	Dir string

	// Handler to call when files are detected
	Handler Handler

	// Polling interval for fallback scanning
	PollInterval time.Duration

	// Logger instance
	Logger *logger.Logger
}

// New creates a new Watcher instance.
func New(cfg Config) (*Watcher, error) {
	w := &Watcher{
		dir:          cfg.Dir,
		handler:      cfg.Handler,
		pollInterval: cfg.PollInterval,
		logger:       cfg.Logger.WithField("component", "watcher"),
		knownFiles:   make(map[string]time.Time),
		stopChan:     make(chan struct{}),
		doneChan:     make(chan struct{}),
	}

	return w, nil
}

// Start begins watching the directory.
func (w *Watcher) Start(ctx context.Context) error {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return nil
	}
	w.running = true
	w.mu.Unlock()

	w.logger.WithField("dir", w.dir).Info("starting watcher")

	// Initialize fsnotify watcher
	fsw, err := NewFSNotifyWatcher(w.dir, w.handleFSEvent, w.logger)
	if err != nil {
		w.logger.WithError(err).Warn("fsnotify watcher failed to start, using polling only")
	} else {
		w.fsWatcher = fsw
		w.mu.Lock()
		w.watchedDirs = fsw.WatchedDirs()
		w.mu.Unlock()
	}

	// Initialize poller
	w.poller = NewPoller(w.dir, w.pollInterval, w.handlePollEvent, w.logger)

	// Do initial scan
	w.logger.Info("performing initial directory scan")
	if err := w.initialScan(); err != nil {
		w.logger.WithError(err).Error("initial scan failed")
	}

	// Start components
	if w.fsWatcher != nil {
		go w.fsWatcher.Start(ctx)
	}
	go w.poller.Start(ctx)

	// Wait for stop signal
	go func() {
		select {
		case <-ctx.Done():
		case <-w.stopChan:
		}
		w.shutdown()
	}()

	return nil
}

// Stop stops the watcher gracefully.
func (w *Watcher) Stop() {
	w.mu.Lock()
	if !w.running {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()

	close(w.stopChan)
	<-w.doneChan
}

// shutdown performs graceful shutdown.
func (w *Watcher) shutdown() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.running {
		return
	}

	w.logger.Info("shutting down watcher")

	if w.fsWatcher != nil {
		w.fsWatcher.Stop()
	}
	if w.poller != nil {
		w.poller.Stop()
	}

	w.running = false
	close(w.doneChan)
}

// initialScan scans the entire directory for existing files.
func (w *Watcher) initialScan() error {
	start := time.Now()
	var filesFound, filesQueued, filesSkipped int64

	err := filepath.Walk(w.dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			w.logger.WithError(err).WithField("path", path).Warn("error accessing path")
			return nil // Continue walking
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		filesFound++

		// Skip unsupported files
		if !fileutil.IsSupportedFile(path) {
			filesSkipped++
			return nil
		}

		// Check if file is stable (not being written)
		if !w.isFileStable(path, info) {
			w.logger.WithField("path", path).Debug("file not stable, skipping for now")
			return nil
		}

		// Track known file
		w.mu.Lock()
		w.knownFiles[path] = info.ModTime()
		w.mu.Unlock()

		// Send to handler
		event := FileEvent{
			Path:      path,
			Size:      info.Size(),
			IsNew:     true,
			Timestamp: time.Now(),
		}

		if err := w.handler(event); err != nil {
			w.logger.WithError(err).WithField("path", path).Warn("handler error")
		} else {
			filesQueued++
		}

		return nil
	})

	duration := time.Since(start)

	w.mu.Lock()
	w.lastScanAt = start
	w.lastScanDur = duration
	w.filesFound += filesFound
	w.filesQueued += filesQueued
	w.filesSkipped += filesSkipped
	w.mu.Unlock()

	w.logger.WithFields(map[string]interface{}{
		"duration_ms":   duration.Milliseconds(),
		"files_found":   filesFound,
		"files_queued":  filesQueued,
		"files_skipped": filesSkipped,
	}).Info("initial scan completed")

	return err
}

// handleFSEvent handles events from fsnotify.
func (w *Watcher) handleFSEvent(path string) {
	// Get file info
	info, err := os.Stat(path)
	if err != nil {
		if !os.IsNotExist(err) {
			w.logger.WithError(err).WithField("path", path).Debug("error getting file info")
		}
		return
	}

	// Skip directories
	if info.IsDir() {
		// Add directory to fsnotify if not already watched
		if w.fsWatcher != nil {
			w.fsWatcher.AddDir(path)
		}
		return
	}

	// Skip unsupported files
	if !fileutil.IsSupportedFile(path) {
		w.mu.Lock()
		w.filesSkipped++
		w.mu.Unlock()
		return
	}

	// Check if we've already seen this file
	w.mu.Lock()
	if modTime, exists := w.knownFiles[path]; exists && modTime.Equal(info.ModTime()) {
		w.mu.Unlock()
		return
	}
	w.knownFiles[path] = info.ModTime()
	w.filesFound++
	w.mu.Unlock()

	// Wait for file to be stable
	if !w.waitForStableFile(path) {
		return
	}

	// Get updated file info after waiting
	info, err = os.Stat(path)
	if err != nil {
		return
	}

	event := FileEvent{
		Path:      path,
		Size:      info.Size(),
		IsNew:     true,
		Timestamp: time.Now(),
	}

	if err := w.handler(event); err != nil {
		w.logger.WithError(err).WithField("path", path).Warn("handler error")
	} else {
		w.mu.Lock()
		w.filesQueued++
		w.mu.Unlock()
	}
}

// handlePollEvent handles events from the poller.
func (w *Watcher) handlePollEvent(path string, info os.FileInfo) {
	// Skip directories
	if info.IsDir() {
		return
	}

	// Skip unsupported files
	if !fileutil.IsSupportedFile(path) {
		return
	}

	// Check if we've already seen this file with the same mod time
	w.mu.Lock()
	if modTime, exists := w.knownFiles[path]; exists && modTime.Equal(info.ModTime()) {
		w.mu.Unlock()
		return
	}
	w.knownFiles[path] = info.ModTime()
	w.filesFound++
	w.mu.Unlock()

	// Check if file is stable
	if !w.isFileStable(path, info) {
		return
	}

	event := FileEvent{
		Path:      path,
		Size:      info.Size(),
		IsNew:     true,
		Timestamp: time.Now(),
	}

	if err := w.handler(event); err != nil {
		w.logger.WithError(err).WithField("path", path).Warn("handler error")
	} else {
		w.mu.Lock()
		w.filesQueued++
		w.mu.Unlock()
	}
}

// isFileStable checks if a file has stopped being written to.
// Compares file size at two points in time.
func (w *Watcher) isFileStable(path string, info os.FileInfo) bool {
	// File must exist
	if info == nil {
		return false
	}

	// File must be at least 100 bytes (sanity check)
	if info.Size() < 100 {
		return false
	}

	// File must not have been modified in the last 2 seconds
	return time.Since(info.ModTime()) > 2*time.Second
}

// waitForStableFile waits for a file to stop being written.
// Returns true if file is stable, false if it was deleted or timeout.
func (w *Watcher) waitForStableFile(path string) bool {
	maxWait := 30 * time.Second
	checkInterval := 500 * time.Millisecond
	deadline := time.Now().Add(maxWait)

	var lastSize int64 = -1

	for time.Now().Before(deadline) {
		info, err := os.Stat(path)
		if err != nil {
			return false // File doesn't exist
		}

		if info.Size() == lastSize && w.isFileStable(path, info) {
			return true
		}

		lastSize = info.Size()
		time.Sleep(checkInterval)
	}

	return false
}

// RemoveKnownFile removes a file from the known files map.
// Called when a file is successfully processed or moved to failed.
func (w *Watcher) RemoveKnownFile(path string) {
	w.mu.Lock()
	delete(w.knownFiles, path)
	w.mu.Unlock()
}

// Status returns the current watcher status.
type Status struct {
	Running         bool      `json:"running"`
	WatchedDirs     int       `json:"watched_dirs"`
	LastScanAt      time.Time `json:"last_scan_at,omitempty"`
	LastScanDurMs   int64     `json:"last_scan_duration_ms,omitempty"`
	FilesDiscovered int64     `json:"files_discovered"`
	FilesQueued     int64     `json:"files_queued"`
	FilesSkipped    int64     `json:"files_skipped"`
	KnownFilesCount int       `json:"known_files_count"`
	FSNotifyActive  bool      `json:"fsnotify_active"`
	PollerActive    bool      `json:"poller_active"`
}

// Status returns the current status of the watcher.
func (w *Watcher) Status() Status {
	w.mu.RLock()
	defer w.mu.RUnlock()

	return Status{
		Running:         w.running,
		WatchedDirs:     w.watchedDirs,
		LastScanAt:      w.lastScanAt,
		LastScanDurMs:   w.lastScanDur.Milliseconds(),
		FilesDiscovered: w.filesFound,
		FilesQueued:     w.filesQueued,
		FilesSkipped:    w.filesSkipped,
		KnownFilesCount: len(w.knownFiles),
		FSNotifyActive:  w.fsWatcher != nil,
		PollerActive:    w.poller != nil,
	}
}

// Rescan triggers a full directory rescan.
func (w *Watcher) Rescan() error {
	w.logger.Info("triggering manual rescan")
	return w.initialScan()
}
