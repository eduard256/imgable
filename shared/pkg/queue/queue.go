// Package queue provides task queue functionality using Asynq (Redis-based).
// It handles task creation, deduplication, and processing with retry support.
package queue

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"

	"github.com/eduard256/imgable/shared/pkg/logger"
)

// Task type constants used across services.
const (
	// TypeProcessFile is the task type for processing a new file (photo or video).
	TypeProcessFile = "file:process"

	// TypeRetryFailed is the task type for retrying a previously failed file.
	TypeRetryFailed = "file:retry"
)

// ProcessFilePayload is the payload for TypeProcessFile tasks.
type ProcessFilePayload struct {
	// FilePath is the absolute path to the file in /uploads
	FilePath string `json:"file_path"`

	// DetectedAt is when the file was first detected by scanner
	DetectedAt time.Time `json:"detected_at"`

	// FileSize is the file size in bytes (for logging/metrics)
	FileSize int64 `json:"file_size,omitempty"`

	// IsRetry indicates if this is a retry from /failed directory
	IsRetry bool `json:"is_retry,omitempty"`
}

// Client wraps asynq.Client with additional functionality.
type Client struct {
	client *asynq.Client
	logger *logger.Logger
}

// ClientConfig holds client configuration options.
type ClientConfig struct {
	// RedisURL is the Redis connection string
	// Format: redis://host:port or redis://user:password@host:port
	RedisURL string

	// RetryLimit is the maximum number of retry attempts for failed tasks
	RetryLimit int

	// RetryDelay is the initial delay before retry (exponential backoff applied)
	RetryDelay time.Duration

	// TaskTimeout is the maximum time a task can run before being killed
	TaskTimeout time.Duration

	// UniqueTaskTTL is how long to remember task uniqueness (for deduplication)
	UniqueTaskTTL time.Duration
}

// DefaultClientConfig returns configuration with sensible defaults.
func DefaultClientConfig(redisURL string) ClientConfig {
	return ClientConfig{
		RedisURL:      redisURL,
		RetryLimit:    3,
		RetryDelay:    30 * time.Second,
		TaskTimeout:   10 * time.Minute,
		UniqueTaskTTL: 24 * time.Hour,
	}
}

// NewClient creates a new queue client.
func NewClient(cfg ClientConfig, log *logger.Logger) (*Client, error) {
	redisOpt, err := asynq.ParseRedisURI(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Redis URL: %w", err)
	}

	client := asynq.NewClient(redisOpt)

	return &Client{
		client: client,
		logger: log.WithField("component", "queue-client"),
	}, nil
}

// Close closes the client connection.
func (c *Client) Close() error {
	return c.client.Close()
}

// EnqueueProcessFile adds a file processing task to the queue.
// Uses file path as unique key to prevent duplicate processing.
func (c *Client) EnqueueProcessFile(ctx context.Context, payload ProcessFilePayload, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

	// Default options for file processing
	defaultOpts := []asynq.Option{
		asynq.MaxRetry(3),
		asynq.Timeout(10 * time.Minute),
		asynq.Queue("default"),
		// Use file path as unique key to prevent duplicates
		asynq.Unique(24 * time.Hour),
	}

	// Append custom options (can override defaults)
	allOpts := append(defaultOpts, opts...)

	task := asynq.NewTask(TypeProcessFile, data, allOpts...)
	info, err := c.client.EnqueueContext(ctx, task)
	if err != nil {
		// Check if it's a duplicate task error
		if err == asynq.ErrDuplicateTask {
			c.logger.WithField("file_path", payload.FilePath).Debug("task already queued, skipping")
			return nil, nil // Not an error, just already queued
		}
		return nil, fmt.Errorf("failed to enqueue task: %w", err)
	}

	c.logger.WithFields(map[string]interface{}{
		"task_id":   info.ID,
		"file_path": payload.FilePath,
		"queue":     info.Queue,
	}).Debug("task enqueued")

	return info, nil
}

// EnqueueRetryFailed adds a retry task for a file from /failed directory.
func (c *Client) EnqueueRetryFailed(ctx context.Context, payload ProcessFilePayload, opts ...asynq.Option) (*asynq.TaskInfo, error) {
	payload.IsRetry = true

	data, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal payload: %w", err)
	}

	defaultOpts := []asynq.Option{
		asynq.MaxRetry(1), // Only one retry for manual retries
		asynq.Timeout(10 * time.Minute),
		asynq.Queue("retry"),
	}

	allOpts := append(defaultOpts, opts...)

	task := asynq.NewTask(TypeRetryFailed, data, allOpts...)
	info, err := c.client.EnqueueContext(ctx, task)
	if err != nil {
		return nil, fmt.Errorf("failed to enqueue retry task: %w", err)
	}

	return info, nil
}

// Inspector wraps asynq.Inspector for queue inspection.
type Inspector struct {
	inspector *asynq.Inspector
	logger    *logger.Logger
}

// NewInspector creates a new queue inspector.
func NewInspector(redisURL string, log *logger.Logger) (*Inspector, error) {
	redisOpt, err := asynq.ParseRedisURI(redisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Redis URL: %w", err)
	}

	return &Inspector{
		inspector: asynq.NewInspector(redisOpt),
		logger:    log.WithField("component", "queue-inspector"),
	}, nil
}

// Close closes the inspector connection.
func (i *Inspector) Close() error {
	return i.inspector.Close()
}

// QueueStats holds queue statistics.
type QueueStats struct {
	// Queue name
	Queue string `json:"queue"`

	// Task counts by status
	Pending   int `json:"pending"`
	Active    int `json:"active"`
	Scheduled int `json:"scheduled"`
	Retry     int `json:"retry"`
	Archived  int `json:"archived"`
	Completed int `json:"completed"`

	// Processed counts
	ProcessedTotal int `json:"processed_total"`
	FailedTotal    int `json:"failed_total"`

	// Timestamp
	Timestamp time.Time `json:"timestamp"`
}

// GetQueueStats returns statistics for all queues.
func (i *Inspector) GetQueueStats() ([]QueueStats, error) {
	queues, err := i.inspector.Queues()
	if err != nil {
		return nil, fmt.Errorf("failed to get queues: %w", err)
	}

	var stats []QueueStats
	for _, q := range queues {
		info, err := i.inspector.GetQueueInfo(q)
		if err != nil {
			i.logger.WithError(err).Warnf("failed to get info for queue %s", q)
			continue
		}

		stats = append(stats, QueueStats{
			Queue:          q,
			Pending:        info.Pending,
			Active:         info.Active,
			Scheduled:      info.Scheduled,
			Retry:          info.Retry,
			Archived:       info.Archived,
			Completed:      info.Completed,
			ProcessedTotal: int(info.ProcessedTotal),
			FailedTotal:    int(info.FailedTotal),
			Timestamp:      time.Now(),
		})
	}

	return stats, nil
}

// GetPendingTasks returns pending tasks from a queue.
func (i *Inspector) GetPendingTasks(queue string, limit int) ([]*asynq.TaskInfo, error) {
	tasks, err := i.inspector.ListPendingTasks(queue, asynq.PageSize(limit))
	if err != nil {
		return nil, fmt.Errorf("failed to list pending tasks: %w", err)
	}
	return tasks, nil
}

// GetActiveTasks returns active (processing) tasks from a queue.
func (i *Inspector) GetActiveTasks(queue string, limit int) ([]*asynq.TaskInfo, error) {
	tasks, err := i.inspector.ListActiveTasks(queue, asynq.PageSize(limit))
	if err != nil {
		return nil, fmt.Errorf("failed to list active tasks: %w", err)
	}
	return tasks, nil
}

// GetArchivedTasks returns archived (permanently failed) tasks.
func (i *Inspector) GetArchivedTasks(queue string, limit int) ([]*asynq.TaskInfo, error) {
	tasks, err := i.inspector.ListArchivedTasks(queue, asynq.PageSize(limit))
	if err != nil {
		return nil, fmt.Errorf("failed to list archived tasks: %w", err)
	}
	return tasks, nil
}

// PauseQueue pauses processing of tasks in a queue.
func (i *Inspector) PauseQueue(queue string) error {
	return i.inspector.PauseQueue(queue)
}

// ResumeQueue resumes processing of tasks in a queue.
func (i *Inspector) ResumeQueue(queue string) error {
	return i.inspector.UnpauseQueue(queue)
}

// IsQueuePaused checks if a queue is paused.
func (i *Inspector) IsQueuePaused(queue string) (bool, error) {
	info, err := i.inspector.GetQueueInfo(queue)
	if err != nil {
		return false, err
	}
	return info.Paused, nil
}

// DeleteTask deletes a task by ID.
func (i *Inspector) DeleteTask(queue, taskID string) error {
	return i.inspector.DeleteTask(queue, taskID)
}

// Server wraps asynq.Server for task processing.
type Server struct {
	server *asynq.Server
	mux    *asynq.ServeMux
	logger *logger.Logger
}

// ServerConfig holds server configuration options.
type ServerConfig struct {
	// RedisURL is the Redis connection string
	RedisURL string

	// Concurrency is the number of concurrent workers
	Concurrency int

	// Queues is a map of queue names to priority (higher = more priority)
	Queues map[string]int

	// StrictPriority determines if higher priority queues are always processed first
	StrictPriority bool

	// ShutdownTimeout is how long to wait for active tasks to complete on shutdown
	ShutdownTimeout time.Duration
}

// DefaultServerConfig returns configuration with sensible defaults.
func DefaultServerConfig(redisURL string, concurrency int) ServerConfig {
	return ServerConfig{
		RedisURL:    redisURL,
		Concurrency: concurrency,
		Queues: map[string]int{
			"default": 6,
			"retry":   3,
		},
		StrictPriority:  false,
		ShutdownTimeout: 30 * time.Second,
	}
}

// NewServer creates a new queue server.
func NewServer(cfg ServerConfig, log *logger.Logger) (*Server, error) {
	redisOpt, err := asynq.ParseRedisURI(cfg.RedisURL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse Redis URL: %w", err)
	}

	server := asynq.NewServer(redisOpt, asynq.Config{
		Concurrency:     cfg.Concurrency,
		Queues:          cfg.Queues,
		StrictPriority:  cfg.StrictPriority,
		ShutdownTimeout: cfg.ShutdownTimeout,
		Logger:          &asynqLogger{log: log.WithField("component", "asynq")},
		ErrorHandler: asynq.ErrorHandlerFunc(func(ctx context.Context, task *asynq.Task, err error) {
			log.WithFields(map[string]interface{}{
				"task_type": task.Type(),
				"error":     err.Error(),
			}).Error("task processing failed")
		}),
	})

	return &Server{
		server: server,
		mux:    asynq.NewServeMux(),
		logger: log.WithField("component", "queue-server"),
	}, nil
}

// HandleFunc registers a handler function for a task type.
func (s *Server) HandleFunc(taskType string, handler func(context.Context, *asynq.Task) error) {
	s.mux.HandleFunc(taskType, handler)
}

// Start starts the server and begins processing tasks.
func (s *Server) Start() error {
	s.logger.Info("starting queue server")
	return s.server.Start(s.mux)
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown() {
	s.logger.Info("shutting down queue server")
	s.server.Shutdown()
}

// asynqLogger adapts our logger to asynq's logger interface.
type asynqLogger struct {
	log *logger.Logger
}

func (l *asynqLogger) Debug(args ...interface{}) {
	l.log.Debug(fmt.Sprint(args...))
}

func (l *asynqLogger) Info(args ...interface{}) {
	l.log.Info(fmt.Sprint(args...))
}

func (l *asynqLogger) Warn(args ...interface{}) {
	l.log.Warn(fmt.Sprint(args...))
}

func (l *asynqLogger) Error(args ...interface{}) {
	l.log.Error(fmt.Sprint(args...))
}

func (l *asynqLogger) Fatal(args ...interface{}) {
	l.log.Fatal(fmt.Sprint(args...))
}
