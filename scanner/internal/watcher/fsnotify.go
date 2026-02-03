package watcher

import (
	"context"
	"os"
	"path/filepath"
	"sync"

	"github.com/fsnotify/fsnotify"

	"github.com/eduard256/imgable/shared/pkg/logger"
)

// FSNotifyHandler is called when a new file is detected.
type FSNotifyHandler func(path string)

// FSNotifyWatcher wraps fsnotify for watching directories recursively.
type FSNotifyWatcher struct {
	watcher  *fsnotify.Watcher
	handler  FSNotifyHandler
	logger   *logger.Logger
	rootDir  string

	mu          sync.RWMutex
	watchedDirs map[string]bool
	running     bool

	stopChan chan struct{}
	doneChan chan struct{}
}

// NewFSNotifyWatcher creates a new fsnotify-based watcher.
func NewFSNotifyWatcher(dir string, handler FSNotifyHandler, log *logger.Logger) (*FSNotifyWatcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	fsw := &FSNotifyWatcher{
		watcher:     watcher,
		handler:     handler,
		logger:      log.WithField("subcomponent", "fsnotify"),
		rootDir:     dir,
		watchedDirs: make(map[string]bool),
		stopChan:    make(chan struct{}),
		doneChan:    make(chan struct{}),
	}

	// Add watches recursively
	if err := fsw.addWatchRecursive(dir); err != nil {
		watcher.Close()
		return nil, err
	}

	return fsw, nil
}

// addWatchRecursive adds watches to a directory and all subdirectories.
func (w *FSNotifyWatcher) addWatchRecursive(dir string) error {
	return filepath.Walk(dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Continue on error
		}

		if info.IsDir() {
			return w.addWatch(path)
		}
		return nil
	})
}

// addWatch adds a watch to a single directory.
func (w *FSNotifyWatcher) addWatch(dir string) error {
	w.mu.Lock()
	defer w.mu.Unlock()

	if w.watchedDirs[dir] {
		return nil // Already watching
	}

	if err := w.watcher.Add(dir); err != nil {
		w.logger.WithError(err).WithField("dir", dir).Debug("failed to add watch")
		return err
	}

	w.watchedDirs[dir] = true
	w.logger.WithField("dir", dir).Debug("added watch")
	return nil
}

// AddDir adds a watch to a directory (called when new directories are created).
func (w *FSNotifyWatcher) AddDir(dir string) error {
	return w.addWatch(dir)
}

// WatchedDirs returns the number of watched directories.
func (w *FSNotifyWatcher) WatchedDirs() int {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return len(w.watchedDirs)
}

// Start begins watching for events.
func (w *FSNotifyWatcher) Start(ctx context.Context) {
	w.mu.Lock()
	if w.running {
		w.mu.Unlock()
		return
	}
	w.running = true
	w.mu.Unlock()

	w.logger.WithField("dirs", len(w.watchedDirs)).Info("fsnotify watcher started")

	for {
		select {
		case <-ctx.Done():
			w.cleanup()
			return
		case <-w.stopChan:
			w.cleanup()
			return
		case event, ok := <-w.watcher.Events:
			if !ok {
				w.cleanup()
				return
			}
			w.handleEvent(event)
		case err, ok := <-w.watcher.Errors:
			if !ok {
				w.cleanup()
				return
			}
			w.logger.WithError(err).Warn("fsnotify error")
		}
	}
}

// handleEvent processes a single fsnotify event.
func (w *FSNotifyWatcher) handleEvent(event fsnotify.Event) {
	// We only care about create and write events
	if event.Op&fsnotify.Create == 0 && event.Op&fsnotify.Write == 0 {
		return
	}

	path := event.Name

	// Check if it's a directory
	info, err := os.Stat(path)
	if err != nil {
		return // File might have been deleted
	}

	if info.IsDir() {
		// Add watch for new directory
		if event.Op&fsnotify.Create != 0 {
			w.addWatch(path)
		}
		return
	}

	// Call handler for files
	w.handler(path)
}

// Stop stops the watcher.
func (w *FSNotifyWatcher) Stop() {
	w.mu.Lock()
	if !w.running {
		w.mu.Unlock()
		return
	}
	w.mu.Unlock()

	close(w.stopChan)
	<-w.doneChan
}

// cleanup closes the watcher and marks as not running.
func (w *FSNotifyWatcher) cleanup() {
	w.mu.Lock()
	defer w.mu.Unlock()

	if !w.running {
		return
	}

	w.watcher.Close()
	w.running = false
	close(w.doneChan)

	w.logger.Info("fsnotify watcher stopped")
}
