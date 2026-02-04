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

// pendingFile represents a file that has been detected but not yet confirmed stable.
// Files must be seen in at least 2 poll cycles with unchanged size/modTime before processing.
type pendingFile struct {
	size    int64     // File size at last check
	modTime time.Time // Modification time at last check
	seenAt  time.Time // When first detected
}

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

	// Known files - files that have been successfully queued for processing.
	// Key: file path, Value: modification time when queued.
	knownFiles map[string]time.Time

	// Pending files - files detected but not yet confirmed stable.
	// Used by polling to track files still being copied.
	// Key: file path, Value: file state at last check.
	pendingFiles map[string]*pendingFile

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
		pendingFiles: make(map[string]*pendingFile),
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
// Files are added to pendingFiles and will be processed on subsequent polls
// once confirmed stable.
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

		// Check if already known (processed)
		w.mu.Lock()
		if modTime, exists := w.knownFiles[path]; exists && modTime.Equal(info.ModTime()) {
			w.mu.Unlock()
			return nil
		}

		// Check if file is stable (not modified in last 2 seconds)
		if !w.isFileStable(path, info) {
			// Add to pending files for tracking
			w.pendingFiles[path] = &pendingFile{
				size:    info.Size(),
				modTime: info.ModTime(),
				seenAt:  time.Now(),
			}
			w.mu.Unlock()
			w.logger.WithField("path", path).Debug("file not stable, added to pending")
			return nil
		}

		// File is stable - add to known and process
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
// For fsnotify, we use active waiting since we get immediate notifications.
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

	// Check if we've already processed this file
	w.mu.Lock()
	if modTime, exists := w.knownFiles[path]; exists && modTime.Equal(info.ModTime()) {
		w.mu.Unlock()
		return
	}
	w.filesFound++
	w.mu.Unlock()

	// Wait for file to be stable (active waiting for fsnotify)
	if !w.waitForStableFile(path) {
		return
	}

	// Get updated file info after waiting
	info, err = os.Stat(path)
	if err != nil {
		return
	}

	// Mark as known AFTER confirming stable and BEFORE sending to handler
	w.mu.Lock()
	w.knownFiles[path] = info.ModTime()
	w.mu.Unlock()

	event := FileEvent{
		Path:      path,
		Size:      info.Size(),
		IsNew:     true,
		Timestamp: time.Now(),
	}

	if err := w.handler(event); err != nil {
		w.logger.WithError(err).WithField("path", path).Warn("handler error")
		// Remove from known on error so it can be retried
		w.mu.Lock()
		delete(w.knownFiles, path)
		w.mu.Unlock()
	} else {
		w.mu.Lock()
		w.filesQueued++
		w.mu.Unlock()
	}
}

// handlePollEvent handles events from the poller.
// Uses pendingFiles to track files across poll cycles and ensure stability.
//
// Logic:
// 1. If file is already in knownFiles with same modTime -> skip (already processed)
// 2. If file is NOT in pendingFiles -> add to pendingFiles, wait for next poll
// 3. If file IS in pendingFiles:
//   - If size or modTime changed -> update pendingFiles, wait for next poll
//   - If unchanged AND >1 sec since seenAt -> file is stable, process it
func (w *Watcher) handlePollEvent(path string, info os.FileInfo) {
	// Skip directories
	if info.IsDir() {
		return
	}

	// Skip unsupported files
	if !fileutil.IsSupportedFile(path) {
		return
	}

	w.mu.Lock()

	// Step 1: Check if already processed
	if modTime, exists := w.knownFiles[path]; exists && modTime.Equal(info.ModTime()) {
		w.mu.Unlock()
		return
	}

	// Step 2: Check if in pending files
	pending, isPending := w.pendingFiles[path]

	if !isPending {
		// First time seeing this file - add to pending, wait for next poll
		w.pendingFiles[path] = &pendingFile{
			size:    info.Size(),
			modTime: info.ModTime(),
			seenAt:  time.Now(),
		}
		w.filesFound++
		w.mu.Unlock()
		w.logger.WithField("path", path).Debug("new file detected, added to pending")
		return
	}

	// Step 3: File is in pending - check if it has changed
	if pending.size != info.Size() || !pending.modTime.Equal(info.ModTime()) {
		// File is still being written - update pending state
		pending.size = info.Size()
		pending.modTime = info.ModTime()
		pending.seenAt = time.Now() // Reset timer since file changed
		w.mu.Unlock()
		w.logger.WithField("path", path).Debug("file still changing, updated pending")
		return
	}

	// File unchanged since last poll - check if enough time has passed
	const minStableTime = 1 * time.Second
	if time.Since(pending.seenAt) < minStableTime {
		// Not enough time has passed, wait for next poll
		w.mu.Unlock()
		return
	}

	// Additional stability check: modTime should be old enough
	if !w.isFileStable(path, info) {
		w.mu.Unlock()
		return
	}

	// File is stable! Process it.
	delete(w.pendingFiles, path)
	w.knownFiles[path] = info.ModTime()
	w.mu.Unlock()

	// Handler is called without lock
	event := FileEvent{
		Path:      path,
		Size:      info.Size(),
		IsNew:     true,
		Timestamp: time.Now(),
	}

	if err := w.handler(event); err != nil {
		w.logger.WithError(err).WithField("path", path).Warn("handler error")
		// Remove from known on error so it can be retried
		w.mu.Lock()
		delete(w.knownFiles, path)
		w.mu.Unlock()
		// Don't add back to pending - let next poll cycle rediscover it
	} else {
		w.mu.Lock()
		w.filesQueued++
		w.mu.Unlock()
	}
}

// isFileStable checks if a file has stopped being written to.
func (w *Watcher) isFileStable(path string, info os.FileInfo) bool {
	// File must exist
	if info == nil {
		return false
	}

	// File must be at least 100 bytes (sanity check for valid files)
	if info.Size() < 100 {
		return false
	}

	// File must not have been modified in the last 2 seconds
	return time.Since(info.ModTime()) > 2*time.Second
}

// waitForStableFile waits for a file to stop being written.
// Used by fsnotify handler for active waiting.
// Returns true if file is stable, false if it was deleted or timeout.
func (w *Watcher) waitForStableFile(path string) bool {
	maxWait := 30 * time.Second
	checkInterval := 500 * time.Millisecond
	deadline := time.Now().Add(maxWait)

	var lastSize int64 = -1
	var lastModTime time.Time

	for time.Now().Before(deadline) {
		info, err := os.Stat(path)
		if err != nil {
			return false // File doesn't exist
		}

		// Check if file has stabilized
		if info.Size() == lastSize && info.ModTime().Equal(lastModTime) && w.isFileStable(path, info) {
			return true
		}

		lastSize = info.Size()
		lastModTime = info.ModTime()
		time.Sleep(checkInterval)
	}

	return false
}

// RemoveKnownFile removes a file from the known files map.
// Called when a file is successfully processed or moved to failed.
func (w *Watcher) RemoveKnownFile(path string) {
	w.mu.Lock()
	delete(w.knownFiles, path)
	delete(w.pendingFiles, path)
	w.mu.Unlock()
}

// Status holds watcher status information.
type Status struct {
	Running          bool      `json:"running"`
	WatchedDirs      int       `json:"watched_dirs"`
	LastScanAt       time.Time `json:"last_scan_at,omitempty"`
	LastScanDurMs    int64     `json:"last_scan_duration_ms,omitempty"`
	FilesDiscovered  int64     `json:"files_discovered"`
	FilesQueued      int64     `json:"files_queued"`
	FilesSkipped     int64     `json:"files_skipped"`
	KnownFilesCount  int       `json:"known_files_count"`
	PendingFilesCount int      `json:"pending_files_count"`
	FSNotifyActive   bool      `json:"fsnotify_active"`
	PollerActive     bool      `json:"poller_active"`
}

// Status returns the current status of the watcher.
func (w *Watcher) Status() Status {
	w.mu.RLock()
	defer w.mu.RUnlock()

	return Status{
		Running:          w.running,
		WatchedDirs:      w.watchedDirs,
		LastScanAt:       w.lastScanAt,
		LastScanDurMs:    w.lastScanDur.Milliseconds(),
		FilesDiscovered:  w.filesFound,
		FilesQueued:      w.filesQueued,
		FilesSkipped:     w.filesSkipped,
		KnownFilesCount:  len(w.knownFiles),
		PendingFilesCount: len(w.pendingFiles),
		FSNotifyActive:   w.fsWatcher != nil,
		PollerActive:     w.poller != nil,
	}
}

// Rescan triggers a full directory rescan.
func (w *Watcher) Rescan() error {
	w.logger.Info("triggering manual rescan")
	return w.initialScan()
}
