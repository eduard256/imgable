// Package queue provides task queue integration for the scanner service.
// It handles enqueuing file processing tasks with deduplication.
package queue

import (
	"context"
	"sync"
	"time"

	"github.com/hibiken/asynq"

	"github.com/eduard256/imgable/scanner/internal/watcher"
	"github.com/eduard256/imgable/shared/pkg/logger"
	"github.com/eduard256/imgable/shared/pkg/queue"
)

// Producer handles enqueuing file processing tasks.
type Producer struct {
	client  *queue.Client
	logger  *logger.Logger

	// Stats
	mu           sync.RWMutex
	enqueuedCount int64
	skippedCount  int64
	errorCount    int64
}

// NewProducer creates a new task producer.
func NewProducer(redisURL string, log *logger.Logger) (*Producer, error) {
	cfg := queue.DefaultClientConfig(redisURL)
	client, err := queue.NewClient(cfg, log)
	if err != nil {
		return nil, err
	}

	return &Producer{
		client: client,
		logger: log.WithField("component", "producer"),
	}, nil
}

// Close closes the producer's client connection.
func (p *Producer) Close() error {
	return p.client.Close()
}

// HandleFileEvent processes a file event from the watcher.
// It enqueues a task for the processor to handle.
func (p *Producer) HandleFileEvent(event watcher.FileEvent) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	payload := queue.ProcessFilePayload{
		FilePath:   event.Path,
		DetectedAt: event.Timestamp,
		FileSize:   event.Size,
	}

	info, err := p.client.EnqueueProcessFile(ctx, payload)
	if err != nil {
		p.mu.Lock()
		p.errorCount++
		p.mu.Unlock()

		p.logger.WithError(err).WithField("path", event.Path).Error("failed to enqueue task")
		return err
	}

	// info is nil if task was already queued (duplicate)
	if info == nil {
		p.mu.Lock()
		p.skippedCount++
		p.mu.Unlock()

		p.logger.WithField("path", event.Path).Debug("task already queued")
		return nil
	}

	p.mu.Lock()
	p.enqueuedCount++
	p.mu.Unlock()

	p.logger.WithFields(map[string]interface{}{
		"task_id": info.ID,
		"path":    event.Path,
		"size":    event.Size,
	}).Info("task enqueued")

	return nil
}

// Stats returns producer statistics.
type Stats struct {
	EnqueuedCount int64 `json:"enqueued_count"`
	SkippedCount  int64 `json:"skipped_count"`
	ErrorCount    int64 `json:"error_count"`
}

// Stats returns current producer statistics.
func (p *Producer) Stats() Stats {
	p.mu.RLock()
	defer p.mu.RUnlock()

	return Stats{
		EnqueuedCount: p.enqueuedCount,
		SkippedCount:  p.skippedCount,
		ErrorCount:    p.errorCount,
	}
}

// GetQueueStats returns current queue statistics from Redis.
func (p *Producer) GetQueueStats(redisURL string) ([]queue.QueueStats, error) {
	inspector, err := queue.NewInspector(redisURL, p.logger)
	if err != nil {
		return nil, err
	}
	defer inspector.Close()

	return inspector.GetQueueStats()
}

// EnqueueWithPriority enqueues a file with custom priority.
func (p *Producer) EnqueueWithPriority(ctx context.Context, filePath string, priority asynq.Option) error {
	payload := queue.ProcessFilePayload{
		FilePath:   filePath,
		DetectedAt: time.Now(),
	}

	_, err := p.client.EnqueueProcessFile(ctx, payload, priority)
	return err
}
