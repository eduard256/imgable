package queue

import (
	"encoding/json"
	"testing"
	"time"
)

func TestProcessFilePayload(t *testing.T) {
	payload := ProcessFilePayload{
		FilePath:   "/uploads/test/image.jpg",
		DetectedAt: time.Now(),
		FileSize:   1024000,
		IsRetry:    false,
	}

	// Test JSON marshaling
	data, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("Failed to marshal payload: %v", err)
	}

	// Test JSON unmarshaling
	var decoded ProcessFilePayload
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal payload: %v", err)
	}

	if decoded.FilePath != payload.FilePath {
		t.Errorf("FilePath mismatch: got %q, want %q", decoded.FilePath, payload.FilePath)
	}

	if decoded.FileSize != payload.FileSize {
		t.Errorf("FileSize mismatch: got %d, want %d", decoded.FileSize, payload.FileSize)
	}

	if decoded.IsRetry != payload.IsRetry {
		t.Errorf("IsRetry mismatch: got %v, want %v", decoded.IsRetry, payload.IsRetry)
	}
}

func TestTaskTypes(t *testing.T) {
	// Verify task type constants are defined
	if TypeProcessFile == "" {
		t.Error("TypeProcessFile should not be empty")
	}

	if TypeRetryFailed == "" {
		t.Error("TypeRetryFailed should not be empty")
	}

	// Task types should be different
	if TypeProcessFile == TypeRetryFailed {
		t.Error("TypeProcessFile and TypeRetryFailed should be different")
	}
}

func TestDefaultClientConfig(t *testing.T) {
	cfg := DefaultClientConfig("redis://localhost:6379")

	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("RedisURL mismatch: got %q", cfg.RedisURL)
	}

	if cfg.RetryLimit <= 0 {
		t.Error("RetryLimit should be positive")
	}

	if cfg.RetryDelay <= 0 {
		t.Error("RetryDelay should be positive")
	}

	if cfg.TaskTimeout <= 0 {
		t.Error("TaskTimeout should be positive")
	}

	if cfg.UniqueTaskTTL <= 0 {
		t.Error("UniqueTaskTTL should be positive")
	}
}

func TestDefaultServerConfig(t *testing.T) {
	cfg := DefaultServerConfig("redis://localhost:6379", 4)

	if cfg.RedisURL != "redis://localhost:6379" {
		t.Errorf("RedisURL mismatch: got %q", cfg.RedisURL)
	}

	if cfg.Concurrency != 4 {
		t.Errorf("Concurrency should be 4, got %d", cfg.Concurrency)
	}

	if len(cfg.Queues) == 0 {
		t.Error("Queues should not be empty")
	}

	// Default queue should exist
	if _, ok := cfg.Queues["default"]; !ok {
		t.Error("default queue should be configured")
	}

	if cfg.ShutdownTimeout <= 0 {
		t.Error("ShutdownTimeout should be positive")
	}
}

func TestQueueStats(t *testing.T) {
	stats := QueueStats{
		Queue:          "default",
		Pending:        10,
		Active:         2,
		Scheduled:      5,
		Retry:          1,
		Archived:       0,
		Completed:      100,
		ProcessedTotal: 105,
		FailedTotal:    5,
		Timestamp:      time.Now(),
	}

	// Verify JSON marshaling works
	data, err := json.Marshal(stats)
	if err != nil {
		t.Fatalf("Failed to marshal QueueStats: %v", err)
	}

	var decoded QueueStats
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("Failed to unmarshal QueueStats: %v", err)
	}

	if decoded.Queue != stats.Queue {
		t.Errorf("Queue mismatch: got %q, want %q", decoded.Queue, stats.Queue)
	}

	if decoded.Pending != stats.Pending {
		t.Errorf("Pending mismatch: got %d, want %d", decoded.Pending, stats.Pending)
	}
}
