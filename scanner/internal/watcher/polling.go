package watcher

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/eduard256/imgable/shared/pkg/logger"
)

// PollHandler is called when a file is found during polling.
type PollHandler func(path string, info os.FileInfo)

// Poller periodically scans a directory for new files.
// Used as a fallback for fsnotify (e.g., NFS, network shares).
type Poller struct {
	dir      string
	interval time.Duration
	handler  PollHandler
	logger   *logger.Logger

	mu       sync.RWMutex
	running  bool
	lastPoll time.Time

	stopChan chan struct{}
	doneChan chan struct{}
}

// NewPoller creates a new directory poller.
func NewPoller(dir string, interval time.Duration, handler PollHandler, log *logger.Logger) *Poller {
	return &Poller{
		dir:      dir,
		interval: interval,
		handler:  handler,
		logger:   log.WithField("subcomponent", "poller"),
		stopChan: make(chan struct{}),
		doneChan: make(chan struct{}),
	}
}

// Start begins polling the directory.
func (p *Poller) Start(ctx context.Context) {
	p.mu.Lock()
	if p.running {
		p.mu.Unlock()
		return
	}
	p.running = true
	p.mu.Unlock()

	p.logger.WithFields(map[string]interface{}{
		"dir":      p.dir,
		"interval": p.interval.String(),
	}).Info("poller started")

	ticker := time.NewTicker(p.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			p.cleanup()
			return
		case <-p.stopChan:
			p.cleanup()
			return
		case <-ticker.C:
			p.poll()
		}
	}
}

// poll performs a single scan of the directory.
func (p *Poller) poll() {
	start := time.Now()
	var filesFound int

	err := filepath.Walk(p.dir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Log but continue walking
			p.logger.WithError(err).WithField("path", path).Debug("error accessing path during poll")
			return nil
		}

		// Skip directories
		if info.IsDir() {
			return nil
		}

		filesFound++

		// Call handler for each file
		// The handler is responsible for checking if it's already known
		p.handler(path, info)

		return nil
	})

	if err != nil {
		p.logger.WithError(err).Warn("poll walk error")
	}

	p.mu.Lock()
	p.lastPoll = start
	p.mu.Unlock()

	p.logger.WithFields(map[string]interface{}{
		"duration_ms": time.Since(start).Milliseconds(),
		"files_found": filesFound,
	}).Debug("poll completed")
}

// Stop stops the poller.
func (p *Poller) Stop() {
	p.mu.Lock()
	if !p.running {
		p.mu.Unlock()
		return
	}
	p.mu.Unlock()

	close(p.stopChan)
	<-p.doneChan
}

// cleanup marks the poller as not running.
func (p *Poller) cleanup() {
	p.mu.Lock()
	defer p.mu.Unlock()

	if !p.running {
		return
	}

	p.running = false
	close(p.doneChan)

	p.logger.Info("poller stopped")
}

// LastPoll returns the time of the last poll.
func (p *Poller) LastPoll() time.Time {
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.lastPoll
}

// PollNow triggers an immediate poll (for manual rescan).
func (p *Poller) PollNow() {
	go p.poll()
}
