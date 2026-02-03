// Package storage provides database access layer for the Imgable API.
// It encapsulates all SQL queries and provides a clean interface for handlers.
package storage

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

// Storage provides access to database and cache.
type Storage struct {
	db    *pgxpool.Pool
	redis *redis.Client
}

// New creates a new Storage instance with database and Redis connections.
func New(ctx context.Context, dbURL, redisURL string) (*Storage, error) {
	// Connect to PostgreSQL
	dbPool, err := pgxpool.New(ctx, dbURL)
	if err != nil {
		return nil, fmt.Errorf("failed to connect to database: %w", err)
	}

	// Verify connection
	if err := dbPool.Ping(ctx); err != nil {
		dbPool.Close()
		return nil, fmt.Errorf("failed to ping database: %w", err)
	}

	// Parse Redis URL and connect
	redisOpts, err := redis.ParseURL(redisURL)
	if err != nil {
		dbPool.Close()
		return nil, fmt.Errorf("failed to parse redis URL: %w", err)
	}

	redisClient := redis.NewClient(redisOpts)

	// Verify Redis connection
	if err := redisClient.Ping(ctx).Err(); err != nil {
		dbPool.Close()
		return nil, fmt.Errorf("failed to ping redis: %w", err)
	}

	return &Storage{
		db:    dbPool,
		redis: redisClient,
	}, nil
}

// Close closes all connections.
func (s *Storage) Close() {
	if s.db != nil {
		s.db.Close()
	}
	if s.redis != nil {
		s.redis.Close()
	}
}

// Health checks database and Redis connectivity.
func (s *Storage) Health(ctx context.Context) error {
	// Check database
	if err := s.db.Ping(ctx); err != nil {
		return fmt.Errorf("database: %w", err)
	}

	// Check Redis
	if err := s.redis.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("redis: %w", err)
	}

	return nil
}

// DB returns the database pool for direct access if needed.
func (s *Storage) DB() *pgxpool.Pool {
	return s.db
}

// Redis returns the Redis client for direct access if needed.
func (s *Storage) Redis() *redis.Client {
	return s.redis
}
