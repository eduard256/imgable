package models

import (
	"database/sql"
	"time"
)

// ProcessingStatus represents the status of a file being processed.
type ProcessingStatus string

const (
	ProcessingStatusQueued     ProcessingStatus = "queued"
	ProcessingStatusProcessing ProcessingStatus = "processing"
	ProcessingStatusCompleted  ProcessingStatus = "completed"
	ProcessingStatusFailed     ProcessingStatus = "failed"
)

// ProcessingState represents the processing state of a file.
// Maps to the 'processing_state' table in PostgreSQL.
// Used for crash recovery and progress monitoring.
type ProcessingState struct {
	FilePath    string           `json:"file_path" db:"file_path"`
	Status      ProcessingStatus `json:"status" db:"status"`
	Attempts    int              `json:"attempts" db:"attempts"`
	LastError   sql.NullString   `json:"last_error,omitempty" db:"last_error"`
	WorkerID    sql.NullString   `json:"worker_id,omitempty" db:"worker_id"`
	StartedAt   sql.NullTime     `json:"started_at,omitempty" db:"started_at"`
	CompletedAt sql.NullTime     `json:"completed_at,omitempty" db:"completed_at"`
	CreatedAt   time.Time        `json:"created_at" db:"created_at"`
}

// ProcessingStateAPI represents processing state for API responses.
type ProcessingStateAPI struct {
	FilePath    string     `json:"file_path"`
	Status      string     `json:"status"`
	Attempts    int        `json:"attempts"`
	LastError   string     `json:"last_error,omitempty"`
	WorkerID    string     `json:"worker_id,omitempty"`
	StartedAt   *time.Time `json:"started_at,omitempty"`
	CompletedAt *time.Time `json:"completed_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

// ToAPI converts ProcessingState to API response format.
func (p *ProcessingState) ToAPI() ProcessingStateAPI {
	api := ProcessingStateAPI{
		FilePath:  p.FilePath,
		Status:    string(p.Status),
		Attempts:  p.Attempts,
		CreatedAt: p.CreatedAt,
	}

	if p.LastError.Valid {
		api.LastError = p.LastError.String
	}
	if p.WorkerID.Valid {
		api.WorkerID = p.WorkerID.String
	}
	if p.StartedAt.Valid {
		api.StartedAt = &p.StartedAt.Time
	}
	if p.CompletedAt.Valid {
		api.CompletedAt = &p.CompletedAt.Time
	}

	return api
}

// FailedFile represents a file that failed processing and was moved to /failed.
type FailedFile struct {
	// Path in /failed directory
	Path string `json:"path"`

	// Original path in /uploads
	OriginalPath string `json:"original_path"`

	// Error information
	Error string `json:"error"`
	Stage string `json:"stage"` // e.g., "hash", "resize", "metadata", "database"

	// Processing attempts before failure
	Attempts int `json:"attempts"`

	// When the file was moved to /failed
	FailedAt time.Time `json:"failed_at"`

	// File size in bytes
	FileSize int64 `json:"file_size,omitempty"`
}

// FailedFileError is written alongside failed files as .error JSON files.
type FailedFileError struct {
	OriginalPath string    `json:"original_path"`
	Error        string    `json:"error"`
	Stage        string    `json:"stage"`
	Attempts     int       `json:"attempts"`
	Timestamp    time.Time `json:"timestamp"`
	WorkerID     string    `json:"worker_id,omitempty"`
	StackTrace   string    `json:"stack_trace,omitempty"`
}
