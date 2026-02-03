// Package database provides PostgreSQL connection management using pgx.
// It handles connection pooling, health checks, and graceful shutdown.
package database

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/eduard256/imgable/shared/pkg/logger"
)

// DB wraps pgxpool.Pool with additional functionality.
type DB struct {
	pool   *pgxpool.Pool
	logger *logger.Logger
}

// Config holds database connection configuration.
type Config struct {
	// URL is the PostgreSQL connection string
	// Format: postgres://user:password@host:port/database?sslmode=disable
	URL string

	// MaxConns is the maximum number of connections in the pool
	MaxConns int32

	// MinConns is the minimum number of connections to keep open
	MinConns int32

	// MaxConnLifetime is the maximum lifetime of a connection
	MaxConnLifetime time.Duration

	// MaxConnIdleTime is the maximum time a connection can be idle
	MaxConnIdleTime time.Duration

	// HealthCheckPeriod is how often to check connection health
	HealthCheckPeriod time.Duration

	// ConnectTimeout is the timeout for establishing a new connection
	ConnectTimeout time.Duration
}

// DefaultConfig returns configuration with sensible defaults for a photo gallery workload.
func DefaultConfig(url string) Config {
	return Config{
		URL:               url,
		MaxConns:          25,
		MinConns:          5,
		MaxConnLifetime:   time.Hour,
		MaxConnIdleTime:   30 * time.Minute,
		HealthCheckPeriod: time.Minute,
		ConnectTimeout:    10 * time.Second,
	}
}

// New creates a new database connection pool.
func New(ctx context.Context, cfg Config, log *logger.Logger) (*DB, error) {
	poolConfig, err := pgxpool.ParseConfig(cfg.URL)
	if err != nil {
		return nil, fmt.Errorf("failed to parse database URL: %w", err)
	}

	// Apply configuration
	poolConfig.MaxConns = cfg.MaxConns
	poolConfig.MinConns = cfg.MinConns
	poolConfig.MaxConnLifetime = cfg.MaxConnLifetime
	poolConfig.MaxConnIdleTime = cfg.MaxConnIdleTime
	poolConfig.HealthCheckPeriod = cfg.HealthCheckPeriod
	poolConfig.ConnConfig.ConnectTimeout = cfg.ConnectTimeout

	// Create the pool
	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("failed to create connection pool: %w", err)
	}

	db := &DB{
		pool:   pool,
		logger: log.WithField("component", "database"),
	}

	// Verify connection
	if err := db.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	db.logger.Info("database connection pool created")
	return db, nil
}

// Pool returns the underlying pgxpool.Pool for direct access.
func (db *DB) Pool() *pgxpool.Pool {
	return db.pool
}

// Ping verifies the database connection is working.
func (db *DB) Ping(ctx context.Context) error {
	return db.pool.Ping(ctx)
}

// Close closes all connections in the pool.
func (db *DB) Close() {
	db.logger.Info("closing database connection pool")
	db.pool.Close()
}

// Health returns database health status.
func (db *DB) Health(ctx context.Context) HealthStatus {
	status := HealthStatus{
		Healthy: true,
	}

	// Check ping
	start := time.Now()
	if err := db.Ping(ctx); err != nil {
		status.Healthy = false
		status.Error = err.Error()
		return status
	}
	status.Latency = time.Since(start)

	// Get pool stats
	stats := db.pool.Stat()
	status.Stats = PoolStats{
		TotalConns:      stats.TotalConns(),
		AcquiredConns:   stats.AcquiredConns(),
		IdleConns:       stats.IdleConns(),
		MaxConns:        stats.MaxConns(),
		AcquireCount:    stats.AcquireCount(),
		AcquireDuration: stats.AcquireDuration(),
		EmptyAcquire:    stats.EmptyAcquireCount(),
	}

	return status
}

// HealthStatus represents database health information.
type HealthStatus struct {
	Healthy bool          `json:"healthy"`
	Latency time.Duration `json:"latency_ms"`
	Error   string        `json:"error,omitempty"`
	Stats   PoolStats     `json:"stats"`
}

// PoolStats represents connection pool statistics.
type PoolStats struct {
	TotalConns      int32         `json:"total_conns"`
	AcquiredConns   int32         `json:"acquired_conns"`
	IdleConns       int32         `json:"idle_conns"`
	MaxConns        int32         `json:"max_conns"`
	AcquireCount    int64         `json:"acquire_count"`
	AcquireDuration time.Duration `json:"acquire_duration_ns"`
	EmptyAcquire    int64         `json:"empty_acquire_count"`
}

// Exec executes a query that doesn't return rows.
func (db *DB) Exec(ctx context.Context, sql string, args ...interface{}) error {
	_, err := db.pool.Exec(ctx, sql, args...)
	return err
}

// QueryRow executes a query that returns a single row.
func (db *DB) QueryRow(ctx context.Context, sql string, args ...interface{}) pgx.Row {
	return db.pool.QueryRow(ctx, sql, args...)
}

// Query executes a query that returns multiple rows.
func (db *DB) Query(ctx context.Context, sql string, args ...interface{}) (pgx.Rows, error) {
	return db.pool.Query(ctx, sql, args...)
}

// Begin starts a new transaction.
func (db *DB) Begin(ctx context.Context) (pgx.Tx, error) {
	return db.pool.Begin(ctx)
}

// BeginTx starts a new transaction with options.
func (db *DB) BeginTx(ctx context.Context, opts pgx.TxOptions) (pgx.Tx, error) {
	return db.pool.BeginTx(ctx, opts)
}

// WithTx executes a function within a transaction.
// If the function returns an error, the transaction is rolled back.
// Otherwise, the transaction is committed.
func (db *DB) WithTx(ctx context.Context, fn func(tx pgx.Tx) error) error {
	tx, err := db.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %w", err)
	}

	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
	}()

	if err := fn(tx); err != nil {
		if rbErr := tx.Rollback(ctx); rbErr != nil {
			return fmt.Errorf("tx error: %v, rollback error: %w", err, rbErr)
		}
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %w", err)
	}

	return nil
}
